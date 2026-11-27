import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/lib/supabase/database.types'
import { sendTimeEntry, type SendTimeEntry } from './send-times'

type Db = SupabaseClient<Database>

/**
 * PICK-97: the best send times, kept per workspace and audience
 * (`klaviyo_send_times`). Only the history read writes them, under its
 * lease (`record_send_times`, replacing an older read's rows, never a
 * newer one's); the workspace's active members read them.
 */

/** Rows older than this are not planned from (the history is re-read before). */
export const sendTimesFreshDays = 30
const day = 86_400_000

/**
 * Replaces the workspace's rows with this read's (worker only, under the
 * job's lease). How many rows were kept (0 when a newer read kept its own).
 */
export async function recordSendTimes(
  db: Db,
  job: { id: string; lease: string },
  timezone: string,
  entries: readonly SendTimeEntry[]
): Promise<number> {
  const kept = entries.filter((e) => sendTimeEntry.safeParse(e).success)
  const { data, error } = await db.rpc('record_send_times', {
    job: job.id,
    lease: job.lease,
    timezone,
    times: kept as unknown as Json
  })
  if (error) throw error
  return typeof data === 'number' ? data : 0
}

export type StoredSendTimes = {
  entries: SendTimeEntry[]
  timezone: string
  live: boolean
  readAt: string
}

/**
 * The workspace's stored send times, checked on the way out (a row of a
 * shape this version does not know is left out), or null when none were
 * kept or they are older than `sendTimesFreshDays`.
 */
export async function readSendTimes(
  db: Db,
  tenantId: string,
  now = new Date()
): Promise<StoredSendTimes | null> {
  const { data, error } = await db
    .from('klaviyo_send_times')
    .select(
      'audience_id,facts,best_hour,best_weekday,compared,reason,timezone,live,read_at'
    )
    .eq('tenant_id', tenantId)
    .limit(200)
  if (error) throw error
  const rows = data ?? []
  if (!rows.length) return null
  const first = rows[0]!
  const age = now.getTime() - Date.parse(first.read_at)
  if (!(age >= -60_000 && age <= sendTimesFreshDays * day)) return null
  const entries = rows.flatMap((r) => {
    const parsed = sendTimeEntry.safeParse({
      audienceId: r.audience_id,
      facts: r.facts,
      bestHour: r.best_hour,
      bestWeekday: r.best_weekday,
      compared: r.compared,
      reason: r.reason
    })
    return parsed.success ? [parsed.data] : []
  })
  return {
    entries,
    timezone: first.timezone,
    live: first.live,
    readAt: first.read_at
  }
}
