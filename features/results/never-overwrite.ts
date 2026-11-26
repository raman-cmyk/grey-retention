import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import type { EmailStatus } from './sync'

type Db = SupabaseClient<Database>

/**
 * PICK-99, never overwrite: what the owner did in Klaviyo with a draft GROS
 * put there, as the results sync last read it, and the push refusal it
 * means. Any push (or re-push) of the same planned email, which uses the
 * same push key and so the same draft, is refused before the pusher is
 * called, whichever pusher it is. The live pusher also reads the draft
 * itself and refuses (PSH-001: `not_a_draft`, `externally_modified`);
 * this guard is the same rule from what the app already knows, also when
 * Klaviyo cannot be read at that moment.
 */
export type KlaviyoRefusal =
  | 'sent_in_klaviyo'
  | 'scheduled_in_klaviyo'
  | 'deleted_in_klaviyo'
  | 'cancelled_in_klaviyo'
  | 'edited_in_klaviyo'

export type SeenInKlaviyo = {
  status: EmailStatus | string
  changed: boolean
  design_changed: boolean
}

/**
 * The refusal for what was seen: sent (or sending), then scheduled, then
 * deleted, then cancelled, then any edit (its words or its design). A draft
 * as GROS left it, or one only past its day (`stale`), is no refusal.
 */
export function refusalFor(
  seen: readonly SeenInKlaviyo[]
): KlaviyoRefusal | null {
  const has = (...s: string[]) => seen.some((r) => s.includes(r.status))
  if (has('sent', 'sending')) return 'sent_in_klaviyo'
  if (has('scheduled')) return 'scheduled_in_klaviyo'
  if (has('deleted')) return 'deleted_in_klaviyo'
  if (has('cancelled')) return 'cancelled_in_klaviyo'
  if (seen.some((r) => r.changed || r.design_changed))
    return 'edited_in_klaviyo'
  return null
}

/**
 * The refusal for a planned email's push key in a workspace: what the sync
 * read of every draft made with that key (null: none, or nothing the owner
 * did). Read with the worker's service-role client; a read that fails
 * throws, so the push waits for the next try rather than going ahead blind.
 */
export async function storedRefusal(
  db: Db,
  tenantId: string,
  pushKey: string
): Promise<KlaviyoRefusal | null> {
  const { data, error } = await db
    .from('klaviyo_email_results')
    .select('status,changed,design_changed,email_builds!inner(push_key)')
    .eq('tenant_id', tenantId)
    .eq('email_builds.push_key', pushKey)
  if (error) throw error
  return refusalFor((data ?? []) as SeenInKlaviyo[])
}
