import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { logger } from '@/lib/logger'
import { klaviyoMode, revisionOk } from '@/features/connections/live-klaviyo'
import { ProviderFault } from '@/features/integrations/failures'
import {
  KlaviyoError,
  klaviyoClient,
  type KlaviyoClient,
  type KlaviyoTransport
} from '@/lib/providers/klaviyo/client'
import { recordedCatalogTransport } from '@/lib/providers/klaviyo/recorded-catalog'
import { cappedEnv, jobFailure, siteAsk, siteCallTimeoutMs } from '../site/live'
import { klaviyoCallMs, readBrandCatalog, type CatalogRun } from './worker'

type Db = SupabaseClient<Database>
type Job = Database['public']['Tables']['job_runs']['Row']

/** The key the sample catalog is read with (never sent anywhere). */
export const sampleKlaviyoKey = 'pk_SAMPLECATALOG000000000000'

export type CatalogSource =
  | { client: KlaviyoClient; live: boolean }
  | {
      /** Why nothing is read (logged; the job stops). */
      reason:
        | 'connection_changed'
        | 'klaviyo_off'
        | 'klaviyo_revision'
        | 'no_key'
        | 'not_sample'
    }

/**
 * Which Klaviyo a catalog read reads. A live connection is read with its
 * stored key, only while the owner's switch `KLAVIYO_MODE=live` is on (a
 * short rate limit is not waited out: the job is put back instead). A
 * sample connection reads the recorded sample store, and only for a
 * synthetic brand: a real brand never gets sample products. The connection
 * must still be the one the job was started for.
 */
export async function catalogSourceFor(
  db: Db,
  job: Job,
  env: NodeJS.ProcessEnv,
  /** The recorded sample account this read uses (the catalog's by default). */
  sample: (domain: string) => KlaviyoTransport = (domain) =>
    recordedCatalogTransport({ store: 'shopify', domain })
): Promise<CatalogSource> {
  const mode = (job.input as { mode?: unknown } | null)?.mode
  const connection = await db
    .from('workspace_connections')
    .select('mode,status')
    .eq('tenant_id', job.tenant_id)
    .eq('provider', 'klaviyo')
    .maybeSingle()
  if (connection.error) throw connection.error
  if (
    !connection.data ||
    connection.data.status !== 'connected' ||
    connection.data.mode !== mode
  )
    return { reason: 'connection_changed' }
  if (mode === 'live') {
    if (klaviyoMode(env) !== 'live') return { reason: 'klaviyo_off' }
    if (!revisionOk(env)) return { reason: 'klaviyo_revision' }
    const key = await db.rpc('klaviyo_api_key', { t: job.tenant_id })
    if (key.error) throw key.error
    if (!key.data) return { reason: 'no_key' }
    return {
      client: klaviyoClient(key.data, {
        maxWaits: 0,
        timeoutMs: klaviyoCallMs
      }),
      live: true
    }
  }
  const brand = await db
    .from('brand_profiles')
    .select('domain,synthetic')
    .eq('tenant_id', job.tenant_id)
    .single()
  if (brand.error) throw brand.error
  if (!brand.data.synthetic) return { reason: 'not_sample' }
  const domain =
    brand.data.domain
      .trim()
      .toLowerCase()
      .replace(/^www\./, '') || 'cedar.example'
  return {
    client: klaviyoClient(sampleKlaviyoKey, {
      transport: sample(domain),
      maxWaits: 0
    }),
    live: false
  }
}

const pauses = {
  rate_limited: 'rate_limited',
  bad_key: 'klaviyo_key_rejected',
  missing_scope: 'klaviyo_scope_missing'
} as const

export type PauseReason = (typeof pauses)[keyof typeof pauses]
export type CatalogReading =
  | ({ outcome: 'read' } & CatalogRun)
  | { outcome: 'paused'; reason: PauseReason }

/**
 * A Klaviyo failure of a source read, handled the same way for every
 * Klaviyo reader: a rate limit, a refused key or a missing scope pauses the
 * job (`pause_source_reading`); an outage is tried again; anything else
 * stops it. What Klaviyo said is logged, never the key.
 */
export async function pauseOnKlaviyo(
  db: Db,
  job: Job,
  error: KlaviyoError,
  label: string
): Promise<{ outcome: 'paused'; reason: PauseReason }> {
  const reason = (pauses as Record<string, PauseReason>)[error.kind]
  if (!reason) {
    logger.warn(`${label}: Klaviyo failed`, {
      kind: error.kind,
      endpoint: error.details.endpoint,
      status: error.details.status ?? 0,
      code: error.details.code ?? 'none'
    })
    throw new ProviderFault(
      error.kind === 'unavailable' ? 'transient' : 'validation'
    )
  }
  logger.warn(`${label} paused`, {
    reason,
    endpoint: error.details.endpoint,
    retryAfterSeconds: error.details.retryAfterSeconds ?? 0
  })
  const paused = await db.rpc('pause_source_reading', {
    job: job.id,
    lease: job.lease_token!,
    reason,
    ...(error.details.retryAfterSeconds !== undefined
      ? { seconds: error.details.retryAfterSeconds }
      : {})
  })
  if (paused.error) throw paused.error
  return { outcome: 'paused', reason }
}

/**
 * One catalog read as the readers' run does it: every Klaviyo request
 * capped at `klaviyoCallMs`, the analyst's call at `siteCallTimeoutMs`.
 * Klaviyo's rate limit puts the job back for when Klaviyo says (no try
 * used); a refused key or a missing scope stops it and tells the owner.
 * An outage is tried again; anything else stops the job.
 */
export async function runCatalogReadingJob(
  db: Db,
  job: Job,
  env: NodeJS.ProcessEnv = process.env
): Promise<CatalogReading> {
  const capped = cappedEnv(env)
  const source = await catalogSourceFor(db, job, capped)
  if ('reason' in source) {
    logger.warn('Catalog read not started', { reason: source.reason })
    throw new ProviderFault('validation')
  }
  try {
    const run = await readBrandCatalog(db, job, {
      client: source.client,
      live: source.live,
      ask: siteAsk(db, job.tenant_id, capped)(source.live),
      callMs: siteCallTimeoutMs
    })
    return { outcome: 'read', ...run }
  } catch (error) {
    if (!(error instanceof KlaviyoError)) throw jobFailure(error)
    return pauseOnKlaviyo(db, job, error, 'Catalog read')
  }
}
