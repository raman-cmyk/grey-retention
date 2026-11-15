import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'

/**
 * The workspace's record of who changed the offer limits and Klaviyo
 * (BAS-006), recorded by the database as it happens. Team changes have
 * their own list on the Team page (`teamPage`).
 */
export const changeKinds = [
  'max_discount_changed',
  'margin_floor_changed',
  'discount_code_added',
  'discount_code_retired',
  'klaviyo_connection_changed',
  'klaviyo_key_saved',
  'klaviyo_key_refused'
] as const

export type Change = { id: string; text: string; by: string; at: string }

type Detail = Record<string, unknown>
const text = (v: unknown) => (typeof v === 'string' ? v : null)
const percent = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) ? `${v}%` : null

/** A code's last day, as the store's calendar shows it ("30 Nov 2026"). */
function dayIn(iso: string, timeZone: string) {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone,
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    }).format(at)
  } catch {
    return null
  }
}

/**
 * One recorded change in a plain sentence, or null for one not explained.
 * Dates are the store's (`timeZone`, the workspace's time zone).
 */
export function changeText(
  kind: string,
  detail: Detail,
  timeZone = 'UTC'
): string | null {
  if (kind === 'max_discount_changed') {
    const to = percent(detail.to)
    if (!to) return null
    const from = percent(detail.from)
    return from
      ? `Max discount changed from ${from} to ${to}`
      : `Max discount set to ${to}`
  }
  if (kind === 'margin_floor_changed') {
    const floor = percent(detail.to_floor)
    const margin = percent(detail.to_margin)
    if (!floor || !margin)
      return detail.to_floor === null && detail.to_margin === null
        ? 'Margin floor removed'
        : null
    const was = percent(detail.from_floor)
    const wasMargin = percent(detail.from_margin)
    return was && wasMargin
      ? `Margin floor changed to ${floor} on a ${margin} margin (was ${was} on ${wasMargin})`
      : `Margin floor set to ${floor} on a ${margin} margin`
  }
  const code = text(detail.code)
  if (kind === 'discount_code_added' && code) {
    const off = percent(detail.percent)
    const ends = text(detail.expires_at)
    const until = ends ? dayIn(ends, timeZone) : null
    return `Code ${code} added${off ? ` (${off} off${until ? `, until ${until}` : ''})` : ''}`
  }
  if (kind === 'discount_code_retired' && code)
    return detail.ended === true
      ? `Code ${code} retired: it ended`
      : `Code ${code} retired`
  if (kind === 'klaviyo_connection_changed') {
    const to = text(detail.to_status)
    if (to === 'connected')
      return detail.to_mode === 'live'
        ? 'Klaviyo connected'
        : 'Klaviyo connected (sample data)'
    if (to === 'disconnected') return 'Klaviyo disconnected'
    if (to === 'expired') return 'Klaviyo stopped working with this key'
    if (to === 'error') return 'Klaviyo connection has a problem'
    return null
  }
  const hint = text(detail.hint)
  if (kind === 'klaviyo_key_saved' && hint) return `Klaviyo key ${hint} saved`
  if (kind === 'klaviyo_key_refused' && hint)
    return `Klaviyo refused the key ${hint}`
  return null
}

type Db = SupabaseClient<Database>
type Member = { profileId: string; name: string; email: string; isMe: boolean }

/**
 * The latest recorded changes, newest first: who ("you", a teammate's
 * name, "GROS" when the system did it, "someone" for a person no longer on
 * the team) and what. Null when the record could not be read.
 */
export async function listChangeHistory(
  db: Db,
  tenantId: string,
  members: Member[],
  options: { limit?: number; timeZone?: string } = {}
): Promise<Change[] | null> {
  const limit = options.limit ?? 50
  const log = await db
    .from('workspace_events')
    .select('id,kind,actor_id,detail,created_at')
    .eq('tenant_id', tenantId)
    .in('kind', [...changeKinds])
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(Math.max(1, Math.min(limit, 200)))
  if (log.error) return null
  const byProfile = new Map(members.map((m) => [m.profileId, m]))
  const who = (id: string | null) => {
    if (!id) return 'GROS'
    const m = byProfile.get(id)
    return m ? (m.isMe ? 'you' : m.name || m.email) : 'someone'
  }
  return (log.data ?? []).flatMap((row) => {
    const detail =
      row.detail && typeof row.detail === 'object' && !Array.isArray(row.detail)
        ? (row.detail as Detail)
        : {}
    const line = changeText(row.kind, detail, options.timeZone)
    return line
      ? [{ id: row.id, text: line, by: who(row.actor_id), at: row.created_at }]
      : []
  })
}
