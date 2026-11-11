import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { historySnapshot, localParts, type HistorySnapshot } from './facts'

/**
 * What the brand already sent, as the strategy agents read it (ONB-103):
 * the counted history the Klaviyo historian stored, checked on the way
 * out. RLS lets any active member read it.
 */
export type StoredHistory = {
  history: HistorySnapshot
  /** When it was read from Klaviyo. */
  readAt: string
  /** False when the read stopped before the end (time or page limits). */
  complete: boolean
  live: boolean
}

export async function readKlaviyoHistory(
  db: SupabaseClient<Database>,
  tenantId: string
): Promise<StoredHistory | null> {
  const { data, error } = await db
    .from('klaviyo_history')
    .select('snapshot,read_at,complete,live')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) throw error
  if (!data?.snapshot) return null
  const parsed = historySnapshot.safeParse(data.snapshot)
  // A history of a shape this version does not know is not handed on.
  if (!parsed.success) return null
  return {
    history: parsed.data,
    readAt: data.read_at,
    complete: data.complete,
    live: data.live
  }
}

/** The send hours "Plan next 15 days" takes (features/strategy/plan.ts). */
const sendHours = { from: 7, to: 21 }

/**
 * The history in the shape "Plan next 15 days" takes (lane A's
 * `StrategyData`): emails a week (2 to 4), the usual send time (within its
 * send hours), the audiences, the days already scheduled from `start` for
 * `days` days, and the latest results.
 */
export function planFromHistory(
  history: HistorySnapshot,
  window: { start: string; days: number }
) {
  const end = new Date(
    Date.parse(`${window.start}T00:00:00Z`) + window.days * 86_400_000
  )
    .toISOString()
    .slice(0, 10)
  const hour = history.usualSendTime
    ? Number(history.usualSendTime.slice(0, 2))
    : null
  return {
    sendsPerWeek: Math.min(4, Math.max(2, Math.round(history.sendsPerWeek))) as
      2 | 3 | 4,
    sendTime:
      hour === null
        ? null
        : `${String(Math.min(sendHours.to, Math.max(sendHours.from, hour))).padStart(2, '0')}:00`,
    audiences: history.audiences
      .filter((a) => a.active)
      .map((a) => ({ id: a.id, label: a.name })),
    existing: history.scheduled
      .filter((e) => e.date >= window.start && e.date < end)
      .flatMap((e) =>
        e.audienceIds.length
          ? [{ date: e.date, audienceId: e.audienceIds[0]!, offer: e.offer }]
          : []
      ),
    results: history.sent.slice(0, 20).map((e) => ({
      title: (e.subject ?? e.name ?? 'Email').slice(0, 200),
      sentOn: localParts(e.sentAt, history.timezone).date,
      clicks: e.clicks ?? 0,
      revenue: e.revenue ?? 0
    }))
  }
}
