import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import type { ClientRequestContext } from '@/features/auth/domain/types'
import { klaviyoData } from '@/features/klaviyo-data/reader'
import { validTimezone } from '@/lib/brand-time'
import { workspaceTimezone } from '@/features/strategy/offers'
import { klaviyoResults, type KlaviyoResults } from './klaviyo'
import { resultsReadModel } from './read-model'
import { resultsScreen, type ResultsScreen } from './results-screen'

/**
 * UI-RES-a: the Results page for the signed-in member's workspace: its
 * Results lines (`resultsReadModel`) and its Klaviyo account's currency
 * for the sales (`workspace_connections`, read by members) and the store's
 * time zone (`tenants`) for the days. Pass the
 * member's client: row security keeps both to the workspace. An unread
 * currency only shows sales as plain amounts.
 */
export async function loadResultsScreen(
  db: SupabaseClient<Database>,
  tenantId: string
): Promise<ResultsScreen> {
  const [lines, connection, timezone] = await Promise.all([
    resultsReadModel(db, tenantId),
    db
      .from('workspace_connections')
      .select('account_currency')
      .eq('tenant_id', tenantId)
      .eq('provider', 'klaviyo')
      .maybeSingle(),
    // Days in store time; an unread time zone: UTC.
    workspaceTimezone(db, tenantId).catch(() => 'UTC')
  ])
  const currency = connection.error
    ? null
    : (connection.data?.account_currency ?? null)
  let today: string | undefined
  try {
    today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(
      new Date()
    )
  } catch {
    today = undefined
  }
  return resultsScreen(lines, { currency, timezone, today })
}

/**
 * UI-KLV: the Klaviyo account's own campaigns, flows and metrics for the
 * signed-in member's workspace, in its time zone. Null when Klaviyo cannot
 * be read: Results still shows the emails GROS made.
 */
export async function loadKlaviyoResults(
  context: ClientRequestContext,
  now = new Date()
): Promise<KlaviyoResults | null> {
  const timezone = validTimezone(context.timezone)
  try {
    return klaviyoResults(
      await klaviyoData(context.tenantId, timezone, now.getTime()),
      timezone,
      now
    )
  } catch {
    return null
  }
}
