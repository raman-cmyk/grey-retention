import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'

export type ReviewsReadingStart =
  | { ok: true; jobId: string }
  | { ok: false; code: 'no_website' | 'access_denied' | 'unavailable' }

/**
 * Starts a read of what customers say about the brand (ONB-105), as the
 * workspace owner: at most one a day; asking again the same day returns
 * the same job (a failed one starts again). Needs the brand's website
 * (its product pages hold the reviews). The onboarding readers' run reads
 * it (not the sweep).
 */
export async function startReviewsReading(
  db: SupabaseClient<Database>,
  tenantId: string
): Promise<ReviewsReadingStart> {
  const { data, error } = await db.rpc('start_reviews_reading', { t: tenantId })
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
