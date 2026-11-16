import 'server-only'
import { parse, type DefaultTreeAdapterTypes as T } from 'parse5'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { previewFooterTags } from '@/features/blocks/klaviyo-tags'
import { logger } from '@/lib/logger'
import { srcsetUrls } from './section'

/**
 * DST-005b part 2b: the email's views as jobs. The design step asks for a
 * view of the email it drew (`requestEmailRender`, under its own lease):
 * `desktop` (600 wide), `phone` (375 wide, as a phone) or `dark` (600, dark
 * mode as the email declares it). The browser outside the app (the section
 * browser, scripts/studio-renders.mjs) asks for the views waiting
 * (`previewJobs`), draws each with `renderEmail` loading only the email's
 * own picture hosts, uploads the JPEG through its signed link and reports
 * (`finishPreview`). Nothing asks for a view yet (DST-006d does, with the
 * design studio on).
 */

type Db = SupabaseClient<Database>

export const emailViewNames = ['desktop', 'phone', 'dark'] as const
export type EmailView = (typeof emailViewNames)[number]

export const previewLimits = {
  /** Views handed out per call: the browser asks again for the next. */
  perCall: 1,
  /** Claims a call makes at most to find one view it can hand out. */
  claims: 5,
  /** Hosts an email's pictures may come from (the command's own limit). */
  maxOrigins: 8,
  /** The page, in bytes (a built email's limit). */
  maxDocumentBytes: 200_000,
  /** The picture: the studio bucket's limit. */
  maxBytes: 3 * 1024 * 1024,
  /** A taller email is drawn cut here (`renderEmail`). */
  maxHeight: 6_000
}

/** An email the browser may not draw, with its reasons in plain words. */
export class EmailNotDrawable extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join(' '))
    this.name = 'EmailNotDrawable'
  }
}

/** One view to draw: the page, the view, its origins, where to upload. */
export type PreviewJob = {
  job: string
  lease: string
  render: string
  /** The whole page the browser draws (Klaviyo's tags as placeholders). */
  document: string
  view: EmailView
  /** The only origins it may load from (its pictures' hosts). */
  origins: string[]
  /** A signed upload link for email/<render>.jpg (as a section's). */
  upload: string
}

/** A hostname the command takes: no IP address, no port, no user. */
const hostname =
  /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/
/**
 * What the browser refuses to draw (`renderEmail`'s own rule, kept the
 * same): a <link>, a meta http-equiv, frames, objects and `srcdoc` would
 * reach out past its route guard.
 */
const reachesOut =
  /<link\b|\bhttp-equiv\b|<(?:iframe|frame|frameset|object|embed|portal|fencedframe)\b|\bsrcdoc\b/i
const cssUrls = (css: string) =>
  [...css.matchAll(/url\(\s*(['"]?)([^'")\s]+)\1\s*\)/gi)].map((m) => m[2]!)

/** The links a page loads pictures from: `src`, `srcset`, `background`, CSS. */
function loadedUrls(node: T.ParentNode, urls: string[]) {
  for (const child of node.childNodes) {
    if (!('tagName' in child)) continue
    const el = child as T.Element
    const tag = el.tagName.toLowerCase()
    if (tag === 'style')
      for (const text of el.childNodes)
        if (text.nodeName === '#text')
          urls.push(...cssUrls((text as T.TextNode).value))
    for (const { name, value } of el.attrs) {
      const n = name.toLowerCase()
      if (n === 'src' || n === 'background' || n === 'poster')
        urls.push(value.trim())
      else if (n === 'srcset') urls.push(...srcsetUrls(value))
      else if (n === 'style') urls.push(...cssUrls(value))
    }
    if (tag === 'template')
      loadedUrls((el as T.Template).content as T.ParentNode, urls)
    loadedUrls(el, urls)
  }
}

/**
 * The https origins an email's pictures come from, once each, as the
 * command takes them. A picture from anywhere else (http, an IP address, a
 * port) is not loaded: the browser draws the email without it. Inline
 * pictures need no origin. Throws `EmailNotDrawable` past 8 hosts.
 */
export function emailOrigins(html: string): string[] {
  const urls: string[] = []
  // As the browser reads it with JavaScript off: <noscript> is drawn.
  loadedUrls(parse(html, { scriptingEnabled: false }), urls)
  const hosts = new Set<string>()
  for (const url of urls) {
    let u: URL
    try {
      u = new URL(url)
    } catch {
      continue
    }
    const host = u.hostname.toLowerCase()
    if (
      u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      u.port === '' &&
      host.length <= 253 &&
      hostname.test(host) &&
      !/\.[0-9]+$/.test(host)
    )
      hosts.add(host)
  }
  if (hosts.size > previewLimits.maxOrigins)
    throw new EmailNotDrawable([
      `The email loads pictures from more than ${previewLimits.maxOrigins} places.`
    ])
  return [...hosts].map((h) => `https://${h}`)
}

/**
 * Asks for a view of a built email to be drawn, under the build's lease on
 * its design step, as the preview shows it (Klaviyo's tags as
 * placeholders). The same key, view and email again is the same render;
 * the same key and view with another email is PT409. An email too large,
 * with pictures from too many places, or that the browser would refuse,
 * is never queued.
 */
export async function requestEmailRender(
  db: Db,
  input: {
    build: string
    lease: string
    key: string
    view: EmailView
    html: string
    brandName: string | null
  }
): Promise<string> {
  const document = previewFooterTags(input.html, input.brandName)
  if (Buffer.byteLength(document) > previewLimits.maxDocumentBytes)
    throw new EmailNotDrawable(['The email is too large to draw.'])
  if (reachesOut.test(document))
    throw new EmailNotDrawable([
      'The email has a part that would load from outside its pictures.'
    ])
  const origins = emailOrigins(document)
  const { data, error } = await db.rpc('request_email_render', {
    build: input.build,
    lease: input.lease,
    render_key: input.key,
    email_view: input.view,
    document,
    origins
  })
  if (error) throw error
  return data
}

/**
 * Views waiting to be drawn: due, or leased by a browser that stopped
 * answering (the next claim takes those over).
 */
export async function previewsWaiting(db: Db) {
  const now = new Date().toISOString()
  const { count, error } = await db
    .from('platform_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('kind', 'studio.preview')
    .or(
      `and(status.in.(queued,retry_wait),available_at.lte.${now}),and(status.eq.leased,lease_expires_at.lt.${now})`
    )
  if (error) throw error
  return count ?? 0
}

type Lease = { id: string; lease_token: string; subject_key: string }

const logged = (what: string, code: string | undefined) =>
  logger.error(what, { code: code ?? 'preview_job_error' })

/** The job closed as done: its view is gone, so nothing is left to try. */
const settle = async (db: Db, job: string, lease: string, why: string) => {
  const { error } = await db.rpc('finish_platform_job', {
    job,
    lease,
    outcome: { settled: why }
  })
  if (error) logged('A preview job could not be finished', error.code)
}

const fail = async (
  db: Db,
  job: string,
  lease: string,
  failure: PreviewFailure
) => {
  const { error } = await db.rpc('fail_email_render', { job, lease, failure })
  if (!error) return
  logged('A view could not be failed', error.code)
  // The view went with its build meanwhile: the job is closed, never left
  // to its lease.
  if (error.code === 'PT409') await settle(db, job, lease, 'gone')
}

/**
 * Claims preview jobs until one can be handed out (or none is waiting, or
 * `claims` were made) and signs where it uploads. A view that is gone,
 * already finished, for a build that no longer wants it, or that can no
 * longer be drawn, is settled and never handed out.
 */
export async function previewJobs(db: Db): Promise<PreviewJob[]> {
  const jobs: PreviewJob[] = []
  for (
    let claims = 0;
    claims < previewLimits.claims && jobs.length < previewLimits.perCall;
    claims++
  ) {
    const claimed = await db.rpc('claim_platform_job', {
      kinds: ['studio.preview']
    })
    if (claimed.error) throw claimed.error
    const job = (claimed.data as unknown as Lease[] | null)?.[0]
    if (!job) break
    try {
      const handed = await handOut(db, job)
      if (handed) jobs.push(handed)
    } catch (error) {
      logged(
        'A view could not be handed out',
        (error as { code?: string }).code
      )
      await fail(db, job.id, job.lease_token, 'failed')
    }
  }
  return jobs
}

const isView = (v: unknown): v is EmailView =>
  (emailViewNames as readonly unknown[]).includes(v)

async function handOut(db: Db, job: Lease): Promise<PreviewJob | null> {
  const row = await db
    .from('email_renders')
    .select('id,build_id,view,document,origins,state')
    .eq('id', job.subject_key)
    .maybeSingle()
  if (row.error) {
    // Unreadable now: tried again later.
    const { error } = await db.rpc('fail_platform_job', {
      job: job.id,
      lease: job.lease_token,
      failure: 'unavailable',
      error_code: 'preview_read_failed'
    })
    if (error) logged('A preview job could not be failed', error.code)
    return null
  }
  if (!row.data) {
    // Gone with its build: nothing to draw, ever.
    await settle(db, job.id, job.lease_token, 'gone')
    return null
  }
  if (row.data.state !== 'queued') {
    // Already drawn or failed: the job has nothing left to do.
    await settle(db, job.id, job.lease_token, row.data.state)
    return null
  }
  const build = await db
    .from('email_builds')
    .select('state')
    .eq('id', row.data.build_id)
    .maybeSingle()
  if (build.error) throw build.error
  if (build.data?.state !== 'build_queued') {
    // The build no longer wants the view: nothing is drawn.
    await fail(db, job.id, job.lease_token, 'refused')
    return null
  }
  // Checked again: a view that can no longer be drawn never is, and its
  // origins are exactly the ones its page loads by today's rules.
  const { document, view, origins } = row.data
  let drawable =
    isView(view) &&
    Buffer.byteLength(document) <= previewLimits.maxDocumentBytes &&
    !reachesOut.test(document)
  if (drawable)
    try {
      const own = emailOrigins(document)
      drawable =
        own.length === origins.length && own.every((o, i) => o === origins[i])
    } catch {
      drawable = false
    }
  if (!drawable) {
    logged('A view was refused before drawing', 'preview_refused')
    await fail(db, job.id, job.lease_token, 'refused')
    return null
  }
  const upload = await db.storage
    .from('studio-renders')
    .createSignedUploadUrl(`email/${row.data.id}.jpg`, { upsert: true })
  if (upload.error || !upload.data) {
    await fail(db, job.id, job.lease_token, 'upload_failed')
    return null
  }
  return {
    job: job.id,
    lease: job.lease_token,
    render: row.data.id,
    document,
    view: view as EmailView,
    origins,
    upload: upload.data.signedUrl
  }
}

/** Why a view was not drawn (as the command takes it). */
type PreviewFailure =
  'refused' | 'too_large' | 'navigated' | 'timeout' | 'failed' | 'upload_failed'
/** What the browser may report (refusing a view is the server's decision). */
const reported = [
  'too_large',
  'navigated',
  'timeout',
  'failed',
  'upload_failed'
] as const

/** What the browser reports for one view: drawn, or why not. */
export const previewResult = z.union([
  z.strictObject({
    job: z.uuid(),
    lease: z.uuid(),
    height: z.int().min(1).max(previewLimits.maxHeight),
    cut: z.boolean(),
    /** Something in it is wider than the view. */
    wide: z.boolean(),
    bytes: z.int().min(1).max(previewLimits.maxBytes)
  }),
  z.strictObject({
    job: z.uuid(),
    lease: z.uuid(),
    failure: z.enum(reported)
  })
])
export type PreviewResultReport = z.infer<typeof previewResult>

/**
 * Records what the browser reported. PT409: the lease or the view moved
 * on. A drawn report that does not match what is stored (23514) fails
 * the view's attempt instead, so its lease is never left to run out.
 */
export async function finishPreview(
  db: Db,
  result: PreviewResultReport
): Promise<{ ok: true } | { ok: false; code: string }> {
  if ('failure' in result) {
    const { error } = await db.rpc('fail_email_render', {
      job: result.job,
      lease: result.lease,
      failure: result.failure
    })
    return error
      ? { ok: false, code: error.code ?? 'preview_not_recorded' }
      : { ok: true }
  }
  const { error } = await db.rpc('record_email_render', {
    job: result.job,
    lease: result.lease,
    height: result.height,
    cut: result.cut,
    wide: result.wide,
    bytes: result.bytes
  })
  if (!error) return { ok: true }
  if (error.code === '23514') await fail(db, result.job, result.lease, 'failed')
  return { ok: false, code: error.code ?? 'preview_not_recorded' }
}
