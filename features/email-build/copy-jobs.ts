import 'server-only'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/lib/supabase/database.types'
import { logger } from '@/lib/logger'
import type { DraftPusher } from '@/lib/providers/klaviyo-draft'
import {
  parseBlueprint,
  type Blueprint
} from '@/features/design-engine/blueprint'
import { leaksOf } from '@/features/design-engine/leaks'
import { photoOrigins } from '@/features/design-engine/photos'
import { ENGINE_VERSION } from '@/features/design-engine/stored'
import { swapOwnWords, type SwapBrand } from '@/features/design-engine/swap'
import {
  copyInputSchema,
  copyPhotoPath,
  copyRecord,
  libraryCopyOn,
  type CopyRecord
} from './library-copy'
import { runEmailBuilds } from './worker'
import { composeScratch } from './scratch'
import { libraryScratchOn } from './scratch-switch'
import { blockBlueprints, checkedBlocks } from '@/features/block-library/read'

/** The most source emails one Scratch copy's leak check reads. */
export const scratchLeakSources = 24

/**
 * DES-ENGINE-002b2: the library copy browser job's side in the app. A
 * server function cannot run Chromium, so the scheduled browser job
 * (`scripts/design-copies.mjs`, `.github/workflows/design-copies.yml`)
 * asks for one copy at a time (`copyJobs`: what the build saved for it,
 * the stored blueprint, the original's marked HTML as a short-lived signed
 * link, signed upload links in its own claim's folder and the server's
 * fixed list of photo hosts), runs `libraryCopy` in the locked browser,
 * uploads the cut photos and reports the copy (`finishCopy`). The app
 * runs the leak check again itself before it records a copy: rule 8 never
 * rests on the browser job's word. Then the builds whose copies are in go
 * on (`runCopiedBuilds`), through their checks and into Klaviyo as drafts,
 * and the photos no email needs any more are removed (`cleanCopyPhotos`).
 * With the owner's switch off, the job is handed no work.
 */

type Db = SupabaseClient<Database>
type Env = Readonly<Record<string, string | undefined>>

/**
 * The copying job works while either switch that asks for copies is on:
 * Copy (`DESIGN_LIBRARY_COPY`) or Scratch from the library
 * (`DESIGN_LIBRARY_SCRATCH`, DES-ENGINE-004b).
 */
export const copiesOn = (env: Env) =>
  libraryCopyOn(env) || libraryScratchOn(env)

export const copyLimits = {
  /**
   * How long the link to the original's marked HTML works. The upload
   * links are Supabase's own (2 hours, fixed), each in its claim's own
   * folder and never over a stored photo.
   */
  linkSeconds: 600,
  /** A report's largest body (a copy is at most 400,000 characters). */
  bodyBytes: 450_000,
  /** Builds one carry-on run takes at most. */
  carryBuilds: 5,
  /** Copies whose photos one carry-on run looks at (cleanup). */
  cleanCopies: 20,
  /** A drafted email's cut photos are kept this long (their links' life). */
  keepDays: 30
} as const

export type CopyJob = {
  job: string
  lease: string
  engine: string
  /** What the build saved for its copy (`copyInputSchema`). */
  input: unknown
  /** The stored blueprint of the inspiration email (no pictures or links). */
  source: unknown
  /** The original's marked HTML, for the leak check (signed link). */
  html: string
  /**
   * DES-ENGINE-004b: a Scratch copy of library blocks: every email a block
   * came from (signed links, with its brand's names), all for the leak
   * check; `html` is the first of them.
   */
  sources?: { html: string; names: string[] }[]
  /** Where each cut photo goes, by index (signed upload links). */
  uploads: { index: number; url: string }[]
  /** The hosts photos may be fetched from: the server's fixed list only. */
  origins: string[]
}

type Lease = { id: string; subject_key: string; lease_token: string }

async function retry(db: Db, job: string, lease: string, code: string) {
  const failed = await db.rpc('fail_platform_job', {
    job,
    lease,
    failure: code === 'timeout' ? 'timeout' : 'protocol',
    error_code: code
  })
  if (failed.error)
    logger.warn('Copy job failure not recorded', {
      code: failed.error.code ?? 'unknown',
      failure: code
    })
}

async function failCopy(db: Db, job: string, lease: string, failure: string) {
  const done = await db.rpc('record_email_copy', { job, lease, failure })
  if (done.error)
    logger.warn('Copy failure not recorded', {
      code: done.error.code ?? 'unknown',
      failure
    })
}

/** How many copies are due now (claims nothing); none with the switch off. */
export async function copiesWaiting(db: Db, env: Env = process.env) {
  if (!copiesOn(env)) return 0
  const { data, error } = await db
    .from('platform_jobs')
    .select('subject_key')
    .eq('kind', 'design.copy')
    .in('status', ['queued', 'retry_wait'])
    .lte('available_at', new Date().toISOString())
    .limit(500)
  if (error) throw error
  const builds = (data ?? []).map((j) => j.subject_key)
  if (!builds.length) return 0
  // DES-ENGINE-004b: a copy whose kind's switch is off is not waiting (it
  // never wakes the runner on its own); one with no copy row is (its job
  // is settled when handed out).
  const kinds = await db
    .from('email_copies')
    .select('build_id,blocks')
    .in('build_id', builds)
  if (kinds.error) throw kinds.error
  const scratch = new Map(
    (kinds.data ?? []).map((c) => [c.build_id, !!c.blocks?.length])
  )
  return builds.filter((b) =>
    !scratch.has(b)
      ? true
      : scratch.get(b)
        ? libraryScratchOn(env)
        : libraryCopyOn(env)
  ).length
}

/**
 * Claims one copy job and signs what it needs. With the switch off, or to
 * a browser on another engine version, none: nothing is claimed (`skew`
 * says which). A copy that can never be made (its input unreadable, the
 * blueprint or the original gone, the build moved on) is recorded as
 * failed at once, with its code.
 */
export async function copyJobs(
  db: Db,
  engine: string | null,
  env: Env = process.env
): Promise<{ jobs: CopyJob[]; skew: boolean; off?: true }> {
  if (!copiesOn(env)) return { jobs: [], skew: false, off: true }
  if (engine !== ENGINE_VERSION) return { jobs: [], skew: true }
  const claimed = await db.rpc('claim_email_copy')
  if (claimed.error) throw claimed.error
  const job = (claimed.data as unknown as Lease[] | null)?.[0]
  if (!job) return { jobs: [], skew: false }
  const handed = await handOut(db, job, env)
  return { jobs: handed ? [handed] : [], skew: false }
}

async function handOut(db: Db, job: Lease, env: Env): Promise<CopyJob | null> {
  const copy = await db
    .from('email_copies')
    .select(
      'build_id,tenant_id,inbox_message_id,upload_id,blocks,state,input,photos'
    )
    .eq('build_id', job.subject_key)
    .maybeSingle()
  if (copy.error) {
    await retry(db, job.id, job.lease_token, 'copy_read_failed')
    return null
  }
  if (!copy.data || copy.data.state !== 'queued') {
    // Nothing left to copy (recorded already, or gone with its build).
    const done = await db.rpc('finish_platform_job', {
      job: job.id,
      lease: job.lease_token,
      outcome: { state: copy.data?.state ?? 'gone' }
    })
    if (done.error)
      logger.warn('Copy job not settled', { code: done.error.code })
    return null
  }
  const c = copy.data
  // Each kind of copy only with its own switch: a Scratch copy with
  // DESIGN_LIBRARY_SCRATCH, a Copy or upload copy with DESIGN_LIBRARY_COPY
  // (handed back, its try given back, until its switch is on).
  if (!(c.blocks?.length ? libraryScratchOn(env) : libraryCopyOn(env))) {
    const back = await db.rpc('park_email_copy', {
      job: job.id,
      lease: job.lease_token
    })
    if (back.error)
      logger.warn('Copy job not parked', { code: back.error.code })
    return null
  }
  const build = await db
    .from('email_builds')
    .select('state,step')
    .eq('id', c.build_id)
    .maybeSingle()
  if (build.error) {
    await retry(db, job.id, job.lease_token, 'copy_read_failed')
    return null
  }
  if (build.data?.state !== 'build_queued' || build.data.step !== 'design') {
    await failCopy(db, job.id, job.lease_token, 'build_moved_on')
    return null
  }
  if (!copyInputSchema.safeParse(c.input).success) {
    await failCopy(db, job.id, job.lease_token, 'input_invalid')
    return null
  }
  // DES-ENGINE-003b: the copy of one of the workspace's own uploads, or
  // of an inspiration email.
  // DES-ENGINE-004b: a Scratch copy of library blocks.
  if (c.blocks?.length) return handOutScratch(db, job, c)
  const sources = c.upload_id
    ? await uploadSources(db, c.upload_id, c.tenant_id, { html: false })
    : c.inbox_message_id
      ? await copySources(db, c.inbox_message_id, { html: false })
      : 'source_missing'
  if (sources === 'unreadable') {
    await retry(db, job.id, job.lease_token, 'copy_read_failed')
    return null
  }
  if (sources === 'blueprint_gone' || sources === 'source_missing') {
    await failCopy(db, job.id, job.lease_token, sources)
    return null
  }
  const html = await db.storage
    .from(sources.bucket)
    .createSignedUrl(sources.path, copyLimits.linkSeconds)
  if (html.error || !html.data?.signedUrl) {
    await retry(db, job.id, job.lease_token, 'copy_links_failed')
    return null
  }
  const uploads: CopyJob['uploads'] = []
  for (let index = 0; index < c.photos; index++) {
    // In this claim's own folder, never over a stored photo.
    const up = await db.storage
      .from('email-copies')
      .createSignedUploadUrl(
        copyPhotoPath(c.tenant_id, c.build_id, job.lease_token, index)
      )
    if (up.error || !up.data?.signedUrl) {
      await retry(db, job.id, job.lease_token, 'copy_links_failed')
      return null
    }
    uploads.push({ index, url: up.data.signedUrl })
  }
  return {
    job: job.id,
    lease: job.lease_token,
    engine: ENGINE_VERSION,
    input: c.input,
    source: sources.blueprint,
    html: html.data.signedUrl,
    uploads,
    origins: photoOrigins()
  }
}

/** Signed upload links in this claim's own folder, one per photo. */
async function photoUploads(
  db: Db,
  job: Lease,
  c: { tenant_id: string; build_id: string; photos: number }
): Promise<CopyJob['uploads'] | null> {
  const uploads: CopyJob['uploads'] = []
  for (let index = 0; index < c.photos; index++) {
    const up = await db.storage
      .from('email-copies')
      .createSignedUploadUrl(
        copyPhotoPath(c.tenant_id, c.build_id, job.lease_token, index)
      )
    if (up.error || !up.data?.signedUrl) return null
    uploads.push({ index, url: up.data.signedUrl })
  }
  return uploads
}

/** DES-ENGINE-004b: a Scratch copy handed out: the blocks composed, every source signed. */
async function handOutScratch(
  db: Db,
  job: Lease,
  c: {
    tenant_id: string
    build_id: string
    blocks: string[] | null
    input: unknown
    photos: number
  }
): Promise<CopyJob | null> {
  const got = await scratchSources(db, c.tenant_id, c.blocks ?? [], {
    html: false
  })
  if (got === 'unreadable') {
    await retry(db, job.id, job.lease_token, 'copy_read_failed')
    return null
  }
  if (typeof got === 'string') {
    await failCopy(db, job.id, job.lease_token, got)
    return null
  }
  const sources: { html: string; names: string[] }[] = []
  for (const s of got.sources) {
    const link = await db.storage
      .from(s.bucket)
      .createSignedUrl(s.path, copyLimits.linkSeconds)
    if (link.error || !link.data?.signedUrl) {
      await retry(db, job.id, job.lease_token, 'copy_links_failed')
      return null
    }
    sources.push({ html: link.data.signedUrl, names: s.names })
  }
  const uploads = await photoUploads(db, job, c)
  if (!uploads) {
    await retry(db, job.id, job.lease_token, 'copy_links_failed')
    return null
  }
  return {
    job: job.id,
    lease: job.lease_token,
    engine: ENGINE_VERSION,
    input: c.input,
    source: got.blueprint,
    html: sources[0]!.html,
    sources,
    uploads,
    origins: photoOrigins()
  }
}

type ScratchSource = {
  bucket: 'inbox-raw' | 'email-uploads'
  path: string
  names: string[]
  text: string | null
}

/**
 * DES-ENGINE-004b: a Scratch copy's composed blueprint (its blocks, in
 * order, each one the workspace may still use) and, for the leak check,
 * the email each block came from (its first recorded source: an
 * Inspiration email's marked HTML with its brand's names, or one of the
 * workspace's own uploads).
 */
async function scratchSources(
  db: Db,
  tenant: string,
  blocks: readonly string[],
  { html }: { html: boolean }
): Promise<
  | { blueprint: unknown; sources: ScratchSource[] }
  | 'blueprint_gone'
  | 'block_unusable'
  | 'source_missing'
  | 'unreadable'
> {
  let prints: Map<string, Blueprint>
  try {
    prints = await blockBlueprints(db, tenant, blocks)
  } catch {
    return 'unreadable'
  }
  if (!blocks.length || blocks.some((b) => !prints.has(b)))
    return 'blueprint_gone'
  // Reference time: every block must still be one the workspace may use
  // (Copy's rules and the Observer selection, as when it was picked).
  let checked: Awaited<ReturnType<typeof checkedBlocks>>
  try {
    checked = await checkedBlocks(db, tenant, blocks)
  } catch {
    return 'unreadable'
  }
  const usable = new Map(checked.map((c) => [c.id, c]))
  if (blocks.some((b) => !usable.has(b))) return 'block_unusable'
  const blueprint = composeScratch(blocks.map((b) => prints.get(b)!))
  // The leak check reads the email each block's geometry came from first,
  // then the other emails that used the same layouts, up to
  // `scratchLeakSources` emails in all (the gate reads them all).
  const from = await db
    .from('library_block_sources')
    .select('block_id,inbox_message_id,upload_id,created_at')
    .in('block_id', [...blocks])
    .order('created_at')
  if (from.error) return 'unreadable'
  const messages: string[] = []
  const uploads: string[] = []
  const add = (message: string | null, upload: string | null) => {
    if (messages.length + uploads.length >= scratchLeakSources) return
    if (message && !messages.includes(message)) messages.push(message)
    if (upload && !uploads.includes(upload)) uploads.push(upload)
  }
  for (const b of blocks) {
    const c = usable.get(b)!
    if (!c.geometryMessage && !c.geometryUpload) return 'source_missing'
    add(c.geometryMessage, c.geometryUpload)
  }
  for (const r of from.data ?? []) add(r.inbox_message_id, r.upload_id)
  const sources: ScratchSource[] = []
  if (messages.length) {
    const rows = await db
      .from('inbox_messages')
      .select('id,marked_html_path,capture_id')
      .in('id', messages)
    if (rows.error) return 'unreadable'
    const captures = [
      ...new Set((rows.data ?? []).flatMap((r) => r.capture_id ?? []))
    ]
    const names = captures.length
      ? await db
          .from('competitor_captures')
          .select('id,brand_name,domain')
          .in('id', captures)
      : { data: [], error: null }
    if (names.error) return 'unreadable'
    const byCapture = new Map(
      (names.data ?? []).map((n) => [
        n.id,
        [n.brand_name?.trim(), n.domain]
          .filter((x): x is string => !!x)
          .map((x) => x.slice(0, 200))
      ])
    )
    for (const id of messages) {
      const r = (rows.data ?? []).find((x) => x.id === id)
      if (!r?.marked_html_path) return 'source_missing'
      sources.push({
        bucket: 'inbox-raw',
        path: r.marked_html_path,
        names: (r.capture_id && byCapture.get(r.capture_id)) || [],
        text: null
      })
    }
  }
  if (uploads.length) {
    const rows = await db
      .from('email_uploads')
      .select('id,tenant_id,state')
      .in('id', uploads)
    if (rows.error) return 'unreadable'
    for (const id of uploads) {
      const r = (rows.data ?? []).find((x) => x.id === id)
      if (!r || r.tenant_id !== tenant || r.state !== 'ready')
        return 'source_missing'
      sources.push({
        bucket: 'email-uploads',
        path: `${tenant}/${id}/email.html`,
        names: [],
        text: null
      })
    }
  }
  if (!sources.length) return 'source_missing'
  if (!html) return { blueprint, sources }
  for (const s of sources) {
    const file = await db.storage.from(s.bucket).download(s.path)
    if (file.error || !file.data) return 'unreadable'
    s.text = await file.data.text()
  }
  return { blueprint, sources }
}

type Sources =
  | {
      blueprint: unknown
      bucket: 'inbox-raw' | 'email-uploads'
      path: string
      text: string | null
      /** An upload's kind (the brand's own design is not leak-checked). */
      design?: 'own' | 'other'
    }
  | 'blueprint_gone'
  | 'source_missing'
  | 'unreadable'

/**
 * DES-ENGINE-003b: an upload's stored blueprint and prepared HTML (its
 * path, or its text), only a ready upload of the copy's own workspace,
 * and only while its prepared HTML is the one pinned when it was added.
 */
async function uploadSources(
  db: Db,
  upload: string,
  tenant: string,
  { html }: { html: boolean }
): Promise<Sources> {
  const row = await db
    .from('email_uploads')
    .select('state,design,blueprint,html_etag')
    .eq('id', upload)
    .eq('tenant_id', tenant)
    .maybeSingle()
  if (row.error) return 'unreadable'
  if (row.data?.state !== 'ready' || !parseBlueprint(row.data.blueprint).ok)
    return 'blueprint_gone'
  const folder = `${tenant}/${upload}`
  const listed = await db.storage
    .from('email-uploads')
    .list(folder, { search: 'email.html' })
  if (listed.error) return 'unreadable'
  const now = listed.data.find((o) => o.name === 'email.html')
  if (!now || now.metadata?.eTag !== row.data.html_etag) return 'source_missing'
  const path = `${folder}/email.html`
  const design = row.data.design === 'other' ? 'other' : 'own'
  if (!html)
    return {
      blueprint: row.data.blueprint,
      bucket: 'email-uploads',
      path,
      text: null,
      design
    }
  const file = await db.storage.from('email-uploads').download(path)
  if (file.error || !file.data) return 'unreadable'
  return {
    blueprint: row.data.blueprint,
    bucket: 'email-uploads',
    path,
    text: await file.data.text(),
    design
  }
}

/** The inspiration email's stored blueprint and marked HTML (its path, or its text). */
async function copySources(
  db: Db,
  message: string,
  { html }: { html: boolean }
): Promise<Sources> {
  const [stored, row] = await Promise.all([
    db
      .from('inbox_blueprints')
      .select('state,blueprint')
      .eq('inbox_message_id', message)
      .eq('version', 1)
      .maybeSingle(),
    db
      .from('inbox_messages')
      .select('marked_html_path')
      .eq('id', message)
      .maybeSingle()
  ])
  if (stored.error || row.error) return 'unreadable'
  if (
    stored.data?.state !== 'ready' ||
    !parseBlueprint(stored.data.blueprint).ok
  )
    return 'blueprint_gone'
  const path = row.data?.marked_html_path
  if (!path) return 'source_missing'
  if (!html)
    return {
      blueprint: stored.data.blueprint,
      bucket: 'inbox-raw',
      path,
      text: null
    }
  const file = await db.storage.from('inbox-raw').download(path)
  if (file.error || !file.data) return 'unreadable'
  return {
    blueprint: stored.data.blueprint,
    bucket: 'inbox-raw',
    path,
    text: await file.data.text()
  }
}

export const copyResult = z.union([
  z.object({
    job: z.uuid(),
    lease: z.uuid(),
    engine: z.string().min(1).max(40),
    record: copyRecord
  }),
  z.object({
    job: z.uuid(),
    lease: z.uuid(),
    engine: z.string().min(1).max(40),
    failure: z.enum(['copy_failed', 'too_many_photos'])
  }),
  z.object({
    job: z.uuid(),
    lease: z.uuid(),
    retry: z.enum([
      'timeout',
      'html_unreadable',
      'upload_failed',
      'engine_error'
    ])
  })
])
export type CopyResult = z.infer<typeof copyResult>

/**
 * Rule 8 checked again by the app: the copy against the stored blueprint,
 * the original's own HTML and the brand's vocabulary as the build saved
 * it. Null when it cannot be checked now (read again later).
 */
async function serverLeaks(
  db: Db,
  job: string,
  record: CopyRecord
): Promise<{ leaks: number } | 'gone' | null> {
  const j = await db
    .from('platform_jobs')
    .select('subject_key')
    .eq('id', job)
    .eq('kind', 'design.copy')
    .maybeSingle()
  if (j.error) return null
  if (!j.data) return 'gone'
  const copy = await db
    .from('email_copies')
    .select('inbox_message_id,upload_id,blocks,tenant_id,input')
    .eq('build_id', j.data.subject_key)
    .maybeSingle()
  if (copy.error) return null
  if (!copy.data) return 'gone'
  const input = copyInputSchema.safeParse(copy.data.input)
  if (!input.success) return { leaks: 1 }
  // DES-ENGINE-004b: a Scratch copy against every email a block came from.
  if (copy.data.blocks?.length) {
    const got = await scratchSources(
      db,
      copy.data.tenant_id,
      copy.data.blocks,
      {
        html: true
      }
    )
    if (got === 'unreadable') return null
    if (typeof got === 'string') return { leaks: 1 }
    const vocabulary = [
      ...input.data.vocabulary,
      ...swapOwnWords(input.data.brand as unknown as SwapBrand)
    ]
    try {
      return {
        leaks: got.sources.reduce(
          (n, s) =>
            n +
            leaksOf({
              sourceHtml: s.text ?? '',
              html: record.html,
              sourceNames: s.names,
              vocabulary
            }).length,
          0
        )
      }
    } catch {
      return { leaks: 1 }
    }
  }
  const sources = copy.data.upload_id
    ? await uploadSources(db, copy.data.upload_id, copy.data.tenant_id, {
        html: true
      })
    : copy.data.inbox_message_id
      ? await copySources(db, copy.data.inbox_message_id, { html: true })
      : 'source_missing'
  if (sources === 'unreadable') return null
  if (typeof sources === 'string' || !sources.text) return { leaks: 1 }
  // The brand's own design is not checked against itself (its words,
  // pictures and links are the brand's own): read from the upload itself,
  // never from what the copy says.
  if (sources.design === 'own') return { leaks: 0 }
  const parsed = parseBlueprint(sources.blueprint)
  try {
    return {
      leaks: leaksOf({
        ...(parsed.ok ? { source: parsed.blueprint } : {}),
        sourceHtml: sources.text,
        html: record.html,
        sourceNames: input.data.sourceNames,
        vocabulary: [
          ...input.data.vocabulary,
          ...swapOwnWords(input.data.brand as unknown as SwapBrand)
        ]
      }).length
    }
  } catch {
    return { leaks: 1 }
  }
}

/**
 * Records one result: the copy (checked for leaks again here, every photo
 * it names stored in its claim's folder), a failure that is final, or one
 * worth another try. A copy made on another engine version is handed back
 * without counting a try. A copy that shows anything of the other brand
 * is recorded as failed (`copy_leaked`), never as a copy.
 */
export async function finishCopy(
  db: Db,
  result: CopyResult
): Promise<{ ok: true; state: string } | { ok: false; code: string }> {
  if ('retry' in result) {
    await retry(db, result.job, result.lease, result.retry)
    return { ok: true, state: 'retry' }
  }
  if (result.engine !== ENGINE_VERSION) {
    const released = await db.rpc('release_email_copy', {
      job: result.job,
      lease: result.lease
    })
    if (released.error)
      return { ok: false, code: released.error.code ?? 'error' }
    return { ok: true, state: 'retry' }
  }
  let failure: string | null = 'failure' in result ? result.failure : null
  if ('record' in result) {
    const checked = result.record.leaks.length
      ? { leaks: result.record.leaks.length }
      : await serverLeaks(db, result.job, result.record)
    if (checked === null) return { ok: false, code: 'leak_check_unavailable' }
    if (checked === 'gone') return { ok: false, code: 'PT409' }
    if (checked.leaks) failure = 'copy_leaked'
  }
  const recorded = await db.rpc(
    'record_email_copy',
    failure === null && 'record' in result
      ? {
          job: result.job,
          lease: result.lease,
          result: result.record as unknown as Json
        }
      : { job: result.job, lease: result.lease, failure: failure! }
  )
  if (recorded.error) return { ok: false, code: recorded.error.code ?? 'error' }
  return { ok: true, state: String(recorded.data) }
}

/**
 * The builds whose copies are in (recorded or failed in the last hour, the
 * design step waiting): each goes on now, through its checks and its push,
 * as the owner's click does. A build another job holds is left to it.
 * Then the photos no email needs any more are removed.
 */
export async function runCopiedBuilds(
  db: Db,
  deps: {
    deadline: number
    pusher?: DraftPusher
    env?: Env
    now?: () => number
  }
): Promise<{ off: boolean; builds: number; ran: number; cleaned: number }> {
  const env = deps.env ?? process.env
  if (!copiesOn(env)) return { off: true, builds: 0, ran: 0, cleaned: 0 }
  const now = deps.now ?? Date.now
  const { data, error } = await db
    .from('email_copies')
    .select('build_id')
    .in('state', ['done', 'failed'])
    .gte('updated_at', new Date(now() - 3_600_000).toISOString())
    .order('updated_at', { ascending: true })
    .limit(copyLimits.carryBuilds * 4)
  if (error) throw error
  const ids = (data ?? []).map((r) => r.build_id)
  const builds = ids.length
    ? await db
        .from('email_builds')
        .select('id')
        .in('id', ids)
        .eq('state', 'build_queued')
        .eq('step', 'design')
        .limit(copyLimits.carryBuilds)
    : { data: [], error: null }
  if (builds.error) throw builds.error
  let ran = 0
  let n = 0
  for (const b of builds.data ?? []) {
    if (now() > deps.deadline) break
    n++
    const done = await runEmailBuilds(db, {
      build: b.id,
      // Each kind of copy with its own switch (DES-ENGINE-004b).
      library: libraryCopyOn(env),
      scratch: libraryScratchOn(env),
      deadline: deps.deadline,
      ...(deps.pusher ? { pusher: deps.pusher } : {}),
      now
    })
    ran += done.ran
  }
  const cleaned =
    now() < deps.deadline
      ? await cleanCopyPhotos(db, { now }).catch((e: { code?: string }) => {
          logger.warn('Copy photos not cleaned', { code: e?.code ?? 'error' })
          return 0
        })
      : 0
  return { off: false, builds: n, ran, cleaned }
}

/**
 * Removes the cut photos no email needs any more, once each (idempotent:
 * `clean_email_copy` marks the copy): a copy that failed, a build that
 * failed or is gone, an email drawn with coded blocks instead, and a
 * drafted copy's photos after their links' 30 days (Klaviyo keeps its own
 * imported copies). Copies whose build is still being made are left.
 */
export async function cleanCopyPhotos(
  db: Db,
  { now = Date.now }: { now?: () => number } = {}
): Promise<number> {
  const old = now() - copyLimits.keepDays * 86_400_000
  const since = new Date(old).toISOString()
  // The oldest past their 30 days, and the newest (an email that just
  // fell back to coded blocks): kept emails never block the others.
  const pick = () =>
    db
      .from('email_copies')
      .select('build_id,tenant_id,state,updated_at')
      .is('cleaned_at', null)
      .neq('state', 'queued')
  const [past, recent] = await Promise.all([
    pick()
      .lt('updated_at', since)
      .order('updated_at', { ascending: true })
      .limit(copyLimits.cleanCopies),
    pick()
      .gte('updated_at', since)
      .order('updated_at', { ascending: false })
      .limit(copyLimits.cleanCopies)
  ])
  if (past.error) throw past.error
  if (recent.error) throw recent.error
  const copies = [
    ...new Map(
      [...(past.data ?? []), ...(recent.data ?? [])].map((c) => [c.build_id, c])
    ).values()
  ]
  if (!copies.length) return 0
  const builds = await db
    .from('email_builds')
    .select('id,state,library:email->library')
    .in(
      'id',
      copies.map((c) => c.build_id)
    )
  if (builds.error) throw builds.error
  const byId = new Map(
    (builds.data as { id: string; state: string; library: unknown }[]).map(
      (b) => [b.id, b]
    )
  )
  let cleaned = 0
  for (const c of copies) {
    const b = byId.get(c.build_id)
    const unneeded =
      c.state === 'failed' ||
      !b ||
      b.state === 'failed' ||
      (b.state !== 'build_queued' && !b.library) ||
      (!!b.library && Date.parse(c.updated_at) < old)
    if (!unneeded) continue
    const files = db.storage.from('email-copies')
    const folder = `${c.tenant_id}/${c.build_id}`
    const claims = await files.list(folder, { limit: 100 })
    if (claims.error) throw claims.error
    const paths: string[] = []
    for (const entry of claims.data ?? []) {
      // A claim's folder (no id) holds its photos; a file is one itself.
      if (entry.id) {
        paths.push(`${folder}/${entry.name}`)
        continue
      }
      const inside = await files.list(`${folder}/${entry.name}`, { limit: 100 })
      if (inside.error) throw inside.error
      for (const f of inside.data ?? [])
        paths.push(`${folder}/${entry.name}/${f.name}`)
    }
    if (paths.length) {
      const removed = await files.remove(paths)
      if (removed.error) throw removed.error
    }
    const marked = await db.rpc('clean_email_copy', { build: c.build_id })
    if (marked.error) throw marked.error
    cleaned++
  }
  return cleaned
}
