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

/** Currencies a store is likely to use; a three-letter word is read as one only if listed. */
const codes = new Set([
  'USD',
  'AUD',
  'CAD',
  'NZD',
  'SGD',
  'HKD',
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
  'MXN',
  'BRL'
])
const dollars = new Set(['USD', 'AUD', 'CAD', 'NZD', 'SGD', 'HKD'])
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
  '₹': 'INR',
  '¥': 'JPY'
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
const monthWord = new RegExp(
  `\\b(${months.map((m) => `${m}|${m.slice(0, 3)}`).join('|')}|sept)\\.?(?:\\s+(\\d{4}))?\\b`,
  'g'
)
const day = /^\d{4}-\d{2}-\d{2}$/
const codeWords = [...codes].map((c) => c.toLowerCase()).join('|')
/**
 * One amount: a currency code or symbol before it, a scale after it (20k,
 * 1.5m, 2 billion), and a currency code after it. Only listed codes count,
 * so "20k for December" reads "for" as a word, not a currency.
 */
const amountPattern = new RegExp(
  `(?:^|[\\s(])((?:(?:${codeWords})\\s?)?(?:us\\$|au\\$|a\\$|ca\\$|c\\$|nz\\$|s\\$|hk\\$|\\$|€|£|₹|¥)?)\\s?(\\d[\\d,]*(?:\\.\\d+)?)\\s?(k|m|bn|b|thousand|million|billion)?(?![\\w.])(?:\\s?(${codeWords})(?![a-z]))?`,
  'g'
)

const monthStart = (y: number, m: number) =>
  `${y}-${String(m).padStart(2, '0')}-01`

/**
 * What the owner typed, as a goal, or null when it cannot be read for
 * sure (no amount, two amounts, two currencies, a past month). `currency`
 * is the store's: used when none is written, and for a plain "$" when the
 * store uses dollars. `today` is the store's today (YYYY-MM-DD).
 *
 * "$20k this month", "20,000 AUD next month", "€5,000 for December",
 * "1.5m in March 2027".
 */
export function parseRevenueGoal(
  text: string,
  store: { currency: string; today: string }
): RevenueGoal | null {
  if (!day.test(store.today) || typeof text !== 'string' || text.length > 200)
    return null
  let rest = ` ${text.toLowerCase().replace(/\s+/g, ' ')} `
  const [ty, tm] = store.today.split('-').map(Number) as [number, number]
  const thisMonth = monthStart(ty, tm)

  // The month: "this month" (also the default), "next month", or a name.
  const picked: string[] = []
  if (/\bnext month\b/.test(rest)) {
    picked.push(tm === 12 ? monthStart(ty + 1, 1) : monthStart(ty, tm + 1))
    rest = rest.replace(/\bnext month\b/g, ' ')
  }
  if (/\bthis month\b/.test(rest)) {
    picked.push(thisMonth)
    rest = rest.replace(/\bthis month\b/g, ' ')
  }
  rest = rest.replace(monthWord, (_, name: string, year?: string) => {
    const m = months.findIndex((full) => full.startsWith(name)) + 1
    const y = year ? Number(year) : m >= tm ? ty : ty + 1
    picked.push(monthStart(y, m))
    return ' '
  })
  if (new Set(picked).size > 1) return null
  const month = picked[0] ?? thisMonth
  if (month < thisMonth) return null

  // The amount, with its currency before or after it.
  const found = [...rest.matchAll(amountPattern)]
  if (found.length !== 1) return null
  const [, before = '', digits = '', scale, after] = found[0]!
  if (!/^\d{1,3}(,\d{3})*(\.\d+)?$|^\d+(\.\d+)?$/.test(digits)) return null
  const multiplier =
    scale === 'k' || scale === 'thousand'
      ? 1_000
      : scale === 'm' || scale === 'million'
        ? 1_000_000
        : scale === 'b' || scale === 'bn' || scale === 'billion'
          ? 1_000_000_000
          : 1
  const value =
    Math.round(Number(digits.replace(/,/g, '')) * multiplier * 100) / 100
  if (!(value > 0) || value > 1_000_000_000) return null

  // Written currencies: a code before or after, or a symbol that names one.
  const word = before.match(/^[a-z]{3}/)?.[0]?.toUpperCase()
  const sign = before.replace(/^[a-z]{3}\s?/, '').trim()
  const written = [
    word,
    after?.toUpperCase(),
    sign && sign !== '$' ? symbols[sign] : undefined
  ]
  if (written.some((c) => c !== undefined && !codes.has(c))) return null
  const said = new Set(written.filter((c): c is string => c !== undefined))
  if (said.size > 1) return null
  const named = [...said][0]
  // A plain "$" is the store's dollar (or US dollars), unless a code says which.
  if (sign === '$' && named && !dollars.has(named)) return null
  const currency =
    named ??
    (sign === '$' && !dollars.has(store.currency) ? 'USD' : store.currency)
  if (!/^[A-Z]{3}$/.test(currency)) return null
  return { month, amount: value, currency }
}

type Db = SupabaseClient<Database>
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const monthDay = /^\d{4}-\d{2}-01$/

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
