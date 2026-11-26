import type { SupabaseClient } from '@supabase/supabase-js'
import { localDate } from '@/features/holidays/entries'
import type { Database } from '@/lib/supabase/database.types'
import { readRevenueGoals, type RevenueGoal } from './revenue-goal'

type Db = SupabaseClient<Database>

/**
 * Owner pick #33: the revenue goal as Settings shows and sets it. The
 * owner types it in words ("$20k this month", `parseRevenueGoal`) for this
 * month or next month (the store's calendar); each month's revision goes
 * back with a save, so a change from another window is refused
 * (`set_revenue_goal`, PT409). Read with the member's own client: row
 * rules keep it to their workspace.
 */
export type GoalMonth = {
  /** YYYY-MM-01, the store's calendar. */
  month: string
  /** "November 2026". */
  label: string
  goal: RevenueGoal | null
  revision: number
}

export type GoalSettings = {
  /** The store's own currency as its catalog was read, when known. */
  currency: string | null
  /** The store's today, YYYY-MM-DD. */
  today: string
  /** This month and next month. */
  months: [GoalMonth, GoalMonth]
}

/** The first days of this month and next month, from the store's today. */
export function goalMonths(today: string): [string, string] {
  const [y, m] = today.split('-').map(Number) as [number, number]
  const first = (year: number, month: number) =>
    `${year}-${String(month).padStart(2, '0')}-01`
  return [first(y, m), m === 12 ? first(y + 1, 1) : first(y, m + 1)]
}

export const monthLabel = (month: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric'
  }).format(new Date(`${month}T00:00:00Z`))

/** An amount in its currency, whole units when it has no cents ("$20,000"). */
export function goalMoney(goal: Pick<RevenueGoal, 'amount' | 'currency'>) {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: goal.currency,
      maximumFractionDigits: Number.isInteger(goal.amount) ? 0 : 2
    }).format(goal.amount)
  } catch {
    return `${goal.amount} ${goal.currency}`
  }
}

/** The store's currency as its catalog read found it, or null. */
export async function storeCurrency(
  db: Db,
  tenantId: string
): Promise<string | null> {
  const { data, error } = await db
    .from('catalog_status')
    .select('currency')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) throw error
  const currency = data?.currency
  return typeof currency === 'string' && /^[A-Z]{3}$/.test(currency)
    ? currency
    : null
}

/** This month's and next month's goals, or null when they cannot be read. */
export async function goalSettings(
  db: Db,
  context: { tenantId: string; timezone: string },
  now = new Date()
): Promise<GoalSettings | null> {
  let today: string
  try {
    today = localDate(context.timezone, now)
  } catch {
    today = localDate('UTC', now)
  }
  const months = goalMonths(today)
  const [goals, currency] = await Promise.all([
    readRevenueGoals(db, context.tenantId, months),
    storeCurrency(db, context.tenantId).catch(() => null)
  ])
  if (!goals) return null
  const of = (month: string): GoalMonth => {
    const row = goals.find((g) => g.month === month)
    return {
      month,
      label: monthLabel(month),
      goal: row?.goal ?? null,
      revision: row?.revision ?? 0
    }
  }
  return { currency, today, months: [of(months[0]), of(months[1])] }
}
