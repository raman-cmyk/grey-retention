import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Database } from '@/lib/supabase/database.types'

/**
 * PICK-99: a platform operator clears a design change the sync saw in error
 * (Klaviyo re-saving our HTML, for example), saying why. The database
 * (`clear_klaviyo_design_change`) checks the operator on the caller's own
 * session, refuses while a check holds the row, and records the reason and
 * the evidence in `workspace_events`. Pass the operator's own client (never
 * the service role: the event names who cleared it). No screen calls it
 * yet (an admin page needs its design).
 */
const input = z.object({
  buildId: z.uuid(),
  reason: z.string().trim().min(3).max(500)
})

export type ClearResult =
  { ok: true } | { ok: false; code: 'invalid' | 'denied' | 'busy' | 'failed' }

export async function clearDesignChange(
  db: SupabaseClient<Database>,
  raw: unknown
): Promise<ClearResult> {
  const parsed = input.safeParse(raw)
  if (!parsed.success) return { ok: false, code: 'invalid' }
  const { error } = await db.rpc('clear_klaviyo_design_change', {
    build: parsed.data.buildId,
    reason: parsed.data.reason
  })
  if (!error) return { ok: true }
  return {
    ok: false,
    code:
      error.code === '42501'
        ? 'denied'
        : error.code === 'PT409'
          ? 'busy'
          : error.code === '23514'
            ? 'invalid'
            : 'failed'
  }
}
