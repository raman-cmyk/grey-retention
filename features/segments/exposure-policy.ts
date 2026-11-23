import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import {
  defaultExposurePolicy,
  exposurePolicySchema,
  type ExposurePolicy
} from './exposure'

/**
 * A workspace's exposure policy, for the planner and Settings (SEG-EXP-a).
 * With nothing saved, the defaults (`saved: false`, revision 0): chosen
 * for this implementation; Raman has not supplied numbers.
 *
 * Integration note for lane A's planner (not edited here): read the
 * policy once per plan with this, then pass it to `enforceExposure` with
 * the planned slots (each its scheduled instant, its segments and
 * `marketing` or `transactional`), the segments' profile ids, each
 * profile's past sends and the suppressed and unsubscribed profiles. Send
 * each slot only to its `send` list; never widen it. Read with the
 * member's own client (row rules keep it to the workspace) or the
 * worker's for a job. Throws when it cannot be read.
 */
export type ExposurePolicyRead = {
  policy: ExposurePolicy
  /** The revision the next save must name (0 before the first). */
  revision: number
  /** False while the defaults hold. */
  saved: boolean
}

export async function exposurePolicy(
  db: SupabaseClient<Database>,
  tenantId: string
): Promise<ExposurePolicyRead> {
  const { data, error } = await db
    .from('exposure_policies')
    .select('window_days,max_marketing,priority,revision')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) throw error
  if (!data) return { policy: defaultExposurePolicy, revision: 0, saved: false }
  return {
    // The database checks the same bounds; anything else is unreadable.
    policy: exposurePolicySchema.parse({
      windowDays: data.window_days,
      maxMarketing: data.max_marketing,
      priority: data.priority
    }),
    revision: data.revision,
    saved: true
  }
}
