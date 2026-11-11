import { z } from 'zod'
import type {
  Audience,
  CampaignAudience,
  CampaignMessage,
  Flow,
  ReportRow
} from '@/lib/providers/klaviyo/history'

/**
 * What a Klaviyo account already sent, counted in code (ONB-103): the sent
 * emails with their results, how often and when the brand sends, the best
 * emails, the days already scheduled, the flows and the audiences. This is
 * the history the strategy agents read; the Klaviyo historian only puts the
 * patterns into words. A number not read is null, never 0.
 */

const day = 86_400_000
/** Cadence and send time are read from the last 8 weeks. */
export const recentWeeks = 8
/** An email needs this many recipients for its rates to count. */
export const minRecipients = 100
/** An email sent in the last days is still collecting its orders. */
export const attributionDays = 5
/** What a read covers: sent emails of a year (at most 300), flows of 90 days. */
export const windowRead = { sentDays: 365, sentCap: 300, flowDays: 90 } as const

const money = z.number().finite().nonnegative().max(100_000_000)
const count = z.number().int().nonnegative().max(100_000_000)
const rate = z.number().finite().min(0).max(1)
const isoTime = z.iso.datetime({ offset: true })
const kid = z.string().regex(/^[A-Za-z0-9]{1,64}$/)

export const sentEmail = z.object({
  id: kid,
  campaignId: kid.nullable(),
  name: z.string().max(200).nullable(),
  subject: z.string().max(300).nullable(),
  preview: z.string().max(300).nullable(),
  sentAt: isoTime,
  /** Its subject or preview speaks of an offer. */
  offer: z.boolean(),
  /** Sent in the last days: its orders are still coming in. */
  collecting: z.boolean(),
  /** An A/B content test: the subject is the first variation's. */
  abTest: z.boolean(),
  strategy: z.enum(['static', 'local', 'optimized']),
  recipients: count.nullable(),
  opens: count.nullable(),
  clicks: count.nullable(),
  orders: count.nullable(),
  revenue: money.nullable(),
  revenuePerRecipient: money.nullable(),
  openRate: rate.nullable(),
  clickRate: rate.nullable(),
  unsubscribeRate: rate.nullable()
})
export type SentEmail = z.infer<typeof sentEmail>

export const scheduledEmail = z.object({
  id: kid,
  campaignId: kid.nullable(),
  subject: z.string().max(300).nullable(),
  sendAt: isoTime,
  /** The day it goes out, in the store's timezone (YYYY-MM-DD). */
  date: z.iso.date(),
  /** The lists and segments it goes to (Klaviyo ids); empty when unknown. */
  audienceIds: z.array(kid).max(50),
  /** Its subject or preview speaks of an offer. */
  offer: z.boolean()
})
export type ScheduledEmail = z.infer<typeof scheduledEmail>

export const flowResult = z.object({
  id: kid,
  name: z.string().max(200),
  status: z.string().max(20),
  trigger: z.string().max(40).nullable(),
  /** Emails it delivered in 90 days (sends, not people); null when not read. */
  sends90d: count.nullable(),
  orders90d: count.nullable(),
  revenue90d: money.nullable()
})
export type FlowResult = z.infer<typeof flowResult>

export const audience = z.object({
  id: kid,
  kind: z.enum(['list', 'segment']),
  name: z.string().max(200),
  active: z.boolean(),
  starred: z.boolean(),
  /** Used by scheduled emails only to leave people out (a suppression list). */
  excludedOnly: z.boolean()
})

/**
 * Which parts were read whole. A report part is also whole when there was
 * nothing to ask (no sent email, or no Placed Order metric: the results
 * are then unknown, null).
 */
export const partsRead = z.object({
  sent: z.boolean(),
  scheduled: z.boolean(),
  audiences: z.boolean(),
  campaignReport: z.boolean(),
  flows: z.boolean(),
  flowReport: z.boolean(),
  lists: z.boolean(),
  segments: z.boolean()
})

/** The history as it is stored (one per workspace) and read back. */
export const historySnapshot = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  /** The brand's timezone (UIR-023): every day and hour is in it. */
  timezone: z.string().min(1).max(60),
  /** Emails sent in the last 8 weeks (or since the first), a week (1 decimal). */
  sendsPerWeek: z.number().min(0).max(50),
  /** The hour most emails went out at, store time ("10:00"); null if none. */
  usualSendTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):00$/)
    .nullable(),
  sent: z.array(sentEmail).max(300),
  scheduled: z.array(scheduledEmail).max(300),
  flows: z.array(flowResult).max(100),
  audiences: z.array(audience).max(120),
  /** False when the key cannot read flows (the Flows scope). */
  flowsRead: z.boolean(),
  window: z.object({
    sentDays: z.literal(windowRead.sentDays),
    sentCap: z.literal(windowRead.sentCap),
    flowDays: z.literal(windowRead.flowDays)
  }),
  parts: partsRead
})
export type HistorySnapshot = z.infer<typeof historySnapshot>

const num = (row: ReportRow | undefined, key: string) => {
  const v = row?.statistics[key]
  return typeof v === 'number' ? v : null
}
const whole = (v: number | null) =>
  v === null ? null : Math.max(0, Math.round(v))
const cents = (v: number | null) =>
  v === null ? null : Math.round(v * 100) / 100
const fraction = (v: number | null) =>
  v === null ? null : Math.min(1, Math.max(0, Math.round(v * 10_000) / 10_000))

/** The local date and hour of a moment, in a timezone. */
export function localParts(iso: string, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    weekday: 'short'
  }).formatToParts(new Date(iso))
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')),
    weekday: get('weekday')
  }
}

/**
 * The day and hour an email goes out, in store time. A send at each
 * recipient's own clock time (Klaviyo's local-timezone strategy) carries
 * that clock time as UTC: its day and hour are read as they are.
 */
export function sendParts(
  iso: string,
  strategy: SentEmail['strategy'],
  timezone: string
) {
  return localParts(iso, strategy === 'local' ? 'UTC' : timezone)
}

/** A safe timezone: the one given, or UTC when it is not one. */
export function zoneOr(timezone: string | null) {
  if (!timezone) return 'UTC'
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone })
    return timezone
  } catch {
    return 'UTC'
  }
}

/**
 * Whether a subject or preview speaks of an offer: money or a percentage
 * off, a sale, a code to use, a coupon, a deal, free shipping, a gift with
 * an order. "100% merino", "kick off" or "dress code" are not offers.
 */
export const offerWords =
  /(\d+(?:[.,]\d+)?\s?%\s?off\b|\bsave\s+(?:[$€£¥₹]\s?)?\d+|\b(?:up to|get|take|extra)\s+(?:[$€£¥₹]\s?\d+(?:[.,]\d+)?|\d+(?:[.,]\d+)?\s?%)|[$€£¥₹]\s?\d+(?:[.,]\d+)?\s?off\b|\boff (?:everything|sitewide|all)\b|\bsale\b|\b(?:use|with|enter) (?:the )?code\b|\b(?:coupon|promo|discount|deal|clearance|bogo)s?\b|\bbuy one\b|free shipping|free gift|gift with (?:purchase|your order))/i

/** A channel that is an email: said so, or unknown with a subject or a report row. */
const isEmail = (m: CampaignMessage, inReport: boolean) =>
  m.channel === 'email' ||
  (m.channel === null && (m.subject !== null || inReport))

/** The sent emails (email channel only), each with its results. */
export function sentEmails(
  messages: CampaignMessage[],
  report: ReportRow[],
  now: number
): SentEmail[] {
  const byMessage = new Map(
    report
      .filter((r) => r.groupings.campaign_message_id)
      .map((r) => [r.groupings.campaign_message_id!, r])
  )
  return messages
    .filter(
      (m) =>
        m.status === 'sent' &&
        m.sendAt !== null &&
        Date.parse(m.sendAt) <= now &&
        isEmail(m, byMessage.has(m.id))
    )
    .map((m) => {
      const r = byMessage.get(m.id)
      return {
        id: m.id,
        campaignId: m.campaignId,
        name: m.campaignName ?? m.name,
        subject: m.subject,
        preview: m.preview,
        sentAt: m.sendAt!,
        offer: offerWords.test(`${m.subject ?? ''} ${m.preview ?? ''}`),
        collecting: now - Date.parse(m.sendAt!) < attributionDays * day,
        abTest: m.abTest,
        strategy: m.strategy,
        recipients: whole(num(r, 'recipients')),
        opens: whole(num(r, 'opens_unique')),
        clicks: whole(num(r, 'clicks_unique')),
        orders: whole(num(r, 'conversions')),
        revenue: cents(num(r, 'conversion_value')),
        revenuePerRecipient: cents(num(r, 'revenue_per_recipient')),
        openRate: fraction(num(r, 'open_rate')),
        clickRate: fraction(num(r, 'click_rate')),
        unsubscribeRate: fraction(num(r, 'unsubscribe_rate'))
      }
    })
    .sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt))
    .slice(0, windowRead.sentCap)
}

/**
 * Emails a week over the last 8 weeks (or since the first email read, when
 * the store began sending lately), and the hour most went out at in store
 * time: a local-time send counts by its clock hour, a send at times Klaviyo
 * picks per person does not count for the hour.
 */
export function cadence(sent: SentEmail[], timezone: string, now: number) {
  const recent = sent.filter(
    (e) => now - Date.parse(e.sentAt) <= recentWeeks * 7 * day
  )
  const first = sent.reduce(
    (t, e) => Math.min(t, Date.parse(e.sentAt)),
    Number.POSITIVE_INFINITY
  )
  const weeks = Number.isFinite(first)
    ? Math.min(recentWeeks, Math.max(1, (now - first) / (7 * day)))
    : recentWeeks
  const hours = new Map<number, number>()
  for (const e of recent) {
    if (e.strategy === 'optimized') continue
    const h = sendParts(e.sentAt, e.strategy, timezone).hour
    hours.set(h, (hours.get(h) ?? 0) + 1)
  }
  const top = [...hours.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]
  return {
    // At most 50 (the stored history's limit): a store sending more than
    // seven campaigns a day in its first weeks.
    sendsPerWeek: Math.min(50, Math.round((recent.length / weeks) * 10) / 10),
    usualSendTime: top ? `${String(top[0]).padStart(2, '0')}:00` : null
  }
}

/**
 * The best emails: the most revenue per recipient, with enough recipients,
 * no longer collecting orders.
 */
export function bestEmails(sent: SentEmail[], limit = 5) {
  return sent
    .filter(
      (e) =>
        !e.collecting &&
        (e.recipients ?? 0) >= minRecipients &&
        e.revenuePerRecipient !== null &&
        e.revenuePerRecipient > 0
    )
    .sort(
      (a, b) =>
        b.revenuePerRecipient! - a.revenuePerRecipient! ||
        Date.parse(b.sentAt) - Date.parse(a.sentAt)
    )
    .slice(0, limit)
}

/**
 * The emails already scheduled, on their day in the store's timezone. One
 * whose content Klaviyo did not give still takes its day (it may be an
 * email); an archived one never goes out.
 */
export function scheduledEmails(
  messages: CampaignMessage[],
  audiences: CampaignAudience[],
  timezone: string,
  now: number
): ScheduledEmail[] {
  const byCampaign = new Map(audiences.map((a) => [a.campaignId, a]))
  return messages
    .filter(
      (m) =>
        m.status === 'scheduled' &&
        !m.archived &&
        m.sendAt !== null &&
        Date.parse(m.sendAt) > now &&
        (isEmail(m, false) || !m.contentKnown)
    )
    .map((m) => ({
      id: m.id,
      campaignId: m.campaignId,
      subject: m.subject,
      sendAt: m.sendAt!,
      date: sendParts(m.sendAt!, m.strategy, timezone).date,
      audienceIds: (m.campaignId
        ? (byCampaign.get(m.campaignId)?.included ?? [])
        : []
      ).slice(0, 50),
      offer: offerWords.test(`${m.subject ?? ''} ${m.preview ?? ''}`)
    }))
    .sort((a, b) => Date.parse(a.sendAt) - Date.parse(b.sendAt))
    .slice(0, 300)
}

/**
 * Each flow with its email results of the last 90 days, added up. When the
 * report was not read, the results are unknown (null); a flow the report
 * does not list sent nothing (0).
 */
export function flowResults(
  flows: Flow[],
  report: ReportRow[],
  reportRead: boolean
): FlowResult[] {
  const sums = new Map<string, { r: number; o: number; v: number }>()
  for (const row of report) {
    const id = row.groupings.flow_id
    if (!id) continue
    const s = sums.get(id) ?? { r: 0, o: 0, v: 0 }
    s.r += num(row, 'recipients') ?? 0
    s.o += num(row, 'conversions') ?? 0
    s.v += num(row, 'conversion_value') ?? 0
    sums.set(id, s)
  }
  return flows
    .map((f) => {
      const s = reportRead ? (sums.get(f.id) ?? { r: 0, o: 0, v: 0 }) : null
      return {
        id: f.id,
        name: f.name,
        status: f.status,
        trigger: f.trigger,
        sends90d: s ? Math.round(s.r) : null,
        orders90d: s ? Math.round(s.o) : null,
        revenue90d: s ? Math.round(s.v * 100) / 100 : null
      }
    })
    .sort(
      (a, b) =>
        (b.revenue90d ?? -1) - (a.revenue90d ?? -1) ||
        a.name.localeCompare(b.name)
    )
    .slice(0, 100)
}

/**
 * Lists and segments, starred and active ones first; one the scheduled
 * emails only leave out (a suppression list) is marked so.
 */
export function audienceList(
  groups: Audience[],
  campaigns: CampaignAudience[] = []
) {
  const included = new Set(campaigns.flatMap((c) => c.included))
  const excluded = new Set(campaigns.flatMap((c) => c.excluded))
  return [...groups]
    .sort(
      (a, b) =>
        Number(b.starred) - Number(a.starred) ||
        Number(b.active) - Number(a.active) ||
        a.name.localeCompare(b.name)
    )
    .slice(0, 120)
    .map((g) => ({
      ...g,
      excludedOnly: excluded.has(g.id) && !included.has(g.id)
    }))
}
