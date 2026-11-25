import 'server-only'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/lib/supabase/database.types'
import { logger } from '@/lib/logger'
import {
  parseBlueprint,
  type Blueprint
} from '@/features/design-engine/blueprint'
import {
  blueprintFailures,
  checkStored,
  ENGINE_VERSION,
  type BlueprintFailure
} from '@/features/design-engine/stored'

type Db = SupabaseClient<Database>

/**
 * DES-ENGINE-002: the blueprint browser job's side in the app. A server
 * function cannot run Chromium, so the scheduled browser job (GitHub
 * Actions, `scripts/inbox-blueprints.mjs`) asks for one Inspiration email
 * at a time (`blueprintJobs`: its marked HTML and stored pictures as
 * short-lived signed links, nothing else), measures it in the locked
 * browser and reports the blueprint, pictures and links already dropped;
 * `finishBlueprint` checks it again against the blueprint schema, drops
 * any picture or link it still has, and stores it once
 * (`record_inbox_blueprint`). An email that can never be measured is
 * stored as failed with its reason; a slow browser is tried again later
 * (`fail_platform_job`, up to 4 tries).
 */

export const blueprintLimits = {
  /** One email per call: the browser asks again for the next. */
  perCall: 1,
  /** How long the signed links work. */
  linkSeconds: 600,
  /** A report's largest body (a stored blueprint is at most 500,000 characters). */
  bodyBytes: 600_000
}

export type BlueprintJob = {
  job: string
  lease: string
  /** The marked HTML (our own splitter's marks). */
  html: string
  /** Each stored picture, to put in place of `ref`. */
  images: { ref: string; url: string }[]
}

type Lease = { id: string; lease_token: string; subject_key: string }

async function fail(db: Db, job: string, lease: string, code: string) {
  const failed = await db.rpc('fail_platform_job', {
    job,
    lease,
    failure: code === 'timeout' ? 'timeout' : 'protocol',
    error_code: code
  })
  if (failed.error)
    logger.warn('Blueprint job failure not recorded', {
      code: failed.error.code ?? 'unknown',
      failure: code
    })
}

/** How many blueprints are due now (claims nothing). */
export async function blueprintsWaiting(db: Db) {
  const { count, error } = await db
    .from('platform_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('kind', 'inbox.blueprint')
    .in('status', ['queued', 'retry_wait'])
    .lte('available_at', new Date().toISOString())
  if (error) throw error
  return count ?? 0
}

/** Claims up to `perCall` blueprint jobs and signs what each one needs. */
export async function blueprintJobs(db: Db): Promise<BlueprintJob[]> {
  const jobs: BlueprintJob[] = []
  for (let i = 0; i < blueprintLimits.perCall; i++) {
    const claimed = await db.rpc('claim_platform_job', {
      kinds: ['inbox.blueprint']
    })
    if (claimed.error) throw claimed.error
    const job = (claimed.data as unknown as Lease[] | null)?.[0]
    if (!job) break
    const message = await db
      .from('inbox_messages')
      .select('id,marked_html_path')
      .eq('id', job.subject_key)
      .single()
    const images = await db
      .from('inbox_message_images')
      .select('source_ref,path')
      .eq('inbox_message_id', job.subject_key)
      .eq('state', 'stored')
      .in('source', ['remote', 'cid'])
    if (message.error || !message.data?.marked_html_path || images.error) {
      await fail(db, job.id, job.lease_token, 'inbox_message_missing')
      continue
    }
    const [html, signed] = await Promise.all([
      db.storage
        .from('inbox-raw')
        .createSignedUrl(
          message.data.marked_html_path,
          blueprintLimits.linkSeconds
        ),
      images.data.length
        ? db.storage
            .from('inbox-assets')
            .createSignedUrls(
              [...new Set(images.data.map((r) => r.path!))],
              blueprintLimits.linkSeconds
            )
        : Promise.resolve({ data: [], error: null })
    ])
    if (html.error || signed.error || !html.data) {
      await fail(db, job.id, job.lease_token, 'blueprint_links_failed')
      continue
    }
    const urlByPath = new Map(
      (signed.data ?? []).map((s) => [s.path ?? '', s.signedUrl])
    )
    jobs.push({
      job: job.id,
      lease: job.lease_token,
      html: html.data.signedUrl,
      images: images.data.flatMap((r) => {
        const url = urlByPath.get(r.path ?? '')
        return url ? [{ ref: r.source_ref, url }] : []
      })
    })
  }
  return jobs
}

const failureCodes = Object.keys(blueprintFailures) as [
  BlueprintFailure,
  ...BlueprintFailure[]
]

export const blueprintResult = z.union([
  z.object({
    job: z.uuid(),
    lease: z.uuid(),
    /** The version the job measured with (`ENGINE_VERSION`). */
    engine: z.string().min(1).max(40),
    blueprint: z.unknown().refine((v) => v !== undefined)
  }),
  z.object({
    job: z.uuid(),
    lease: z.uuid(),
    engine: z.string().min(1).max(40),
    failure: z.enum(failureCodes)
  }),
  z.object({
    job: z.uuid(),
    lease: z.uuid(),
    retry: z.enum(['timeout', 'unopened', 'html_unreadable'])
  })
])

/**
 * Records one result: a blueprint (checked against the schema again,
 * pictures and links dropped, at most 500,000 characters), a failure that
 * is final, or one worth another try. A job that measured with another
 * engine version (the browser job and the app briefly running different
 * code after a merge), or a blueprint this app's schema refuses, is tried
 * again later, never stored as failed: only the measuring job itself
 * says an email can never be measured.
 */
export async function finishBlueprint(
  db: Db,
  result: z.infer<typeof blueprintResult>
): Promise<{ ok: true; state: string } | { ok: false; code: string }> {
  if ('retry' in result) {
    await fail(db, result.job, result.lease, result.retry)
    return { ok: true, state: 'retry' }
  }
  if (result.engine !== ENGINE_VERSION) {
    await fail(db, result.job, result.lease, 'version_skew')
    return { ok: true, state: 'retry' }
  }
  let blueprint: Blueprint | null = null
  let failure: BlueprintFailure | null = null
  if ('failure' in result) failure = result.failure
  else {
    const checked = checkStored(result.blueprint)
    if (!checked.ok) {
      await fail(db, result.job, result.lease, `app_${checked.failure}`)
      return { ok: true, state: 'retry' }
    }
    blueprint = checked.blueprint
  }
  const recorded = await db.rpc('record_inbox_blueprint', {
    job: result.job,
    lease: result.lease,
    ...(blueprint
      ? { blueprint: blueprint as unknown as Json }
      : { failure: failure! })
  })
  if (recorded.error) return { ok: false, code: recorded.error.code ?? 'error' }
  return { ok: true, state: String(recorded.data) }
}

/**
 * An inspiration email's blueprint as the email build reads it (service
 * role): `ready` with the blueprint, `failed` with the reason in plain
 * words, `waiting` while the browser job has not measured it yet (asked
 * for now on first use), or `none` (the email has no marked copy to
 * measure). **No workspace check here**: the caller reads only an email
 * the workspace follows (as `create_email_build` checks it).
 */
export type StoredBlueprint =
  | { state: 'ready'; blueprint: Blueprint }
  | { state: 'failed'; reason: string }
  | { state: 'waiting' | 'none' }

/** Why a blueprint is missing after four tries (no row was stored). */
export const blueprintGaveUp =
  'The email could not be measured after 4 tries; it is tried again tomorrow.'

export async function inspirationBlueprint(
  db: Db,
  competitorEmailId: string
): Promise<StoredBlueprint> {
  const state = await db.rpc('request_inbox_blueprint', {
    email: competitorEmailId
  })
  if (state.error) throw state.error
  if (state.data === 'waiting' || state.data === 'none')
    return { state: state.data }
  const email = await db
    .from('competitor_emails')
    .select('inbox_message_id')
    .eq('id', competitorEmailId)
    .maybeSingle()
  if (email.error) throw email.error
  if (!email.data?.inbox_message_id) return { state: 'none' }
  const row = await db
    .from('inbox_blueprints')
    .select('state,blueprint,failure')
    .eq('inbox_message_id', email.data.inbox_message_id)
    .eq('version', 1)
    .maybeSingle()
  if (row.error) throw row.error
  // A job that failed four times stores no row.
  if (!row.data) return { state: 'failed', reason: blueprintGaveUp }
  if (row.data.state === 'ready') {
    const parsed = parseBlueprint(row.data.blueprint)
    if (parsed.ok) return { state: 'ready', blueprint: parsed.blueprint }
    return { state: 'failed', reason: blueprintFailures.not_valid }
  }
  const code = row.data.failure as BlueprintFailure | null
  return {
    state: 'failed',
    reason:
      (code && blueprintFailures[code]) ?? 'The email could not be measured.'
  }
}
