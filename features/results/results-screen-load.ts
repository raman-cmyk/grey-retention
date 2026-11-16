import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { resultsReadModel } from './read-model'
import { resultsScreen, type ResultsScreen } from './results-screen'

/**
 * UI-RES-a: the Results page for the signed-in member's workspace: its
 * Results lines (`resultsReadModel`) and its Klaviyo account's currency
 * for the sales (`workspace_connections`, read by members). Pass the
 * member's client: row security keeps both to the workspace. An unread
 * currency only shows sales as plain amounts.
 */
export async function loadResultsScreen(
  db: SupabaseClient<Database>,
  tenantId: string
): Promise<ResultsScreen> {
  const [lines, connection] = await Promise.all([
    resultsReadModel(db, tenantId),
    db
      .from('workspace_connections')
      .select('account_currency')
      .eq('tenant_id', tenantId)
      .eq('provider', 'klaviyo')
      .maybeSingle()
  ])
  const currency = connection.error
    ? null
    : (connection.data?.account_currency ?? null)
  return resultsScreen(lines, currency)
}
