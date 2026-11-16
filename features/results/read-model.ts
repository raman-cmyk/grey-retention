import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { listEmailResults, type EmailResult } from './read'
import { pullsAfterSend, type EmailStatus, type StoredResult } from './sync'
import { minClicks, minRecipients } from './thresholds'

type Db = SupabaseClient<Database>

/**
 * One design's (or the whole email's) numbers, rates as fractions. Orders
 * and revenue are null when the store's orders could not be read (no
 * Placed Order metric), never a made-up 0.
 */
export type Numbers = {
  recipients: number
  opens: number
  clicks: number
  orders: number | null
  revenue: number | null
  openRate: number | null
  clickRate: number | null
}

export type AbResult = {
  a: Numbers
  b: Numbers
  /**
   * Which design did better on click rate: only once all three daily reads
   * of a sent email are in, both designs reached at least `minRecipients`
   * and they had at least `minClicks` clicks together; "even" within 10% of
   * each other.
   */
  verdict: 'a' | 'b' | 'even' | 'too_early'
}

/** One email on the Results page (master handoff section 11). */
export type ResultLine = {
  buildId: string
  subject: string | null
  plannedDay: string | null
  /** The planned email type (`emailTypes` in features/strategy/plan.ts). */
  emailType: string | null
  status: EmailStatus
  statusText: string
  sentAt: string | null
  /** Checks are over (three daily reads, or given up): the numbers will not change. */
  final: boolean
  /** False when Klaviyo had more than it gave, or orders could not be read. */
  complete: boolean
  sample: boolean
  totals: Numbers | null
  ab: AbResult | null
  /** The email section with the most clicks, by its block, when known. */
  topSection: { block: string; clicks: number } | null
}

export { minClicks, minRecipients } from './thresholds'
const statusWords: Record<EmailStatus, string> = {
  draft: 'Draft in Klaviyo',
  scheduled: 'Scheduled in Klaviyo',
  sending: 'Sending',
  sent: 'Sent',
  cancelled: 'Cancelled in Klaviyo',
  deleted: 'Deleted in Klaviyo',
  stale: 'Not sent: its day has passed'
}

const num = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) ? v : 0
const text = (v: unknown) => (typeof v === 'string' && v ? v : null)

/**
 * Adds up results (each variation's), with rates over delivered emails
 * (a row without `delivered` counts its recipients).
 */
export function numbers(results: StoredResult[]): Numbers | null {
  if (!results.length) return null
  type Key = keyof StoredResult['statistics']
  const sum = (key: Key) =>
    results.reduce((total, r) => total + num(r.statistics[key]), 0)
  const known = (key: Key) =>
    results.some((r) => typeof r.statistics[key] === 'number')
  const recipients = sum('recipients')
  const delivered = results.reduce(
    (total, r) =>
      total +
      (typeof r.statistics.delivered === 'number'
        ? num(r.statistics.delivered)
        : num(r.statistics.recipients)),
    0
  )
  const opens = sum('opens_unique')
  const clicks = sum('clicks_unique')
  return {
    recipients,
    opens,
    clicks,
    orders: known('conversions') ? sum('conversions') : null,
    revenue: known('conversion_value')
      ? Math.round(sum('conversion_value') * 100) / 100
      : null,
    // UI-RES-a: a count Klaviyo did not give is no rate, never a made-up 0.
    openRate: delivered && known('opens_unique') ? opens / delivered : null,
    clickRate: delivered && known('clicks_unique') ? clicks / delivered : null
  }
}

/** Design A against design B, when the email had both. */
export function abResult(email: EmailResult): AbResult | null {
  const a = numbers(email.results.filter((r) => r.design === 'A'))
  const b = numbers(email.results.filter((r) => r.design === 'B'))
  if (!a || !b) return null
  const ready =
    email.status === 'sent' &&
    email.pulls >= pullsAfterSend &&
    a.clicks + b.clicks >= minClicks &&
    a.recipients >= minRecipients &&
    b.recipients >= minRecipients &&
    a.clickRate !== null &&
    b.clickRate !== null
  if (!ready) return { a, b, verdict: 'too_early' }
  const high = Math.max(a.clickRate!, b.clickRate!)
  const low = Math.min(a.clickRate!, b.clickRate!)
  const verdict =
    high === 0 || (high - low) / high < 0.1
      ? 'even'
      : a.clickRate! > b.clickRate!
        ? 'a'
        : 'b'
  return { a, b, verdict }
}

/** One stored email as a Results line. */
export function resultLine(email: EmailResult): ResultLine {
  const sections = new Map<string, number>()
  for (const c of email.clicks)
    if (c.block) sections.set(c.block, (sections.get(c.block) ?? 0) + c.clicks)
  const top = [...sections.entries()].sort((x, y) => y[1] - x[1])[0]
  return {
    buildId: email.buildId,
    subject: text(email.planned.subject),
    plannedDay: text(email.planned.date),
    emailType: text(email.planned.emailType),
    status: email.status,
    statusText: email.changed
      ? `${statusWords[email.status]} (changed in Klaviyo)`
      : statusWords[email.status],
    sentAt: email.sentAt,
    final: email.final,
    complete: email.complete,
    sample: email.sample,
    totals: numbers(email.results),
    ab: abResult(email),
    topSection: top ? { block: top[0], clicks: top[1] } : null
  }
}

/**
 * The Results page for the signed-in member's workspace: every email put
 * into Klaviyo, newest first. Null when the results could not be read.
 */
export async function resultsReadModel(
  db: Db,
  tenantId: string,
  limit = 50
): Promise<ResultLine[] | null> {
  try {
    return (await listEmailResults(db, tenantId, limit)).map(resultLine)
  } catch {
    return null
  }
}
