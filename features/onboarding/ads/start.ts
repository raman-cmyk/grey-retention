import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'

export type AdsReadingStart =
  | { ok: true; jobId: string }
  | { ok: false; code: 'no_website' | 'access_denied' | 'unavailable' }

/**
 * Starts a read of the brand's live ads (ONB-104), as the workspace
 * owner: at most one a day; asking again the same day returns the same
 * job (a failed one starts again). Needs the brand's website (the ads
 * kept are those of the page sending people to it). The onboarding
 * readers' run reads it (not the sweep).
 */
export async function startAdsReading(
  db: SupabaseClient<Database>,
  tenantId: string
): Promise<AdsReadingStart> {
  const { data, error } = await db.rpc('start_ads_reading', { t: tenantId })
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
