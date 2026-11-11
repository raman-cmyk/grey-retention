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
 * patterns into words.
 */

const day = 86_400_000
/** Cadence and send time are read from the last 8 weeks. */
export const recentWeeks = 8
/** An email needs this many recipients for its rates to count. */
export const minRecipients = 100

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
  /** The lists and segments it goes to (Klaviyo ids). */
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
  recipients90d: count,
  orders90d: count,
  revenue90d: money
})
export type FlowResult = z.infer<typeof flowResult>

export const audience = z.object({
  id: kid,
  kind: z.enum(['list', 'segment']),
  name: z.string().max(200),
  active: z.boolean(),
  starred: z.boolean()
})

/** The history as it is stored (one per workspace) and read back. */
export const historySnapshot = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  timezone: z.string().min(1).max(60),
  /** Emails sent in the last 8 weeks, a week on average (1 decimal). */
  sendsPerWeek: z.number().min(0).max(50),
  /** The hour most emails went out at, store time ("10:00"); null if none. */
  usualSendTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):00$/)
    .nullable(),
  sent: z.array(sentEmail).max(400),
  scheduled: z.array(scheduledEmail).max(100),
  flows: z.array(flowResult).max(100),
  audiences: z.array(audience).max(120),
  /** False when the key cannot read flows (the Flows scope). */
  flowsRead: z.boolean()
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

/** A safe timezone: the account's, or UTC when it is not one. */
export function zoneOr(timezone: string | null) {
  if (!timezone) return 'UTC'
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone })
    return timezone
  } catch {
    return 'UTC'
  }
}

const offerWords =
  /(\d+\s?%|% off|\boff\b|\bsale\b|\bcode\b|\bdiscount\b|free shipping|\bbogo\b|buy one|save \$?\d)/i

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
        (m.channel === 'email' || (m.channel === null && m.subject !== null))
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
    .slice(0, 400)
}

/** Emails a week over the last 8 weeks, and the hour most went out at. */
export function cadence(sent: SentEmail[], timezone: string, now: number) {
  const recent = sent.filter(
    (e) => now - Date.parse(e.sentAt) <= recentWeeks * 7 * day
  )
  const hours = new Map<number, number>()
  for (const e of recent) {
    const h = localParts(e.sentAt, timezone).hour
    hours.set(h, (hours.get(h) ?? 0) + 1)
  }
  const top = [...hours.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]
  return {
    sendsPerWeek: Math.round((recent.length / recentWeeks) * 10) / 10,
    usualSendTime: top ? `${String(top[0]).padStart(2, '0')}:00` : null
  }
}

/** The best emails: the most revenue per recipient, with enough recipients. */
export function bestEmails(sent: SentEmail[], limit = 5) {
  return sent
    .filter(
      (e) =>
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

/** The emails already scheduled, on their day in the store's timezone. */
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
        m.sendAt !== null &&
        Date.parse(m.sendAt) > now &&
        m.channel !== 'sms'
    )
    .map((m) => ({
      id: m.id,
      campaignId: m.campaignId,
      subject: m.subject,
      sendAt: m.sendAt!,
      date: localParts(m.sendAt!, timezone).date,
      audienceIds: (m.campaignId
        ? (byCampaign.get(m.campaignId)?.included ?? [])
        : []
      ).slice(0, 50),
      offer: offerWords.test(`${m.subject ?? ''} ${m.preview ?? ''}`)
    }))
    .sort((a, b) => Date.parse(a.sendAt) - Date.parse(b.sendAt))
    .slice(0, 100)
}

/** Each flow with its email results of the last 90 days, added up. */
export function flowResults(flows: Flow[], report: ReportRow[]): FlowResult[] {
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
      const s = sums.get(f.id)
      return {
        id: f.id,
        name: f.name,
        status: f.status,
        trigger: f.trigger,
        recipients90d: Math.round(s?.r ?? 0),
        orders90d: Math.round(s?.o ?? 0),
        revenue90d: Math.round((s?.v ?? 0) * 100) / 100
      }
    })
    .sort((a, b) => b.revenue90d - a.revenue90d || a.name.localeCompare(b.name))
    .slice(0, 100)
}

/** Lists and segments, active and starred ones first. */
export function audienceList(groups: Audience[]) {
  return [...groups]
    .sort(
      (a, b) =>
        Number(b.starred) - Number(a.starred) ||
        Number(b.active) - Number(a.active) ||
        a.name.localeCompare(b.name)
    )
    .slice(0, 120)
}
