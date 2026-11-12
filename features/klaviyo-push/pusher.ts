import 'server-only'
import { createHash } from 'node:crypto'
import { logger } from '@/lib/logger'
import {
  KlaviyoError,
  type KlaviyoClient
} from '@/lib/providers/klaviyo/client'
import {
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
  templateHtml,
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
 * audience is checked in the account; the pictures are imported into
 * Klaviyo's library and the HTML points at them (VISION rule 11); the
 * final checks run on exactly the HTML sent; each design becomes an HTML
 * template; the campaign is made with its audience, then its message. For
 * an A/B design test (EML-005) the message is made in ONE request with both
 * designs and an even test with no winner, read back at once, so a draft
 * never exists with two designs and Klaviyo's own A/B settings; if Klaviyo
 * refuses that, the message is made with design A alone, and if it does
 * not keep the even test (then, or after a later change), design B is
 * taken out at once. Either way the answer says only design A went in.
 * Which variation is design A is saved from Klaviyo's answer to the
 * create. An A/B draft not yet seen safe is checked before anything else
 * on the next run, and Klaviyo being unwell then only makes the build
 * wait. A push that cannot make the draft safe is refused
 * (`ab_test_unsafe`) and logged as an error.
 *
 * Every step is saved as it is made (`PushStore`, under the build's push
 * lease), so a push that stops goes on where it was and never makes a
 * second picture, template, campaign or message. The same key again
 * updates the draft to this content; a draft the owner scheduled, sent,
 * deleted or changed in Klaviyo (a subject, a preview, the A/B test, its
 * mark) is never touched (`rejected`).
 *
 * It never throws: Klaviyo's answers become the port's codes.
 */

export type PushTemplate = {
  approach: 'A' | 'B'
  id: string
  hash: string
  deleted: boolean
  /** The variation it is on now (one template per design at a time). */
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
  /** When a message create was sent and not yet saved. */
  messageStartedAt: string | null
  /** When a template create was sent and not yet saved. */
  templateStartedAt: string | null
  /** When Klaviyo first answered a delete of design B it did not show done. */
  deleteAnsweredAt: string | null
  /** The list or segment the campaign was made for. */
  audienceId: string | null
  designs: 'both' | 'A' | null
  fallback: string | null
  /** `pending`: an A/B message was sent for and not yet seen safe. */
  ab: 'pending' | 'verified' | null
  reason: string | null
  /** Fingerprints of the variations after our last write, and where we take them. */
  written: string | null
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
  messageStartedAt: null,
  templateStartedAt: null,
  deleteAnsweredAt: null,
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
/** Klaviyo may still be making what we asked for: come back, never ask twice. */
class Wait extends Error {}

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
export const pushBudgetMs = 30_000
/** A create whose answer was lost is looked for from a minute before. */
const findSlackMs = 60_000
/** A create whose answer was lost may take this long to show. */
const showMs = 120_000
/** A delete Klaviyo answered is waited for this long to show, then given up. */
const deleteShowMs = 10 * 60_000

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

/** Text as Klaviyo may keep it: trimmed, each run of spaces as one. */
const norm = (s: string | null | undefined) =>
  (s ?? '').trim().replace(/\s+/g, ' ')
/** One variation's fingerprint: what a reader sees of it (subject, preview). */
const seen = (v: { subject: string | null; preview: string | null }) =>
  createHash('sha256')
    .update(JSON.stringify([norm(v.subject), norm(v.preview)]))
    .digest('hex')
    .slice(0, 16)
const fingerprints = (
  vs: { subject: string | null; preview: string | null }[]
) => [...new Set(vs.map(seen))].sort().join(',')
const setOf = (s: string | null) => new Set(s ? s.split(',') : [])

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
    ),
    query: (path, body, scope) => (check(), client.query(path, body, scope))
  }
}

type Deps = {
  source: PushSource
  store: PushStore
  now?: () => Date
  /** The longest one push may take (default 30 s), each request at most `callMs`. */
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
  if (error instanceof TimeUp || error instanceof Wait) {
    logger.info('Klaviyo push paused; the next run goes on', {
      build,
      why: error instanceof Wait ? 'klaviyo_catching_up' : 'out_of_time'
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

/** A refused search or lookup is tried again, never taken as "not there". */
const retried = (error: unknown): never => {
  if (error instanceof KlaviyoError && error.kind === 'rejected')
    throw new KlaviyoError('unavailable', error.details)
  throw error
}

async function push(input: DraftInput, deps: Deps): Promise<DraftResult> {
  const now = deps.now ?? (() => new Date())
  const started = now().getTime()
  const deadline = Math.min(
    started + (deps.budgetMs ?? pushBudgetMs),
    deps.deadline ?? Number.POSITIVE_INFINITY
  )
  // Checked before Klaviyo is called at all.
  if (input.sample) throw new Refused('sample_email', ['sample'])
  const ref = refOf(input)
  if (!ref) throw new Refused('no_push_lease', ['lease'])

  const live = await deps.source.client(input.tenantId)
  if (!live) return { ok: false, code: 'auth' }
  const callMs = deps.callMs ?? 6_000
  const left = () => deadline - now().getTime()
  const client = timed(live, left, callMs)
  /** Before marking a create as sent: everything it may need must fit. */
  const fits = (requests: number) => {
    if (left() < requests * callMs) throw new TimeUp()
  }
  const ago = (iso: string | null) =>
    iso ? now().getTime() - Date.parse(iso) : Number.POSITIVE_INFINITY

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
  const close = async (r?: DraftRead | null): Promise<never> => {
    // Left as Klaviyo shows it: loud when that is two designs with a winner.
    if (r && r.variations.length === 2 && r.winnerPercentage !== 0)
      logger.error('Klaviyo push: closed with two designs and a winner set', {
        build: ref.build
      })
    await save({ state: 'refused', reason: 'externally_modified' }).catch(
      () => undefined
    )
    throw new Refused('externally_modified', ['externally_modified'])
  }
  /** A design's variation as recorded when made, else by our name. */
  const named = (r: DraftRead, approach: 'A' | 'B') => {
    const id = p.templates.find(
      (t) => t.approach === approach && t.variation
    )?.variation
    return (
      r.variations.find((v) => v.id === id) ??
      r.variations.find((v) => v.name === designName(approach))
    )
  }
  /**
   * Which variation is which design: as recorded when made (from Klaviyo's
   * answer to the create), else by our name, else by what it shows (its
   * template's HTML is one of ours). Never by the order Klaviyo lists them.
   */
  const identify = async (r: DraftRead, via: KlaviyoClient) => {
    let a = named(r, 'A')
    let b = named(r, 'B')
    if (b && b.id === a?.id) b = undefined
    if (r.variations.length === 2 && (!a || !b))
      for (const v of r.variations) {
        if (v.id === a?.id || v.id === b?.id || !v.templateId) continue
        // A template Klaviyo no longer has reads as null; any other
        // failure is Klaviyo's, and the push tries again.
        const html = await templateHtml(via, v.templateId)
        const t =
          html === null
            ? undefined
            : p.templates.find((x) => x.hash === htmlHash(html))
        if (t?.approach === 'A' && !a) a = v
        else if (t?.approach === 'B' && !b) b = v
      }
    return { a, b }
  }
  /** After a failure on an A/B draft not yet seen safe: one try to make it safe. */
  const makeSafe = async (mid: string) => {
    try {
      const r = await readDraft(live, mid)
      if (r && p.ab === 'pending') await settle(r)
    } catch {
      logger.error(
        'Klaviyo push: an A/B draft could not be made safe after a failure',
        { build: ref.build }
      )
    }
  }
  /**
   * Work on an A/B draft not yet seen safe: Klaviyo being unwell never
   * fails the build; it waits, and the next run checks that draft first.
   */
  const whilePending = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work()
    } catch (error) {
      if (
        p.ab === 'pending' &&
        error instanceof KlaviyoError &&
        error.kind !== 'bad_key' &&
        error.kind !== 'missing_scope' &&
        // Klaviyo's own wait is already a wait, with its time.
        error.kind !== 'rate_limited'
      ) {
        logger.error(
          'Klaviyo push: an A/B draft not yet seen safe waits for Klaviyo',
          { build: ref.build, kind: error.kind }
        )
        throw new Wait()
      }
      throw error
    }
  }

  // 0. A draft made before: an A/B message not yet seen safe is made safe
  //    first; then it must still be a draft, ours, as we left it.
  let read: DraftRead | null = null
  let parts: Awaited<ReturnType<typeof campaignParts>> = null
  if (p.ab === 'pending' && !p.messageId && p.campaignId) {
    // An A/B message sent for whose answer was lost: found in its campaign
    // first, whatever the time.
    const cid = p.campaignId
    parts = await whilePending(() => campaignParts(live, cid))
    if (!parts) {
      if (ago(p.createStartedAt) < 10 * 60_000) throw new Wait()
      return close()
    }
    if (parts.description !== pushMark(ref.key)) return close()
    if (parts.messageIds.length > 1) {
      logger.error('Klaviyo push: an A/B draft has more than one message', {
        build: ref.build
      })
      throw new Refused('campaign_ambiguous', ['campaign'])
    }
    const found = parts.messageIds[0]
    if (found) await save({ messageId: found, messageStartedAt: null })
    else if (ago(p.messageStartedAt) < showMs) throw new Wait()
    // Never made: nothing to make safe.
    else await save({ ab: null })
  }
  if (p.messageId) {
    const mid = p.messageId
    // Untimed: an A/B message not yet seen safe is checked whatever the time.
    read =
      p.ab === 'pending'
        ? await whilePending(() => readDraft(live, mid))
        : await readDraft(client, mid)
    if (!read) {
      if (p.ab === 'pending') {
        logger.error(
          'Klaviyo push: an A/B draft could not be read to check it is safe',
          { build: ref.build }
        )
        throw new Wait()
      }
      // Never read since we made it: Klaviyo may not show it yet.
      if (!p.written) throw new Wait()
      return close()
    }
    if (read.status !== 'draft') {
      if (p.ab === 'pending')
        logger.error(
          'Klaviyo push: an A/B draft not yet seen safe was scheduled',
          { build: ref.build }
        )
      throw new Refused('not_a_draft', ['not_draft'])
    }
    if (read.description !== pushMark(ref.key)) return close(read)
    // An owner's change is looked for on the draft as found, before any
    // of ours (taking design B out to make it safe comes first).
    const allowed = new Set([...setOf(p.written), ...setOf(p.target)])
    // What we sent counts too: a draft never read back since its create.
    const changed =
      (!!p.written || !!p.target) &&
      read.variations.some((v) => !allowed.has(seen(v)))
    if (p.ab === 'pending') read = await settle(read)
    if (changed) return close(read)
    if (
      p.ab === 'verified' &&
      read.variations.length === 2 &&
      read.winnerPercentage !== 0
    )
      return close(read)
  } else if (p.campaignId && !parts) {
    parts = await campaignParts(client, p.campaignId)
    if (!parts) {
      if (ago(p.createStartedAt) < 10 * 60_000) throw new Wait()
      return close()
    }
    if (parts.description !== pushMark(ref.key)) return close()
  }
  // The build's content checks (QAG-001) must have passed.
  if (input.contentChecked !== true)
    throw new Refused('content_not_checked', ['release_qa'])
  const designs = designsOf(input)
  const before = preflight(
    designs.map((d) => d.html),
    input.audienceId
  )
  if (before) throw new Refused(before.reason, [before.check])
  if (p.audienceId && p.audienceId !== input.audienceId)
    throw new Refused('audience_changed', ['audience'])
  // A draft made with one design (or after Klaviyo refused the even test)
  // stays one design: design B is only ever made together with its test.
  const madeAlone = !!p.fallback || (!!read && read.variations.length === 1)
  const wanted = madeAlone ? designs.slice(0, 1) : [...designs]

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
  const hashes = htmls.map(htmlHash)

  // 3. The final checks on exactly the HTML sent.
  const moved = new Set(Object.values(p.images))
  const checks = mergeChecks(htmls.map((h) => finalChecks(h, moved)))
  await save({ checks })
  const failing = checks.filter((c) => !c.pass).map((c) => c.id)
  if (failing.length) throw new Refused('final_checks', failing)

  /** A template of this design (never one already deleted). */
  const templateFor = async (i: number) => {
    const approach = wanted[i]!.approach
    const found = p.templates.find(
      (t) => t.approach === approach && t.hash === hashes[i] && !t.deleted
    )
    if (found) return found
    const name = templateName(ref.key, approach, hashes[i]!)
    let id: string | null = null
    if (p.templateStartedAt)
      id = await findTemplate(
        client,
        name,
        new Date(Date.parse(p.templateStartedAt) - findSlackMs),
        new Set(p.templates.filter((t) => t.deleted).map((t) => t.id))
      ).catch((error) => {
        // Without template read access a lost template stays behind.
        if (error instanceof KlaviyoError && error.kind === 'missing_scope')
          return null
        return retried(error)
      })
    if (!id) {
      fits(1)
      await save({ templateStartedAt: now().toISOString() })
      id = await createTemplate(client, name, htmls[i]!)
    }
    const t: PushTemplate = {
      approach,
      id,
      hash: hashes[i]!,
      deleted: false,
      variation: null
    }
    await save({ templates: [...p.templates, t], templateStartedAt: null })
    return t
  }
  /**
   * Template `t` deleted from Klaviyo: marked deleted first, so a delete
   * whose answer was lost is never followed by sending that template.
   */
  const removed = async (t: PushTemplate) => {
    await save({
      templates: p.templates.map((x) =>
        x.id === t.id ? { ...x, deleted: true } : x
      )
    })
    await deleteTemplate(client, t.id).catch((error) => {
      if (!(
        error instanceof KlaviyoError &&
        error.kind === 'rejected' &&
        error.details.status === 404
      ))
        logger.warn('Klaviyo push: a template may be left in Klaviyo', {
          build: ref.build
        })
    })
    return true
  }
  /** Template `t` is now on `variation` (and no other template of its design). */
  const applied = (t: PushTemplate, variation: string) =>
    save({
      templates: p.templates.map((x) =>
        x.id === t.id
          ? { ...x, variation }
          : x.approach === t.approach && x.variation === variation
            ? { ...x, variation: null }
            : x
      )
    })
  const content = (i: number, templateId: string): VariationContent => ({
    name: designName(wanted[i]!.approach),
    subject: input.subject,
    preview: input.preheader,
    templateId
  })

  // 4. Each design's template, then the campaign, made once (found again
  //    if its answer was lost), as Step 0 did.
  const templates: PushTemplate[] = []
  if (!p.messageId)
    for (const i of wanted.keys()) templates.push(await templateFor(i))
  if (!p.campaignId) {
    if (p.createStartedAt) {
      const found = await findOwnCampaign(client, {
        name: input.name,
        description: pushMark(ref.key),
        since: new Date(Date.parse(p.createStartedAt) - findSlackMs)
      }).catch(retried)
      if (found === 'ambiguous')
        throw new Refused('campaign_ambiguous', ['campaign'])
      if (found) await save({ campaignId: found })
      // Not there yet: Klaviyo may still show it; never make a second one.
      else if (ago(p.createStartedAt) < showMs) throw new Wait()
    }
    if (!p.campaignId) {
      fits(1)
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

  // 5. Its message, made once, in one request with its designs: an A/B
  //    message has both and the even test, and is checked safe at once.
  if (!p.messageId) {
    parts = parts ?? (await campaignParts(client, p.campaignId!))
    if (!parts) throw new Wait()
    if (parts.messageIds.length > 1)
      throw new Refused('campaign_ambiguous', ['campaign'])
    const existing = parts.messageIds[0]
    if (existing) {
      // A message whose answer was lost, or one Klaviyo made itself: it is
      // taken over. Ours with both designs is checked safe first; any
      // other keeps one design.
      await save({ messageId: existing, messageStartedAt: null })
      const taken =
        p.ab === 'pending'
          ? await whilePending(() => readDraft(live, existing))
          : await readDraft(client, existing)
      if (!taken) throw new Wait()
      read = taken
      if (p.ab === 'pending') read = await settle(read)
      else if (wanted.length === 2) {
        await save({ designs: 'A', fallback: 'message_taken_over' })
        logger.warn('Klaviyo push: only design A went in', {
          build: ref.build,
          reason: 'message_taken_over'
        })
      }
      if (p.fallback) wanted.splice(1)
    } else {
      // A message sent for may still appear: never make a second one.
      if (ago(p.messageStartedAt) < showMs) throw new Wait()
      // The create and its read back must fit (they run without the
      // per-request check); making an unsafe A/B draft safe, when needed,
      // may run up to four requests past the end (the route leaves room).
      fits(2)
      await save({
        messageStartedAt: now().toISOString(),
        target: fingerprints(wanted.map((_, i) => content(i, ''))),
        ...(wanted.length === 2 ? { ab: 'pending' as const } : {})
      })
      let made: Awaited<ReturnType<typeof createMessage>>
      try {
        made = await createMessage(live, {
          campaignId: p.campaignId!,
          audienceRef: parts.audienceRef ?? '',
          name: input.name,
          variations: templates.map((t, i) => content(i, t.id))
        })
      } catch (error) {
        if (error instanceof KlaviyoError && error.kind === 'rate_limited') {
          // Not made: sent again once Klaviyo allows, with no wait to show.
          await save({ messageStartedAt: null, ab: null })
          throw error
        }
        if (wanted.length !== 2) throw error
        if (!(error instanceof KlaviyoError && error.kind === 'rejected')) {
          // The message may be there: the next run finds it, checks it first.
          if (
            error instanceof KlaviyoError &&
            error.kind !== 'bad_key' &&
            error.kind !== 'missing_scope'
          )
            throw new Wait()
          throw error
        }
        // Klaviyo refused the message with its test: design A alone.
        await save({ ab: null, designs: 'A', fallback: 'ab_test_refused' })
        logger.warn('Klaviyo push: only design A went in', {
          build: ref.build,
          reason: 'ab_test_refused'
        })
        wanted.splice(1)
        made = await createMessage(live, {
          campaignId: p.campaignId!,
          audienceRef: parts.audienceRef ?? '',
          name: input.name,
          variations: [content(0, templates[0]!.id)]
        })
      }
      // Each design's variation as Klaviyo's answer lists them (in the
      // order sent), saved with the message, so design A is known even
      // when Klaviyo renames them and the read back fails.
      const { messageId, variationIds } = made
      const sent = templates.slice(0, wanted.length).map((t) => t.id)
      await save({
        messageId,
        messageStartedAt: null,
        templates: p.templates.map((t) =>
          sent.includes(t.id) && variationIds[sent.indexOf(t.id)]
            ? { ...t, variation: variationIds[sent.indexOf(t.id)]! }
            : t
        )
      })
      const back = await whilePending(() => readDraft(live, messageId))
      if (!back) {
        if (p.ab === 'pending')
          logger.error(
            'Klaviyo push: an A/B draft could not be read to check it is safe',
            { build: ref.build }
          )
        throw new Wait()
      }
      read = back
      // Each design's variation where the answer did not say (by our name,
      // else by what it shows).
      const found = await whilePending(() => identify(back, live))
      for (const [i, id] of sent.entries()) {
        const recorded = p.templates.find((t) => t.id === id)!
        const v =
          i === 0
            ? (found.a ??
              (read.variations.length === 1 ? read.variations[0] : undefined))
            : found.b
        if (v && v.id !== recorded.variation) await applied(recorded, v.id)
      }
      if (p.ab === 'pending') read = await settle(read)
      if (p.fallback) wanted.splice(1)
      await save({ written: fingerprints(read.variations) })
    }
  }
  if (!read)
    throw new KlaviyoError('invalid_response', {
      endpoint: '/api/campaign-messages/'
    })
  const messageId = p.messageId!

  // 6. Each design's variation shows this content (written only where it
  //    does not), then read back.
  const found = await identify(read, client)
  const a =
    found.a ?? (read.variations.length === 1 ? read.variations[0] : undefined)
  const b = wanted.length === 2 ? found.b : undefined
  if (!a || (wanted.length === 2 && !b)) {
    // Not a change in Klaviyo for sure: refused, and a later push looks again.
    logger.warn('Klaviyo push: the designs could not be told apart', {
      build: ref.build
    })
    throw new Refused('designs_unknown', ['ab_test'])
  }
  // A variation neither design: design B of a draft now pushed with one
  // design is taken out; anything else was made in Klaviyo.
  const others = read.variations.filter((v) => v.id !== a.id && v.id !== b?.id)
  if (others.length) {
    if (others.some((v) => v.id !== found.b?.id)) return close(read)
    read = await takeOutB(read, a, false)
  }
  await save({
    target: fingerprints([
      ...read.variations,
      ...wanted.map((_, i) => content(i, ''))
    ])
  })
  let wrote = false
  try {
    for (const [i, v] of [a, b].entries()) {
      if (!v || i >= wanted.length) continue
      const on = p.templates.find((t) => t.variation === v.id)
      const same = on?.hash === hashes[i]
      if (
        same &&
        norm(v.subject) === norm(input.subject) &&
        norm(v.preview) === norm(input.preheader)
      )
        continue
      // A change may reset the even test: two designs are checked again.
      if (wanted.length === 2 && p.ab !== 'pending')
        await save({ ab: 'pending' })
      // The same design: the template the variation shows (Klaviyo's copy)
      // is kept; a new design gets its own template.
      const t = same && v.templateId ? null : await templateFor(i)
      await updateVariation(client, v.id, content(i, t?.id ?? v.templateId!))
      if (t) await applied(t, v.id)
      wrote = true
    }
  } catch (error) {
    // Stopped half way on a two-design draft: made safe before the answer
    // (a run that only ran out of time checks it first next run).
    if (!(error instanceof Wait) && !(error instanceof TimeUp))
      await makeSafe(messageId)
    throw error
  }
  if (wrote) {
    const after = await whilePending(() => readDraft(client, messageId))
    if (!after) throw new Wait()
    read = after
    if (p.ab === 'pending') read = await settle(read)
    if (p.fallback) wanted.splice(1)
    await save({ written: fingerprints(read.variations) })
  }

  // 7. Our templates: one a variation shows once Klaviyo's copy there is
  //    checked to be ours, and one no variation uses (design B after the
  //    fallback, an older design). A failure here never fails the draft.
  const kept: PushTemplate[] = []
  for (const t of p.templates) {
    const shown = read.variations.find((v) => v.id === t.variation)
    let gone = t.deleted
    const unused = !shown && !read.variations.some((v) => v.templateId === t.id)
    if (!gone && unused) gone = left() >= 2 * callMs && (await removed(t))
    else if (
      !gone &&
      shown?.templateId &&
      shown.templateId !== t.id &&
      left() >= 3 * callMs
    ) {
      const html = await templateHtml(client, shown.templateId).catch(
        () => null
      )
      if (html !== null && htmlHash(html) === t.hash) gone = await removed(t)
      else if (html === null)
        logger.warn('Klaviyo push: a template was left for now', {
          build: ref.build
        })
    }
    // Deleted ones are kept only while a variation shows their design.
    if (!gone || shown) kept.push({ ...t, deleted: gone })
  }

  await save({
    state: 'drafted',
    templates: kept,
    designs: wanted.length === 2 ? 'both' : 'A',
    ab: wanted.length === 2 ? 'verified' : null,
    written: fingerprints(read.variations),
    target: null,
    reason: null
  })
  logger.info('Klaviyo draft ready', {
    build: ref.build,
    designs: wanted.length === 2 ? 'both' : 'A',
    fallback: p.fallback ?? 'none',
    pictures: Object.keys(p.images).length
  })
  return {
    ok: true,
    campaignId: p.campaignId!,
    sample: false,
    ...(input.variations
      ? { designs: wanted.length === 2 ? ('both' as const) : ('A' as const) }
      : {})
  }

  /**
   * An A/B message seen once: safe with two variations and no winner;
   * otherwise design B is taken out (design A from now on).
   */
  async function settle(r: DraftRead) {
    return whilePending(async () => {
      if (
        !p.fallback &&
        r.variations.length === 2 &&
        r.winnerPercentage === 0
      ) {
        await save({ ab: 'verified', designs: 'both' })
        return r
      }
      const { a } = await identify(r, live!)
      const keep =
        a ?? (r.variations.length === 1 ? r.variations[0] : undefined)
      if (!keep) {
        // Neither design is known: no winner at least, then refused.
        if (r.variations.length === 2)
          await setEvenTest(live!, p.messageId!).catch(() => undefined)
        logger.error(
          'Klaviyo push: design A could not be told apart in an A/B draft',
          { build: ref!.build }
        )
        throw new Refused('ab_test_unsafe', ['ab_test'])
      }
      return takeOutB(r, keep, true)
    })
  }

  /**
   * Every variation but `keep` (design A) out of our draft, with no time
   * check (it makes the draft safe), and one variation, design A, checked
   * to remain. When settling an A/B draft, design A is the answer from
   * the first delete that went through. A delete Klaviyo answered but does
   * not show yet sets the even test meanwhile and waits; one it refuses
   * has the even test set as a last resort; else the push is refused
   * (`ab_test_unsafe`).
   */
  async function takeOutB(
    r: DraftRead,
    keep: DraftRead['variations'][number],
    settling: boolean
  ) {
    const mid = p.messageId!
    let refusedDelete = false
    for (const v of r.variations)
      if (v.id !== keep.id)
        await deleteVariation(live!, v.id).catch((error) => {
          if (!(error instanceof KlaviyoError && error.kind === 'rejected'))
            throw error
          refusedDelete = true
        })
    if (settling && !refusedDelete && !p.fallback) {
      await save({ designs: 'A', fallback: 'ab_test_not_kept' })
      logger.warn('Klaviyo push: only design A went in', {
        build: ref!.build,
        reason: 'ab_test_not_kept'
      })
    }
    let after = await readDraft(live!, mid)
    if (
      after &&
      after.variations.length === 1 &&
      after.variations[0]!.id === keep.id
    ) {
      await save({
        ab: null,
        written: fingerprints(after.variations),
        ...(p.deleteAnsweredAt ? { deleteAnsweredAt: null } : {})
      })
      return after
    }
    if (
      after &&
      after.variations.length > 1 &&
      after.variations.some((v) => v.id === keep.id)
    ) {
      if (!refusedDelete) {
        // Klaviyo answered the delete and still shows design B: the even
        // test meanwhile (no harm once B goes); the next run looks again.
        await setEvenTest(live!, mid).catch(() => undefined)
        if (!p.deleteAnsweredAt)
          await save({ deleteAnsweredAt: now().toISOString() })
        if (ago(p.deleteAnsweredAt) < deleteShowMs) {
          logger.error('Klaviyo push: design B still shows after its delete', {
            build: ref!.build
          })
          throw new Wait()
        }
        // Klaviyo never did it: the even test, if it held, leaves no
        // winner; the push stops here.
        logger.error('Klaviyo push: design B was never taken out', {
          build: ref!.build
        })
        throw new Refused('ab_test_unsafe', ['ab_test'])
      }
      if (settling && !p.fallback && after.variations.length === 2) {
        // Design B cannot be taken out: the even test, as a last resort.
        await setEvenTest(live!, mid).catch(() => undefined)
        after = await readDraft(live!, mid)
        if (
          after &&
          after.variations.length === 2 &&
          after.winnerPercentage === 0
        ) {
          logger.warn(
            'Klaviyo push: design B could not be taken out; the even test holds',
            { build: ref!.build }
          )
          await save({ ab: 'verified', designs: 'both' })
          return after
        }
      }
    }
    logger.error('Klaviyo push: design B could not be taken out', {
      build: ref!.build
    })
    throw new Refused('ab_test_unsafe', ['ab_test'])
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
