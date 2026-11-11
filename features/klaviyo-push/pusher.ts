import 'server-only'
import { createHash } from 'node:crypto'
import { logger } from '@/lib/logger'
import {
  KlaviyoError,
  type KlaviyoClient
} from '@/lib/providers/klaviyo/client'
import {
  addVariation,
  createDraftCampaign,
  createTemplate,
  deleteTemplate,
  deleteVariation,
  designName,
  findOwnCampaign,
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
  footerProblems,
  htmlHash,
  imageSources,
  importable,
  withImages,
  type FinalCheck
} from './html'

/**
 * The live DraftPusher (PSH-001): puts one built email into the
 * workspace's own Klaviyo account as a DRAFT campaign, never scheduled or
 * sent (D17: the owner schedules it in Klaviyo).
 *
 * In order: the pictures are imported into Klaviyo's library and the HTML
 * points at them (VISION rule 11); the final checks run on exactly the
 * HTML sent; each design becomes an HTML template; the campaign is made
 * with one message to the planned list or segment and one variation per
 * design. For an A/B design test (EML-005) the message's test is set to
 * an even split with no winner and read back; if Klaviyo refuses it or
 * keeps another setting, design B is taken out again, so no draft is left
 * that Klaviyo's own A/B settings could finish by sending a "winner", and
 * the answer says only design A went in. Our templates are deleted once
 * Klaviyo keeps its own copy (it allows 1,000 made by the API).
 *
 * Every step is saved as it is made (`PushStore`), so a push that stops
 * half way is picked up where it was: the same push key never makes a
 * second picture, template or campaign, and a campaign whose answer was
 * lost is found again by its name and our mark. The same key again updates
 * the draft to this content; a draft the owner scheduled, sent, deleted
 * or changed in Klaviyo is never touched (`rejected`).
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
  createStartedAt: string | null
  designs: 'both' | 'A' | null
  fallback: string | null
  reason: string | null
  written: string | null
}
export type PushStep = Partial<
  Omit<PushProgress, 'images'> & {
    /** Pictures added (merged into those saved). */
    images: Record<string, string>
    checks: FinalCheck[]
  }
>
/** Where each push's steps are kept (`klaviyo_draft_pushes`). */
export type PushStore = {
  load(tenantId: string, key: string): Promise<PushProgress | null>
  save(tenantId: string, key: string, step: PushStep): Promise<void>
}
/** The workspace's live Klaviyo and its timezone. */
export type PushSource = {
  /** Null when the workspace has no live Klaviyo (or the switch is off). */
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
  designs: null,
  fallback: null,
  reason: null,
  written: null
}

/**
 * A push stops before a Klaviyo request that might not end inside its
 * time (`budgetMs`): everything made so far is saved, and the next run
 * goes on from there.
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

const klaviyoId = /^[A-Za-z0-9_-]{1,64}$/
/** A create whose answer was lost is looked for from a minute before. */
const findSlackMs = 60_000

/** Our mark on a campaign: which push made it. */
export const pushMark = (key: string) => `GROS draft ${key}`
const short = (key: string) => key.replace(/-/g, '').slice(0, 8)

type Design = { approach: 'A' | 'B'; html: string }

/** The designs asked for: two for an A/B test (A first), else the one. */
function designsOf(input: DraftInput): Design[] {
  if (!input.variations) return [{ approach: 'A', html: input.html }]
  const [a, b, ...more] = input.variations
  if (!a || !b || more.length || a.approach !== 'A' || b.approach !== 'B')
    throw new Refused('variations_invalid', ['variations'])
  return [a, b]
}

/** A fingerprint of the variations as Klaviyo shows them. */
const writtenOf = (read: DraftRead) =>
  createHash('sha256')
    .update(
      JSON.stringify(
        read.variations
          .map((v) => [v.name ?? '', v.subject ?? '', v.preview ?? ''])
          .sort()
      )
    )
    .digest('hex')

type Deps = {
  source: PushSource
  store: PushStore
  now?: () => Date
  /** The longest one push may take (default 30 s), with each request at most `callMs`. */
  budgetMs?: number
  callMs?: number
}

/** A push takes at most this long, so it ends inside its route's minute. */
export const pushBudgetMs = 30_000

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

async function failed(
  error: unknown,
  input: DraftInput,
  store: PushStore
): Promise<DraftResult> {
  if (error instanceof TimeUp) {
    logger.info('Klaviyo push paused: out of time; it goes on at the next run')
    // Not a failed try: the build waits and the next run goes on from here.
    return { ok: false, code: 'rate_limited', retryAfterSeconds: 30 }
  }
  if (error instanceof Refused) {
    logger.warn('Klaviyo push refused', {
      reason: error.reason,
      checks: error.checks.join(',')
    })
    try {
      if (!input.sample)
        await store.save(input.tenantId, input.idempotencyKey, {
          state: 'refused',
          reason: error.reason
        })
    } catch {
      // The refusal stands without its note.
    }
    return { ok: false, code: 'rejected', checks: error.checks }
  }
  if (error instanceof KlaviyoError) {
    logger.warn('Klaviyo push stopped', {
      kind: error.kind,
      endpoint: error.details.endpoint,
      status: error.details.status ?? 0,
      code: error.details.code ?? 'none'
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
    name: error instanceof Error ? error.name : 'unknown'
  })
  return { ok: false, code: 'unavailable' }
}

async function push(input: DraftInput, deps: Deps): Promise<DraftResult> {
  const now = deps.now ?? (() => new Date())
  const deadline = now().getTime() + (deps.budgetMs ?? pushBudgetMs)
  const tenantId = input.tenantId
  const key = input.idempotencyKey
  // The sample store never reaches a real Klaviyo account.
  if (input.sample) throw new Refused('sample_email', ['sample'])
  const designs = designsOf(input)
  if (!klaviyoId.test(input.audienceId))
    throw new Refused('audience_not_in_klaviyo', ['audience'])
  for (const d of designs)
    if (footerProblems(d.html).length)
      throw new Refused('footer_missing', ['footer'])

  const live = await deps.source.client(tenantId)
  if (!live) return { ok: false, code: 'auth' }
  const client = timed(
    live,
    () => deadline - now().getTime(),
    deps.callMs ?? 10_000
  )

  let p = (await deps.store.load(tenantId, key)) ?? { ...empty }
  if (p.state === 'refused' && p.reason === 'externally_modified')
    throw new Refused('externally_modified', ['externally_modified'])
  const save = async (step: PushStep) => {
    await deps.store.save(tenantId, key, step)
    // The checks are kept for the record only, not in the progress.
    const { images, ...rest } = step
    delete rest.checks
    p = { ...p, ...rest, images: { ...p.images, ...(images ?? {}) } }
  }

  // A draft made before: still a draft, still as we left it.
  let read: DraftRead | null = null
  if (p.messageId) {
    read = await readDraft(client, p.messageId)
    if (
      !read ||
      read.status !== 'draft' ||
      (p.written && writtenOf(read) !== p.written)
    )
      throw new Refused(
        read && read.status !== 'draft' ? 'not_a_draft' : 'externally_modified',
        [read && read.status !== 'draft' ? 'not_draft' : 'externally_modified']
      )
  }
  // After Klaviyo refused the even test once, this draft stays design A.
  const wanted = p.designs === 'A' ? designs.slice(0, 1) : designs

  // 1. The pictures, into Klaviyo's library.
  let n = Object.keys(p.images).length
  for (const src of [...new Set(wanted.flatMap((d) => imageSources(d.html)))]) {
    if (p.images[src]) continue
    if (!importable(src)) throw new Refused('image_not_importable', ['images'])
    let url: string
    try {
      url = await importImage(client, src, `GROS ${short(key)} ${++n}`)
    } catch (error) {
      if (error instanceof KlaviyoError && error.kind === 'rejected')
        throw new Refused('image_refused', ['images'])
      throw error
    }
    await save({ images: { [src]: url } })
  }
  const htmls = wanted.map((d) => withImages(d.html, p.images))

  // 2. The final checks on exactly the HTML sent.
  const moved = new Set(Object.values(p.images))
  const checks = mergeChecks(htmls.map((h) => finalChecks(h, moved)))
  await save({ checks })
  const failing = checks.filter((c) => !c.pass).map((c) => c.id)
  if (failing.length) throw new Refused('final_checks', failing)

  // 3. One template per design (a changed design gets a new one).
  const templates: PushTemplate[] = []
  for (const [i, d] of wanted.entries()) {
    const hash = htmlHash(htmls[i]!)
    let t = p.templates.find(
      (x) => x.approach === d.approach && x.hash === hash && !x.deleted
    )
    if (!t) {
      t = {
        approach: d.approach,
        id: await createTemplate(
          client,
          `GROS ${short(key)} ${d.approach}`,
          htmls[i]!
        ),
        hash,
        deleted: false
      }
      await save({ templates: [...p.templates, t] })
    }
    templates.push(t)
  }
  const contents: VariationContent[] = wanted.map((d, i) => ({
    name: designName(d.approach),
    subject: input.subject,
    preview: input.preheader,
    templateId: templates[i]!.id
  }))

  // 4. The campaign: made once, found again if its answer was lost.
  let made = false
  if (!p.messageId) {
    if (p.createStartedAt) {
      const found = await findOwnCampaign(client, {
        name: input.name,
        description: pushMark(key),
        since: new Date(Date.parse(p.createStartedAt) - findSlackMs)
      })
      if (found === 'ambiguous')
        throw new Refused('campaign_ambiguous', ['campaign'])
      if (found)
        await save({ campaignId: found.campaignId, messageId: found.messageId })
    }
    if (!p.messageId) {
      await save({ createStartedAt: now().toISOString() })
      const created = await createDraftCampaign(client, {
        name: input.name,
        description: pushMark(key),
        audienceId: input.audienceId,
        timezone: await deps.source.timezone(tenantId),
        variations: contents
      })
      await save({
        campaignId: created.campaignId,
        messageId: created.messageId
      })
      made = true
    }
  }
  const messageId = p.messageId!
  const reread = async () => {
    const r = await readDraft(client, messageId)
    if (!r) throw new Refused('externally_modified', ['externally_modified'])
    if (r.status !== 'draft') throw new Refused('not_a_draft', ['not_draft'])
    return r
  }
  read = await reread()

  // 5. Each design's variation takes this content (once: a variation that
  //    already shows it is left as it is, so a push stopped half way goes
  //    on instead of starting again).
  const applied = (templateId: string, variation: string) =>
    save({
      templates: p.templates.map((t) =>
        t.id === templateId ? { ...t, variation } : t
      )
    })
  let wrote = false
  for (const [i, c] of contents.entries()) {
    const t = templates[i]!
    const v = read.variations.find((x) => x.name === c.name)
    const current = p.templates.find((x) => x.id === t.id)
    if (made && v && !current?.variation) await applied(t.id, v.id)
    else if (
      v &&
      current?.variation === v.id &&
      v.subject === c.subject &&
      v.preview === c.preview
    )
      continue
    else if (v) {
      await updateVariation(client, v.id, c)
      await applied(t.id, v.id)
      wrote = true
    } else {
      await applied(t.id, await addVariation(client, messageId, c))
      wrote = true
    }
  }
  for (const v of read.variations)
    if (!contents.some((c) => c.name === v.name)) {
      await deleteVariation(client, v.id)
      wrote = true
    }
  if (wrote) read = await reread()

  // 6. An A/B design test: an even split, no winner; else design A only.
  if (wanted.length === 2) {
    let fallback: string | null = null
    try {
      if (read.winnerPercentage !== 0) await setEvenTest(client, messageId)
    } catch (error) {
      if (!(error instanceof KlaviyoError && error.kind === 'rejected'))
        throw error
      fallback = 'ab_test_refused'
    }
    if (!fallback) {
      read = await reread()
      if (read.winnerPercentage !== 0 || read.variations.length !== 2)
        fallback = 'ab_test_not_kept'
    }
    if (fallback)
      read = await onlyDesignA(
        client,
        read,
        contents[0]!,
        fallback,
        save,
        reread
      )
  }

  // 7. Our templates, once Klaviyo keeps its own copy.
  const kept = p.templates.map((t) => ({ ...t }))
  for (const t of kept) {
    if (t.deleted || read.variations.some((v) => v.templateId === t.id))
      continue
    try {
      await deleteTemplate(client, t.id)
    } catch (error) {
      // Already gone; anything else waits for the next push of this key.
      if (!(error instanceof KlaviyoError && error.kind === 'rejected'))
        continue
    }
    t.deleted = true
  }

  await save({
    state: 'drafted',
    templates: kept,
    designs: p.designs ?? (wanted.length === 2 ? 'both' : 'A'),
    written: writtenOf(read),
    reason: null
  })
  logger.info('Klaviyo draft ready', {
    designs: p.designs,
    fallback: p.fallback ?? 'none',
    images: Object.keys(p.images).length
  })
  return {
    ok: true,
    campaignId: p.campaignId!,
    sample: false,
    ...(input.variations ? { designs: p.designs ?? 'A' } : {})
  }
}

/**
 * Klaviyo refused the even test (or kept its own settings): design B is
 * taken out of our draft, so its default A/B settings can never pick and
 * send a winner, and one variation, design A, is checked to remain. If B
 * cannot be taken out, it is made the same email as A: whichever Klaviyo
 * sends, it is design A.
 */
async function onlyDesignA(
  client: KlaviyoClient,
  read: DraftRead,
  a: VariationContent,
  fallback: string,
  save: (step: PushStep) => Promise<void>,
  reread: () => Promise<DraftRead>
) {
  // Decided first: a push stopped here goes on with design A only.
  await save({ designs: 'A', fallback })
  for (const v of read.variations) {
    if (v.name === a.name) continue
    try {
      await deleteVariation(client, v.id)
    } catch (error) {
      if (!(error instanceof KlaviyoError && error.kind === 'rejected'))
        throw error
    }
  }
  let after = await reread()
  let how = fallback
  if (after.variations.length !== 1 || after.variations[0]!.name !== a.name) {
    for (const v of after.variations)
      if (v.name !== a.name)
        await updateVariation(client, v.id, {
          ...a,
          name: v.name ?? designName('B')
        })
    after = await reread()
    if (after.variations.some((v) => v.subject !== a.subject))
      throw new Refused('ab_test_unsafe', ['ab_test'])
    how = `${fallback}_same_email`
    await save({ fallback: how })
  }
  logger.warn('Klaviyo push: only design A went in', {
    reason: how,
    variations: after.variations.length
  })
  return after
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
    return { id, pass: problems.length === 0, problems }
  })
}
