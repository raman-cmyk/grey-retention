import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'

export type CatalogReadingStart =
  | { ok: true; jobId: string }
  | {
      ok: false
      code: 'connect_klaviyo' | 'access_denied' | 'unavailable'
    }

/**
 * Starts a read of the Klaviyo catalog (ONB-102), as the workspace owner:
 * at most one a day, asking again the same day returns the same job. Needs
 * a connected Klaviyo (live for a real brand). The onboarding readers' run
 * reads it (not the sweep).
 */
export async function startCatalogReading(
  db: SupabaseClient<Database>,
  tenantId: string
): Promise<CatalogReadingStart> {
  const { data, error } = await db.rpc('start_catalog_reading', {
    t: tenantId
  })
  if (error)
    return {
      ok: false,
      code:
        error.code === '23514'
          ? 'connect_klaviyo'
          : error.code === '42501'
            ? 'access_denied'
            : 'unavailable'
    }
  return { ok: true, jobId: data as string }
}
