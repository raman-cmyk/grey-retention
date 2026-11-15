import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'

/**
 * PLN-033a (owner pick #33, D27): the owner's revenue goal for a month.
 * "$20k this month": the email revenue Klaviyo reports for that month, in
 * the store's currency. PLN-033b works out what the next 15 days need.
 */
export type RevenueGoal = {
  /** The first day of the month (YYYY-MM-01, the store's calendar). */
  month: string
  amount: number
  currency: string
}

/** Currencies a goal may name (a code before or after the amount). */
const codes = [
  'USD',
  'AUD',
  'CAD',
  'NZD',
  'SGD',
  'HKD',
  'MXN',
  'GBP',
  'EUR',
  'INR',
  'JPY',
  'CHF',
  'SEK',
  'NOK',
  'DKK',
  'ZAR',
  'AED',
  'BRL'
]
/** Stores whose own currency is written with a plain "$". */
const dollarStores = new Set(['USD', 'AUD', 'CAD', 'NZD', 'SGD', 'HKD', 'MXN'])
/** Symbols that name one currency (a plain "$" and "¥" depend on the store). */
const symbols: Record<string, string> = {
  us$: 'USD',
  a$: 'AUD',
  au$: 'AUD',
  c$: 'CAD',
  ca$: 'CAD',
  nz$: 'NZD',
  s$: 'SGD',
  hk$: 'HKD',
  '€': 'EUR',
  '£': 'GBP',
  '₹': 'INR'
}
const months = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december'
]
const escape = (s: string) => s.replace(/[$]/g, '\\$')
const codeWord = codes.map((c) => c.toLowerCase()).join('|')
const symbol = [...Object.keys(symbols), '$', '¥'].map(escape).join('|')
const monthWord = [...months, ...months.map((m) => m.slice(0, 3)), 'sept'].join(
  '|'
)
/** Words that may come first ("goal: $20k next month"); anything else is refused. */
const leads = [
  'goal',
  'goal is',
  'our goal is',
  'my goal is',
  'revenue goal',
  'revenue goal is',
  'target',
  'target is',
  'aim for',
  'i want',
  'we want',
  'set the goal to',
  'set goal to',
  'set a goal of',
  'set'
].join('|')
const money = `(?:(?<before>${codeWord})\\s?)?(?<sign>${symbol})?\\s?(?<digits>\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.(?<decimals>\\d{1,2}))?\\s?(?<scale>k|m|thousand|million)?(?:\\s(?<after>${codeWord}))?`
const period = (n: number) =>
  `(?<this${n}>this month)|(?<next${n}>next month)|(?:(?:in|for)\\s)?(?<month${n}>${monthWord})\\.?(?:\\s(?<year${n}>\\d{4}))?`
/**
 * The whole text must be: an optional lead, an optional period, the amount,
 * an optional period (at most one period in all).
 */
const goalText = new RegExp(
  `^(?:(?:${leads}):?\\s)?(?:(?:${period(1)})\\s)?${money}(?:\\s(?:${period(2)}))?$`
)
const day = /^\d{4}-\d{2}-\d{2}$/

const monthStart = (y: number, m: number) =>
  `${y}-${String(m).padStart(2, '0')}-01`

/** Whole units only for a currency without cents (for example JPY). */
function wholeOnly(currency: string) {
  try {
    return (
      new Intl.NumberFormat('en', {
        style: 'currency',
        currency
      }).resolvedOptions().maximumFractionDigits === 0
    )
  } catch {
    return false
  }
}

/**
 * What the owner typed as a revenue goal, or null unless it is plainly
 * one amount and at most one month. The caller must already know the
 * owner is setting a goal (a goal field, or a confirmed GROS step): this
 * only reads the amount, currency and month, so "cancel the 20k goal",
 * "20% off" or "about 20k" are refused, not read. `store.currency` is the
 * store's: used when none is written, and for a plain "$" when the store
 * uses one. `store.today` is the store's today (YYYY-MM-DD).
 *
 * Read: "$20k this month", "goal: 20,000 AUD next month", "€5,000 for
 * December", "1.5m in March 2027", "I want 12500.50". A month name without
 * a year is this year's, or next year's when that is at most 6 months
 * ahead; the month just gone is refused, not guessed. Years: up to two
 * ahead.
 */
export function parseRevenueGoal(
  text: string,
  store: { currency: string; today: string }
): RevenueGoal | null {
  if (!day.test(store.today) || typeof text !== 'string' || text.length > 120)
    return null
  const [ty, tm] = store.today.split('-').map(Number) as [number, number]
  if (tm < 1 || tm > 12) return null
  const clean = text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!]$/, '')
  const g = clean.match(goalText)?.groups
  if (!g) return null

  // The month.
  const thisMonth = monthStart(ty, tm)
  const periods = [1, 2].filter(
    (n) => g[`this${n}`] || g[`next${n}`] || g[`month${n}`]
  )
  let month = thisMonth
  if (periods.length > 1) return null
  for (const n of periods) {
    if (g[`next${n}`])
      month = tm === 12 ? monthStart(ty + 1, 1) : monthStart(ty, tm + 1)
    const name = g[`month${n}`]
    if (name) {
      const m = months.findIndex((full) => full.startsWith(name)) + 1
      const year = g[`year${n}`]
      if (year) {
        const y = Number(year)
        if (y < ty || y > ty + 2) return null
        month = monthStart(y, m)
      } else if (m >= tm) month = monthStart(ty, m)
      else if (m + 12 - tm <= 6) month = monthStart(ty + 1, m)
      else return null
    }
  }
  if (month < thisMonth) return null

  // The amount.
  const scale = g.scale
  const multiplier =
    scale === 'k' || scale === 'thousand'
      ? 1_000
      : scale === 'm' || scale === 'million'
        ? 1_000_000
        : 1
  const whole = Number(g.digits!.replace(/,/g, ''))
  const value =
    Math.round(
      (whole + (g.decimals ? Number(`0.${g.decimals}`) : 0)) * multiplier * 100
    ) / 100
  if (!(value > 0) || value > 1_000_000_000) return null

  // The currency: written ones must agree; a plain "$" or "¥" is the store's.
  const sign = g.sign
  const written = [
    g.before?.toUpperCase(),
    g.after?.toUpperCase(),
    sign && sign !== '$' && sign !== '¥' ? symbols[sign] : undefined
  ].filter((c): c is string => c !== undefined)
  if (new Set(written).size > 1) return null
  const named = written[0]
  if (sign === '$' && !dollarStores.has(named ?? store.currency)) return null
  if (sign === '¥' && (named ?? store.currency) !== 'JPY') return null
  const currency = named ?? store.currency
  if (!/^[A-Z]{3}$/.test(currency)) return null
  if (wholeOnly(currency) && !Number.isInteger(value)) return null
  return { month, amount: value, currency }
}

type Db = SupabaseClient<Database>
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const monthDay = /^\d{4}-(0[1-9]|1[0-2])-01$/

/**
 * The goals saved for these months (with each one's revision, for the
 * command's check; a cleared goal has no amount), or null when the read
 * fails. Works with a member's client (RLS) or the worker's.
 */
export async function readRevenueGoals(
  db: Db,
  tenantId: string,
  forMonths: string[]
): Promise<
  | {
      month: string
      goal: RevenueGoal | null
      revision: number
    }[]
  | null
> {
  const wanted = [...new Set(forMonths)].filter((m) => monthDay.test(m))
  if (!uuid.test(tenantId)) return null
  if (wanted.length === 0) return []
  const read = await Promise.resolve()
    .then(() =>
      db
        .from('revenue_goals')
        .select('month,amount,currency,revision')
        .eq('tenant_id', tenantId)
        .in('month', wanted)
    )
    .catch(() => null)
  if (!read || read.error) return null
  const rows = new Map((read.data ?? []).map((r) => [r.month, r]))
  return [...wanted].sort().map((month) => {
    const row = rows.get(month)
    const amount = row?.amount == null ? null : Number(row.amount)
    return {
      month,
      revision: row ? row.revision : 0,
      goal:
        row && amount !== null && Number.isFinite(amount) && row.currency
          ? { month, amount, currency: row.currency }
          : null
    }
  })
}
