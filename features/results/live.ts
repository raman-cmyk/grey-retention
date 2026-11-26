import 'server-only'
import { after } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { klaviyoMode, revisionOk } from '@/features/connections/live-klaviyo'
import { klaviyoClient } from '@/lib/providers/klaviyo/client'
import { klaviyoCallMs } from '@/features/onboarding/catalog/worker'
import {
  checkEmailNow,
  pageCallMs,
  resultsBudgetMs,
  runEmailResults,
  type PageCheck,
  type ResultsRun,
  type ResultsSource
} from './worker'

type Db = SupabaseClient<Database>

/**
 * Where a workspace's live drafts are read: its own Klaviyo account with
 * its stored key, only while the owner's switch `KLAVIYO_MODE=live` is on
 * and the workspace is still connected live (a short rate limit is not
 * waited out: the check is put back instead). Reads only.
 */
export async function resultsSourceFor(
  db: Db,
  tenantId: string,
  env: NodeJS.ProcessEnv = process.env,
  /** The longest one request may take (default the catalog's `klaviyoCallMs`). */
  timeoutMs: number = klaviyoCallMs
): Promise<ResultsSource> {
  if (klaviyoMode(env) !== 'live') return { kind: 'off', reason: 'klaviyo_off' }
  if (!revisionOk(env)) return { kind: 'off', reason: 'klaviyo_revision' }
  const connection = await db
    .from('workspace_connections')
    .select('mode,status,account_currency')
    .eq('tenant_id', tenantId)
    .eq('provider', 'klaviyo')
    .maybeSingle()
  if (connection.error) throw connection.error
  if (
    connection.data?.status !== 'connected' ||
    connection.data.mode !== 'live'
  )
    return { kind: 'off', reason: 'klaviyo_not_connected' }
  const key = await db.rpc('klaviyo_api_key', { t: tenantId })
  if (key.error) throw key.error
  if (!key.data) return { kind: 'off', reason: 'klaviyo_no_key' }
  const currency = connection.data.account_currency
  return {
    kind: 'live',
    client: klaviyoClient(key.data, { maxWaits: 0, timeoutMs }),
    currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : null
  }
}

/** The hourly results run as the route does it, every Klaviyo request capped. */
export function runResultsSync(
  db: Db,
  env: NodeJS.ProcessEnv = process.env,
  now: () => number = Date.now
): Promise<ResultsRun> {
  return runEmailResults(db, {
    sourceFor: (tenantId) => resultsSourceFor(db, tenantId, env),
    now,
    deadline: now() + resultsBudgetMs,
    callMs: klaviyoCallMs
  })
}

/**
 * PICK-99: an email's page asks Klaviyo how its draft is now (cached: at
 * most once in ten minutes an email, GET only). Its own client gives each
 * request `pageCallMs` at most, and the whole check `pageCheckMs`. The
 * workspace is the signed-in member's own (from the session); only the
 * service role writes what it finds. Never throws.
 */
export async function checkEmailForPage(
  db: Db,
  tenantId: string,
  buildId: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<PageCheck> {
  return checkEmailNow(db, tenantId, buildId, {
    sourceFor: (t) => resultsSourceFor(db, t, env, pageCallMs)
  })
}

/**
 * The email page's check, run after the page is sent (`after`): the page
 * shows what was stored and never waits for Klaviyo; the next open shows
 * what this check found.
 */
export function checkEmailSoon(
  db: Db | null,
  tenantId: string,
  buildId: string,
  schedule: (task: () => Promise<unknown>) => void = after
) {
  if (!db) return
  schedule(() => checkEmailForPage(db, tenantId, buildId))
}
