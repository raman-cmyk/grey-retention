import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'

export type SiteReadingStart =
  | { ok: true; jobId: string }
  | { ok: false; code: 'no_website' | 'access_denied' | 'unavailable' }

/**
 * Starts a read of the brand's own website (ONB-101), as the workspace
 * owner: at most one a day, asking again the same day returns the same
 * job. The workspace jobs run it at the next sweep.
 */
export async function startSiteReading(
  db: SupabaseClient<Database>,
  tenantId: string
): Promise<SiteReadingStart> {
  const { data, error } = await db.rpc('start_site_reading', { t: tenantId })
  if (error)
    return {
      ok: false,
      code:
        error.code === '23514'
          ? 'no_website'
          : error.code === '42501'
            ? 'access_denied'
            : 'unavailable'
    }
  return { ok: true, jobId: data as string }
}
