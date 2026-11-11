import 'server-only'
import { createHash } from 'node:crypto'
import { logger } from '@/lib/logger'
import {
  KlaviyoError,
  type KlaviyoClient
} from '@/lib/providers/klaviyo/client'
import {
  addVariation,
  audienceExists,
  campaignParts,
  createCampaign,
  createMessage,
  createTemplate,
  deleteTemplate,
  deleteVariation,
  designName,
  findOwnCampaign,
  findTemplate,
  importImage,
  readDraft,
  setEvenTest,
  updateVariation,
  type DraftRead,
  type VariationContent
} from '@/lib/providers/klaviyo/drafts'
import type {
  DraftInput,
  DraftPusher,
  DraftResult
} from '@/lib/providers/klaviyo-draft'
import {
  finalChecks,
  htmlHash,
  imageSources,
  preflight,
  withImages,
  type FinalCheck
} from './html'

/**
 * The live DraftPusher (PSH-001): puts one built email into the
 * workspace's own Klaviyo account as a DRAFT campaign, never scheduled or
 * sent (D17: the owner schedules it in Klaviyo).
 *
 * Step 0's push that worked (docs/step0/README.md), step by step: the
 * pictures are imported into Klaviyo's library and the HTML points at them
 * (VISION rule 11); the final checks run on exactly the HTML sent; each
 * design becomes an HTML template; the campaign is made with its list or
 * segment, then its message with design A. For an A/B design test
 * (EML-005) design B is added, the message's test is set to an even split
 * with no winner and read back; until that is verified nothing else
 * happens, and if it fails (Klaviyo refuses, keeps other settings, the time
 * runs out) design B is taken out at once, so no draft is ever left that
 * Klaviyo's own A/B settings could finish by sending a "winner". If B
 * cannot be taken out the push is refused (`ab_test_unsafe`).
 *
 * Every step is saved as it is made (`PushStore`, under the build's push
 * lease), so a push that stops half way goes on where it was and never
 * makes a second picture, template or campaign: a campaign or template
 * whose answer was lost is found again. The same key again updates the
 * draft to this content; a draft the owner scheduled, sent, deleted or
 * changed in Klaviyo (its variations' names, subjects and previews, its
 * mark) is never touched (`rejected`).
 *
 * It never throws: Klaviyo's answers become the port's codes.
 */

export type PushTemplate = {
  approach: 'A' | 'B'
  id: string
  hash: string
  deleted: boolean
  /** The variation it was put on (then its content is there). */
  variation?: string | null
}
export type PushProgress = {
  state: 'started' | 'drafted' | 'refused'
  images: Record<string, string>
  templates: PushTemplate[]
  campaignId: string | null
  messageId: string | null
  /** When the first campaign create was sent (its answer may be lost). */
  createStartedAt: string | null
  /** When a template create was sent and not yet saved. */
  templateStartedAt: string | null
  /** The list or segment the campaign was made for. */
  audienceId: string | null
  designs: 'both' | 'A' | null
  fallback: string | null
  /** `pending`: design B was added and the even test is not verified yet. */
  ab: 'pending' | 'verified' | null
  reason: string | null
  /** A fingerprint of the variations as we left them. */
  written: string | null
  /** The fingerprint they are being changed to (a push stopped half way). */
  target: string | null
}
export type PushStep = Partial<
  Omit<PushProgress, 'images'> & {
    /** Pictures added (merged into those saved). */
    images: Record<string, string>
    checks: FinalCheck[]
  }
>
/** One push: its workspace and key, and the build's push lease it runs under. */
export type PushRef = {
  tenantId: string
  key: string
  build: string
  lease: string
}
/**
 * Where each push's steps are kept (`klaviyo_draft_pushes`). A step is saved
 * only under the build's exact push lease: a run that lost it saves
 * nothing, so two runs never both make a campaign.
 */
export type PushStore = {
  load(ref: PushRef): Promise<PushProgress | null>
  save(ref: PushRef, step: PushStep): Promise<void>
}
/** The workspace's live Klaviyo and its timezone. */
export type PushSource = {
  /** Null when the workspace has no live, connected Klaviyo key. */
  client(tenantId: string): Promise<KlaviyoClient | null>
  timezone(tenantId: string): Promise<string>
}

const empty: PushProgress = {
  state: 'started',
  images: {},
  templates: [],
  campaignId: null,
  messageId: null,
  createStartedAt: null,
  templateStartedAt: null,
  audienceId: null,
  designs: null,
  fallback: null,
  ab: null,
  reason: null,
  written: null,
  target: null
}

/**
 * A push stops before a Klaviyo request that might not end inside its
 * time: everything made so far is saved, and the next run goes on.
 */
class TimeUp extends Error {}

/** A push we will not make; `checks` name what stopped it. */
class Refused extends Error {
  constructor(
    readonly reason: string,
    readonly checks: string[]
  ) {
    super(reason)
  }
}

/** A push takes at most this long, so it ends inside its route's minute. */
export const pushBudgetMs = 25_000
/** A create whose answer was lost is looked for from a minute before. */
const findSlackMs = 60_000

/** Our mark on a campaign: which push made it. */
export const pushMark = (key: string) => `GROS draft ${key}`
const short = (key: string) => key.replace(/-/g, '').slice(0, 8)
const templateName = (key: string, approach: 'A' | 'B', hash: string) =>
  `GROS ${short(key)} ${approach} ${hash.slice(0, 8)}`

type Design = { approach: 'A' | 'B'; html: string }

/** The designs asked for: two for an A/B test (A first), else the one. */
function designsOf(input: DraftInput): Design[] {
  if (!input.variations) return [{ approach: 'A', html: input.html }]
  const [a, b, ...more] = input.variations
  if (!a || !b || more.length || a.approach !== 'A' || b.approach !== 'B')
    throw new Refused('variations_invalid', ['variations'])
  return [a, b]
}

type Shown = {
  name: string | null
  subject: string | null
  preview: string | null
}
/** A fingerprint of the variations as Klaviyo shows them. */
const fingerprint = (variations: Shown[]) =>
  createHash('sha256')
    .update(
      JSON.stringify(
        variations
          .map((v) => [v.name ?? '', v.subject ?? '', v.preview ?? ''])
          .sort()
      )
    )
    .digest('hex')

/** The client, refusing to start a request that might not end in time. */
function timed(
  client: KlaviyoClient,
  left: () => number,
  callMs: number
): KlaviyoClient {
  const check = () => {
    if (left() < callMs) throw new TimeUp()
  }
  return {
    get: (path, scope) => (check(), client.get(path, scope)),
    next: (url, scope) => (check(), client.next(url, scope)),
    write: (method, path, body, scope) => (
      check(),
      client.write(method, path, body, scope)
    )
  }
}

type Deps = {
  source: PushSource
  store: PushStore
  now?: () => Date
  /** The longest one push may take (default 25 s), each request at most `callMs`. */
  budgetMs?: number
  /** A time (ms since epoch) no push goes past, e.g. its route's end. */
  deadline?: number
  callMs?: number
}

export function liveDraftPusher(deps: Deps): DraftPusher {
  return {
    async createDraft(input) {
      try {
        return await push(input, deps)
      } catch (error) {
        return failed(error, input, deps.store)
      }
    }
  }
}

const refOf = (input: DraftInput): PushRef | null =>
  input.lease
    ? {
        tenantId: input.tenantId,
        key: input.idempotencyKey,
        build: input.lease.build,
        lease: input.lease.token
      }
    : null

async function failed(
  error: unknown,
  input: DraftInput,
  store: PushStore
): Promise<DraftResult> {
  const build = input.lease?.build ?? 'none'
  if (error instanceof TimeUp) {
    logger.info('Klaviyo push paused: out of time; the next run goes on', {
      build
    })
    // Not a failed try: the build waits and the next run goes on from here.
    return { ok: false, code: 'rate_limited', retryAfterSeconds: 30 }
  }
  if (error instanceof Refused) {
    ;(error.reason === 'ab_test_unsafe' ? logger.error : logger.warn)(
      'Klaviyo push refused',
      { build, reason: error.reason, checks: error.checks.join(',') }
    )
    const ref = refOf(input)
    try {
      if (!input.sample && ref)
        await store.save(ref, { state: 'refused', reason: error.reason })
    } catch {
      // The refusal stands without its note.
    }
    return { ok: false, code: 'rejected', checks: error.checks }
  }
  if (error instanceof KlaviyoError) {
    logger.warn('Klaviyo push stopped', {
      build,
      kind: error.kind,
      endpoint: error.details.endpoint,
      status: error.details.status ?? 0,
      code: error.details.code ?? 'none',
      pointer: error.details.pointer ?? 'none'
    })
    if (error.kind === 'bad_key' || error.kind === 'missing_scope')
      return { ok: false, code: 'auth' }
    if (error.kind === 'rate_limited')
      return {
        ok: false,
        code: 'rate_limited',
        retryAfterSeconds: error.details.retryAfterSeconds ?? 60
      }
    if (error.kind === 'rejected') return { ok: false, code: 'rejected' }
    return { ok: false, code: 'unavailable' }
  }
  logger.error('Klaviyo push failed', {
    build,
    name: error instanceof Error ? error.name : 'unknown'
  })
  return { ok: false, code: 'unavailable' }
}

async function push(input: DraftInput, deps: Deps): Promise<DraftResult> {
  const now = deps.now ?? (() => new Date())
  const deadline = Math.min(
    now().getTime() + (deps.budgetMs ?? pushBudgetMs),
    deps.deadline ?? Number.POSITIVE_INFINITY
  )
  // Checked before Klaviyo is called at all.
  if (input.sample) throw new Refused('sample_email', ['sample'])
  const ref = refOf(input)
  if (!ref) throw new Refused('no_push_lease', ['lease'])
  const designs = designsOf(input)
  const before = preflight(
    designs.map((d) => d.html),
    input.audienceId
  )
  if (before) throw new Refused(before.reason, [before.check])

  const live = await deps.source.client(input.tenantId)
  if (!live) return { ok: false, code: 'auth' }
  const callMs = deps.callMs ?? 8_000
  const left = () => deadline - now().getTime()
  const client = timed(live, left, callMs)
  /** Before marking a create as sent: the create itself must fit. */
  const fits = () => {
    if (left() < callMs) throw new TimeUp()
  }

  let p = (await deps.store.load(ref)) ?? { ...empty }
  if (p.state === 'refused' && p.reason === 'externally_modified')
    throw new Refused('externally_modified', ['externally_modified'])
  const save = async (step: PushStep) => {
    await deps.store.save(ref, step)
    // The checks are kept for the record only, not in the progress.
    const { images, ...rest } = step
    delete rest.checks
    p = { ...p, ...rest, images: { ...p.images, ...(images ?? {}) } }
  }
  const close = async (reason: string, check: string): Promise<never> => {
    await save({ state: 'refused', reason }).catch(() => undefined)
    throw new Refused(reason, [check])
  }
  // After Klaviyo refused the even test, this draft stays design A.
  const wanted = p.fallback ? designs.slice(0, 1) : designs
  let made = false

  // 0. A draft made before: still a draft, still ours as we left it; an
  //    A/B test left unverified is made safe before anything else.
  let read: DraftRead | null = null
  if (p.messageId) {
    read = await readDraft(client, p.messageId)
    if (!read)
      return p.written
        ? close('externally_modified', 'externally_modified')
        : // Never read since we made it: Klaviyo may not show it yet.
          { ok: false, code: 'unavailable' }
    if (read.status !== 'draft') throw new Refused('not_a_draft', ['not_draft'])
    if (read.description !== pushMark(ref.key))
      return close('externally_modified', 'externally_modified')
    const shown = fingerprint(read.variations)
    if (p.written && shown !== p.written && shown !== p.target)
      return close('externally_modified', 'externally_modified')
    if (p.ab === 'pending') read = await takeOutB(read, 'ab_test_not_finished')
  } else if (p.campaignId) {
    const parts = await campaignParts(client, p.campaignId)
    if (!parts || parts.description !== pushMark(ref.key))
      return close('externally_modified', 'externally_modified')
  }
  if (p.audienceId && p.audienceId !== input.audienceId)
    throw new Refused('audience_changed', ['audience'])

  // 1. The planned list or segment is in this account (before any write).
  if (!p.campaignId && !(await audienceExists(client, input.audienceId)))
    throw new Refused('audience_not_in_klaviyo', ['audience'])

  // 2. The pictures, into Klaviyo's library.
  let n = Object.keys(p.images).length
  for (const src of [...new Set(wanted.flatMap((d) => imageSources(d.html)))]) {
    if (p.images[src]) continue
    let url: string
    try {
      url = await importImage(client, src, `GROS ${short(ref.key)} ${++n}`)
    } catch (error) {
      if (error instanceof KlaviyoError && error.kind === 'rejected')
        throw new Refused('image_refused', ['images'])
      throw error
    }
    await save({ images: { [src]: url } })
  }
  const htmls = wanted.map((d) => withImages(d.html, p.images))

  // 3. The final checks on exactly the HTML sent.
  const moved = new Set(Object.values(p.images))
  const checks = mergeChecks(htmls.map((h) => finalChecks(h, moved)))
  await save({ checks })
  const failing = checks.filter((c) => !c.pass).map((c) => c.id)
  if (failing.length) throw new Refused('final_checks', failing)

  // 4. One template per design: none when its variation already shows
  //    this design; one whose answer was lost is found by its name.
  const templates: PushTemplate[] = []
  for (const [i, d] of wanted.entries()) {
    const hash = htmlHash(htmls[i]!)
    const onVariation = read?.variations.map((v) => v.id) ?? []
    let t =
      p.templates.find(
        (x) =>
          x.approach === d.approach &&
          x.hash === hash &&
          !!x.variation &&
          onVariation.includes(x.variation)
      ) ??
      p.templates.find(
        (x) => x.approach === d.approach && x.hash === hash && !x.deleted
      )
    if (!t) {
      const name = templateName(ref.key, d.approach, hash)
      let id: string | null = null
      if (p.templateStartedAt)
        id = await findTemplate(
          client,
          name,
          new Date(Date.parse(p.templateStartedAt) - findSlackMs)
        ).catch((error) => {
          // Without template read access a lost template stays behind.
          if (error instanceof KlaviyoError && error.kind === 'missing_scope')
            return null
          throw error
        })
      if (!id) {
        fits()
        await save({ templateStartedAt: now().toISOString() })
        id = await createTemplate(client, name, htmls[i]!)
      }
      t = { approach: d.approach, id, hash, deleted: false, variation: null }
      await save({ templates: [...p.templates, t], templateStartedAt: null })
    }
    templates.push(t)
  }
  const contents: VariationContent[] = wanted.map((d, i) => ({
    name: designName(d.approach),
    subject: input.subject,
    preview: input.preheader,
    templateId: templates[i]!.id
  }))

  // 5. The campaign, made once (found again if its answer was lost).
  if (!p.campaignId) {
    if (p.createStartedAt) {
      const found = await findOwnCampaign(client, {
        name: input.name,
        description: pushMark(ref.key),
        since: new Date(Date.parse(p.createStartedAt) - findSlackMs)
      }).catch((error) => {
        // A refused search is retried, never taken as "not there".
        if (error instanceof KlaviyoError && error.kind === 'rejected')
          throw new KlaviyoError('unavailable', error.details)
        throw error
      })
      if (found === 'ambiguous')
        throw new Refused('campaign_ambiguous', ['campaign'])
      if (found) await save({ campaignId: found })
    }
    if (!p.campaignId) {
      fits()
      // Only the first create starts the search window.
      if (!p.createStartedAt)
        await save({
          createStartedAt: now().toISOString(),
          audienceId: input.audienceId
        })
      const campaignId = await createCampaign(client, {
        name: input.name,
        description: pushMark(ref.key),
        audienceId: input.audienceId,
        timezone: await deps.source.timezone(input.tenantId)
      })
      await save({ campaignId, audienceId: input.audienceId })
    }
  }

  // 6. Its message, with design A (one Klaviyo made itself is used).
  if (!p.messageId) {
    const parts = await campaignParts(client, p.campaignId!)
    if (!parts) return { ok: false, code: 'unavailable' }
    if (parts.messageIds.length > 1)
      throw new Refused('campaign_ambiguous', ['campaign'])
    let messageId = parts.messageIds[0]
    if (!messageId) {
      if (!parts.audienceRef)
        throw new KlaviyoError('invalid_response', {
          endpoint: '/api/campaigns/'
        })
      messageId = await createMessage(client, {
        campaignId: p.campaignId!,
        audienceRef: parts.audienceRef,
        name: input.name,
        variation: contents[0]!
      })
      made = true
    }
    await save({ messageId })
    read = await readDraft(client, messageId)
    // Just made: Klaviyo may not show it yet.
    if (!read) return { ok: false, code: 'unavailable' }
    if (made) {
      const a = read.variations[0]
      if (read.variations.length !== 1 || !a)
        throw new KlaviyoError('invalid_response', {
          endpoint: '/api/campaign-messages/'
        })
      await applied(templates[0]!.id, a.id)
    }
    await save({ written: fingerprint(read.variations) })
  }
  if (!read)
    throw new KlaviyoError('invalid_response', {
      endpoint: '/api/campaign-messages/'
    })
  const messageId = p.messageId!

  // Which variation is which design: as recorded, else by our names, else
  // the one variation of a message we just took over.
  const recorded = (approach: 'A' | 'B') =>
    [...p.templates]
      .reverse()
      .find((t) => t.approach === approach && t.variation)?.variation ?? null
  const variationOf = (approach: 'A' | 'B') =>
    read!.variations.find((v) => v.id === recorded(approach)) ??
    read!.variations.find((v) => v.name === designName(approach)) ??
    (approach === 'A' && read!.variations.length === 1 && !recorded('A')
      ? read!.variations[0]
      : undefined)
  const known = new Set(
    (['A', 'B'] as const).map((a) => variationOf(a)?.id).filter(Boolean)
  )
  if (read.variations.some((v) => !known.has(v.id)))
    return close('externally_modified', 'externally_modified')

  // 7. Design A takes this content.
  const shown = read.variations.map((v) => ({ ...v }))
  const wrote = async (change: () => void) => {
    change()
    await save({ written: fingerprint(shown) })
  }
  // Where this push takes the variations: a push stopped half way is
  // recognised by it, never taken for a change made in Klaviyo.
  await save({
    target: fingerprint(
      contents.map((c) => ({
        name: c.name,
        subject: c.subject,
        preview: c.preview
      }))
    )
  })
  const a = variationOf('A')!
  if (!showing(a, contents[0]!, templates[0]!)) {
    await updateVariation(client, a.id, contents[0]!)
    await applied(templates[0]!.id, a.id)
    await wrote(() =>
      Object.assign(
        shown.find((v) => v.id === a.id)!,
        contents[0]
      )
    )
  }

  // 8. Design B: added, then the even test set and read back; on any
  //    failure before it is verified, taken out again.
  const b = variationOf('B')
  if (wanted.length === 2) {
    const needsWork =
      !b ||
      !showing(b, contents[1]!, templates[1]!) ||
      read.winnerPercentage !== 0
    // The test is made in one go (B, the even split, the read back), so it
    // starts only with time for two requests; then it runs without the
    // per-request check, as taking B out again would.
    if (needsWork && left() < 2 * callMs) throw new TimeUp()
    const ab = live
    try {
      if (b) {
        if (!showing(b, contents[1]!, templates[1]!)) {
          await save({ ab: 'pending' })
          await updateVariation(ab, b.id, contents[1]!)
          await applied(templates[1]!.id, b.id)
          await wrote(() =>
            Object.assign(
              shown.find((v) => v.id === b.id)!,
              contents[1]
            )
          )
        }
      } else {
        await save({ ab: 'pending' })
        const id = await addVariation(ab, messageId, contents[1]!)
        await applied(templates[1]!.id, id)
        await wrote(() => shown.push({ id, ...contents[1]!, templateId: null }))
      }
      read = await readDraft(ab, messageId)
      if (!read)
        throw new KlaviyoError('unavailable', {
          endpoint: '/api/campaign-messages/'
        })
      if (read.winnerPercentage !== 0) {
        await save({ ab: 'pending' })
        await setEvenTest(ab, messageId)
        read = await readDraft(ab, messageId)
        if (!read)
          throw new KlaviyoError('unavailable', {
            endpoint: '/api/campaign-messages/'
          })
      }
      if (read.winnerPercentage !== 0 || read.variations.length !== 2)
        throw new Refused('ab_test_not_kept', ['ab_test'])
      await save({ ab: 'verified', designs: 'both' })
    } catch (error) {
      if (error instanceof Refused && error.reason === 'ab_test_unsafe')
        throw error
      const reason =
        error instanceof KlaviyoError && error.kind === 'rejected'
          ? 'ab_test_refused'
          : error instanceof Refused
            ? error.reason
            : 'ab_test_not_finished'
      const current = (await readDraft(live, messageId)) ?? read
      if (!current) throw error
      read = await takeOutB(current, reason)
      // Klaviyo refused or changed the test: this draft is design A from now.
      if (reason === 'ab_test_refused' || reason === 'ab_test_not_kept') {
        await save({ designs: 'A', fallback: reason })
        logger.warn('Klaviyo push: only design A went in', {
          build: ref.build,
          reason
        })
      } else throw error
    }
  } else if (b) {
    // One design asked for: a design B left from before is taken out.
    read = await takeOutB(read, p.fallback ?? 'one_design')
  }

  // 9. Our templates, once each variation keeps Klaviyo's own copy.
  const kept: PushTemplate[] = []
  const all = read.variations.every((v) => v.templateId)
  for (const t of p.templates) {
    if (
      t.deleted ||
      !all ||
      read.variations.some((v) => v.templateId === t.id)
    ) {
      kept.push(t)
      continue
    }
    try {
      await deleteTemplate(client, t.id)
    } catch (error) {
      // Gone already, or refused: it is left; anything else is tried again.
      if (!(error instanceof KlaviyoError && error.kind === 'rejected'))
        throw error
      logger.warn('Klaviyo push: a template was left', { build: ref.build })
    }
    kept.push({ ...t, deleted: true })
  }
  // Deleted ones are kept only while a variation still shows them.
  const pruned = kept.filter(
    (t) => !t.deleted || read!.variations.some((v) => v.id === t.variation)
  )

  await save({
    state: 'drafted',
    templates: pruned,
    designs: p.designs ?? (wanted.length === 2 ? 'both' : 'A'),
    written: fingerprint(read.variations),
    target: null,
    reason: null
  })
  logger.info('Klaviyo draft ready', {
    build: ref.build,
    designs: p.designs ?? 'A',
    fallback: p.fallback ?? 'none',
    pictures: Object.keys(p.images).length
  })
  return {
    ok: true,
    campaignId: p.campaignId!,
    sample: false,
    ...(input.variations ? { designs: p.designs ?? 'A' } : {})
  }

  /** The variation already shows this design (our template, put on it). */
  function showing(
    v: {
      id: string
      name: string | null
      subject: string | null
      preview: string | null
    },
    c: VariationContent,
    t: PushTemplate
  ) {
    const now = p.templates.find((x) => x.id === t.id) ?? t
    return (
      now.variation === v.id &&
      v.name === c.name &&
      v.subject === c.subject &&
      v.preview === c.preview
    )
  }

  async function applied(templateId: string, variation: string) {
    await save({
      templates: p.templates.map((t) =>
        t.id === templateId ? { ...t, variation } : t
      )
    })
  }

  /**
   * Design B out of our draft, with no time check (it makes the draft
   * safe), and one variation, design A, checked to remain; else refused.
   */
  async function takeOutB(r: DraftRead, why: string) {
    const msg = p.messageId!
    const a =
      r.variations.find((v) => v.id === recorded('A')) ??
      r.variations.find((v) => v.name === designName('A'))
    for (const v of r.variations)
      if (a && v.id !== a.id) {
        try {
          await deleteVariation(live!, v.id)
        } catch (error) {
          if (!(error instanceof KlaviyoError && error.kind === 'rejected'))
            throw error
        }
      }
    const after = await readDraft(live!, msg)
    if (
      !after ||
      after.variations.length !== 1 ||
      after.variations[0]!.id !== a?.id
    ) {
      logger.error('Klaviyo push: design B could not be taken out', {
        build: ref!.build,
        why
      })
      throw new Refused('ab_test_unsafe', ['ab_test'])
    }
    await save({
      ab: null,
      written: fingerprint(after.variations),
      target: null
    })
    return after
  }
}

/** The checks of each design, as one list (a problem names its design). */
function mergeChecks(perDesign: FinalCheck[][]): FinalCheck[] {
  const ids = perDesign[0]!.map((c) => c.id)
  return ids.map((id) => {
    const problems = perDesign.flatMap((checks, i) =>
      (checks.find((c) => c.id === id)?.problems ?? []).map((p) =>
        perDesign.length > 1 ? `Design ${i ? 'B' : 'A'}: ${p}` : p
      )
    )
    // At most 10 problems a check, each in a line (what the store keeps).
    return {
      id,
      pass: problems.length === 0,
      problems: problems.slice(0, 10).map((x) => x.slice(0, 280))
    }
  })
}
