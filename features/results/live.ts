import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { klaviyoMode, revisionOk } from '@/features/connections/live-klaviyo'
import { klaviyoClient } from '@/lib/providers/klaviyo/client'
import { klaviyoCallMs } from '@/features/onboarding/catalog/worker'
import {
  resultsBudgetMs,
  runEmailResults,
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
  env: NodeJS.ProcessEnv = process.env
): Promise<ResultsSource> {
  if (klaviyoMode(env) !== 'live') return { kind: 'off', reason: 'klaviyo_off' }
  if (!revisionOk(env)) return { kind: 'off', reason: 'klaviyo_revision' }
  const connection = await db
    .from('workspace_connections')
    .select('mode,status')
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
  return {
    kind: 'live',
    client: klaviyoClient(key.data, { maxWaits: 0, timeoutMs: klaviyoCallMs })
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
