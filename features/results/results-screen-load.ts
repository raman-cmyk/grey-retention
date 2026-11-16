import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { workspaceTimezone } from '@/features/strategy/offers'
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
