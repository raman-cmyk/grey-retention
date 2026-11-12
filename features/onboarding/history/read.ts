import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import type { PlanInput } from '@/features/strategy/plan'
import { historySnapshot, sendParts, type HistorySnapshot } from './facts'

/**
 * What the brand already sent, as the strategy agents read it (ONB-103):
 * the counted history the Klaviyo historian stored, checked on the way
 * out. RLS lets any active member read it.
 */
export type StoredHistory = {
  history: HistorySnapshot
  /** `paused` when a later read stopped (the key needs the owner). */
  state: 'ready' | 'empty' | 'paused'
  reason: string | null
  /** When it was read from Klaviyo. */
  readAt: string
  /** False when the read stopped before the end (time or page limits). */
  complete: boolean
  live: boolean
}

const states = ['ready', 'empty', 'paused'] as const

export async function readKlaviyoHistory(
  db: SupabaseClient<Database>,
  tenantId: string
): Promise<StoredHistory | null> {
  const { data, error } = await db
    .from('klaviyo_history')
    .select('snapshot,state,reason,read_at,complete,live')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) throw error
  if (!data?.snapshot) return null
  const parsed = historySnapshot.safeParse(data.snapshot)
  // A history of a shape this version does not know is not handed on.
  if (!parsed.success) return null
  return {
    history: parsed.data,
    state: (states as readonly string[]).includes(data.state)
      ? (data.state as StoredHistory['state'])
      : 'paused',
    reason: data.reason,
    readAt: data.read_at,
    complete: data.complete,
    live: data.live
  }
}

/** The send hours "Plan next 15 days" takes (features/strategy/plan.ts). */
const sendHours = { from: 7, to: 21 }
/** The plan takes at most 50 audiences and 200 sends already planned. */
const maxAudiences = 50
const maxExisting = 200
/** A send whose audience is not known still takes its day. */
export const unknownAudience = 'unknown-audience'
const day = 86_400_000

const shift = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * day)
    .toISOString()
    .slice(0, 10)

/**
 * The history in the shape "Plan next 15 days" takes (lane A's
 * `StrategyData` and `readPlanInput`): emails a week (2 to 4), the usual
 * send time (within its send hours), at most 50 audiences (starred and
 * segments first, never a suppression list), the sends already made or
 * scheduled from 7 days before `start` to the window's end (they count
 * against the weekly cap, the offer share and the offer spacing; one with
 * no known audience still counts), and the latest results that were read.
 */
export function planFromHistory(
  history: HistorySnapshot,
  window: { start: string; days: number }
): Pick<PlanInput, 'sendsPerWeek' | 'audiences' | 'existing'> & {
  sendTime: string | null
  /** The pulse's `results` rows (features/strategy/pulse.ts). */
  results: { title: string; sentOn: string; clicks: number; revenue: number }[]
} {
  const from = shift(window.start, -7)
  const end = shift(window.start, window.days)
  const hour = history.usualSendTime
    ? Number(history.usualSendTime.slice(0, 2))
    : null
  const audiences = history.audiences
    .filter((a) => a.active && !a.excludedOnly)
    .sort(
      (a, b) =>
        Number(b.starred) - Number(a.starred) ||
        Number(b.kind === 'segment') - Number(a.kind === 'segment')
    )
    .slice(0, maxAudiences)
    .map((a) => ({ id: a.id, label: a.name }))
  const sent = history.sent
    .map((e) => ({
      date: sendParts(e.sentAt, e.strategy, history.timezone).date,
      offer: e.offer
    }))
    .filter((e) => e.date >= from && e.date < end)
    .map((e) => ({ ...e, audienceId: unknownAudience }))
  const scheduled = history.scheduled
    .filter((e) => e.date >= from && e.date < end)
    .map((e) => ({
      date: e.date,
      audienceId: e.audienceIds[0] ?? unknownAudience,
      offer: e.offer
    }))
  return {
    sendsPerWeek: Math.min(4, Math.max(2, Math.round(history.sendsPerWeek))) as
      2 | 3 | 4,
    sendTime:
      hour === null
        ? null
        : `${String(Math.min(sendHours.to, Math.max(sendHours.from, hour))).padStart(2, '0')}:00`,
    audiences,
    // The latest 200: the window's own days before the week before it.
    existing: [...sent, ...scheduled]
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-maxExisting),
    results: history.sent
      .filter(
        (e) => e.recipients !== null && e.clicks !== null && e.revenue !== null
      )
      .slice(0, 20)
      .map((e) => ({
        title: (e.subject ?? e.name ?? 'Email').slice(0, 200),
        sentOn: sendParts(e.sentAt, e.strategy, history.timezone).date,
        clicks: e.clicks!,
        revenue: e.revenue!
      }))
  }
}
