import { createHash } from 'node:crypto'
import type { Database } from '@/lib/supabase/database.types'
import type {
  LinkClicks,
  ResultStatistic,
  VariationResult
} from '@/lib/providers/klaviyo/results'
import { sectionOf, type EmailSection } from './sections'

/**
 * What one check of a pushed email means (LRN-001), as code with no
 * Klaviyo or database in it: the status Klaviyo shows, when the email is
 * next looked at, and its results once a day for three days after the send.
 */

export type ResultRow =
  Database['public']['Tables']['klaviyo_email_results']['Row']
export type EmailStatus =
  'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled' | 'deleted' | 'stale'

/** What `save_klaviyo_result` takes. */
export type ResultPatch = {
  status?: EmailStatus
  changed?: boolean
  sent_at?: string
  pulls?: number
  results?: StoredResult[]
  clicks?: StoredClick[]
  complete?: boolean
  final?: boolean
  paused?: string | null
  next_check_at: string
}
export type StoredResult = {
  variation: string | null
  name: string | null
  design: 'A' | 'B' | null
  statistics: Partial<Record<ResultStatistic, number>>
}
export type StoredClick = {
  variation: string | null
  url: string
  section: number | null
  block: string | null
  clicks: number
  unique: number
}

export const hourMs = 3_600_000
export const dayMs = 24 * hourMs
/** Results reads after a send: one a day, three in all. */
export const pullsAfterSend = 3
/** A draft never sent is looked at until this many days after its day. */
export const staleAfterDays = 14
/** How long a check waits after Klaviyo could not be read. */
export const pauseMs = {
  rate_limited: 60_000,
  klaviyo_unavailable: hourMs,
  klaviyo_answer: hourMs,
  default: 6 * hourMs
}

const iso = (ms: number) => new Date(ms).toISOString()
const statuses = new Set<EmailStatus>([
  'draft',
  'scheduled',
  'sending',
  'sent',
  'cancelled'
])

/** Klaviyo's status as ours; null for one Klaviyo may add later. */
export function statusOf(klaviyo: string): EmailStatus | null {
  const s = klaviyo.toLowerCase() as EmailStatus
  return statuses.has(s) ? s : null
}

/** The email's planned day (store time) is so long past that a draft is stale. */
function longPast(row: ResultRow, now: number) {
  const date = (row.planned as { date?: unknown }).date
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    return false
  // A day's margin for the store's timezone (the database checks the same).
  return Date.parse(`${date}T00:00:00Z`) + (staleAfterDays + 1) * dayMs < now
}

/** When the next results read is due (a day after the send, then each day). */
export const pullDueAt = (sentAt: string, pulls: number) =>
  Date.parse(sentAt) + (pulls + 1) * dayMs

export type StatusRead =
  | { found: false }
  | {
      found: true
      status: string
      /** When Klaviyo sent (or will send) it, ISO. */
      sendTime: string | null
      /** Its variations no longer match what we last wrote. */
      changed: boolean
    }

export type Checked = {
  patch: ResultPatch
  /** A results read is due now (sent, fewer than three reads). */
  pullDue: boolean
}

/**
 * The outcome of a status check. Nothing comes back from sent, cancelled
 * or deleted (a sent email Klaviyo still shows stays sent); a status
 * Klaviyo may add later keeps the one we had. A draft or a scheduled email
 * is looked at again in an hour; a draft long past its day is stale.
 */
export function afterStatus(
  row: ResultRow,
  read: StatusRead,
  now: number
): Checked {
  if (!read.found)
    return {
      patch: { status: 'deleted', final: true, next_check_at: iso(now) },
      pullDue: false
    }
  const seen = statusOf(read.status)
  const was = row.status as EmailStatus
  const status: EmailStatus =
    was === 'sent' || was === 'cancelled' ? was : (seen ?? was)
  // Said only when seen (once seen it stays so).
  const changed = read.changed ? { changed: true } : {}
  if (status === 'cancelled')
    return {
      patch: { status, ...changed, final: true, next_check_at: iso(now) },
      pullDue: false
    }
  if (status === 'sent') {
    const sendTime = read.sendTime ? Date.parse(read.sendTime) : NaN
    const sentAt =
      row.sent_at ??
      iso(Number.isFinite(sendTime) ? Math.min(sendTime, now) : now)
    const due = pullDueAt(sentAt, row.pulls)
    return {
      patch: {
        status,
        ...changed,
        ...(row.sent_at ? {} : { sent_at: sentAt }),
        next_check_at: iso(Math.max(due, now))
      },
      pullDue: row.pulls < pullsAfterSend && due <= now + 10 * 60_000
    }
  }
  if ((status === 'draft' || status === 'scheduled') && longPast(row, now))
    return {
      patch: {
        status: 'stale',
        ...changed,
        final: true,
        next_check_at: iso(now)
      },
      pullDue: false
    }
  return {
    patch: { status, ...changed, next_check_at: iso(now + hourMs) },
    pullDue: false
  }
}

/** Our design of a variation: the template we put on it, else its name. */
export function designOf(
  templates: { approach?: unknown; variation?: unknown; deleted?: unknown }[],
  variationId: string | null,
  name: string | null
): 'A' | 'B' | null {
  const ours = templates.find(
    (t) => variationId && t.variation === variationId && t.deleted !== true
  )
  if (ours?.approach === 'A' || ours?.approach === 'B') return ours.approach
  const named = /^Design ([AB])$/.exec(name ?? '')
  return named ? (named[1] as 'A' | 'B') : null
}

const maxResults = 8
const maxClicks = 200
const variationId = /^[A-Za-z0-9_-]{1,64}$/

/** One results read, as the row stores it (`save_klaviyo_result` checks it). */
export function resultsPatch(
  row: ResultRow,
  sentAt: string,
  read: {
    results: VariationResult[]
    clicks: LinkClicks[]
    complete: boolean
    templates: { approach?: unknown; variation?: unknown; deleted?: unknown }[]
    sections: EmailSection[]
  },
  now: number
): ResultPatch {
  const pulls = row.pulls + 1
  const final = pulls >= pullsAfterSend
  const results: StoredResult[] = read.results
    .slice(0, maxResults)
    .map((r) => ({
      variation:
        r.variationId && variationId.test(r.variationId) ? r.variationId : null,
      name: r.variationName?.slice(0, 120) || null,
      design: designOf(read.templates, r.variationId, r.variationName),
      statistics: Object.fromEntries(
        Object.entries(r.statistics).filter(
          ([k, v]) =>
            typeof v === 'number' &&
            Number.isFinite(v) &&
            v >= 0 &&
            (!k.endsWith('_rate') || v <= 1)
        )
      )
    }))
  const clicks: StoredClick[] = read.clicks
    .filter((c) => /^https?:\/\//i.test(c.url) && c.url.length <= 2_000)
    .slice(0, maxClicks)
    .map((c) => {
      const at = sectionOf(read.sections, c.url)
      return {
        variation:
          c.variationId && variationId.test(c.variationId)
            ? c.variationId
            : null,
        url: c.url,
        section: at?.section ?? null,
        block: at?.block ?? null,
        clicks: Math.min(999_999_999, Math.max(0, Math.round(c.clicks))),
        unique: Math.min(999_999_999, Math.max(0, Math.round(c.unique)))
      }
    })
  return {
    status: 'sent',
    pulls,
    results,
    clicks,
    complete:
      read.complete &&
      read.results.length <= maxResults &&
      read.clicks.length <= maxClicks,
    final,
    next_check_at: iso(final ? now : Math.max(pullDueAt(sentAt, pulls), now))
  }
}

/* The sample lifecycle: a synthetic brand's sample draft. */

const seed = (key: string, salt: string) =>
  createHash('sha256').update(`${key}:${salt}`).digest().readUInt32BE(0) /
  0xffffffff
/** Share of an email's results in by its first, second and third day. */
const growth = [0.72, 0.93, 1]

/**
 * A synthetic brand's sample draft, as if the owner had scheduled it: a
 * draft until its planned send time, then sent, with sample results that
 * grow over three days (the same each time for the same email).
 */
export function sampleStatus(row: ResultRow, now: number): StatusRead {
  const planned = Date.parse(
    String((row.planned as { plannedSendAt?: unknown }).plannedSendAt ?? '')
  )
  if (!Number.isFinite(planned))
    return { found: true, status: 'draft', sendTime: null, changed: false }
  return planned <= now
    ? {
        found: true,
        status: 'sent',
        sendTime: new Date(planned).toISOString(),
        changed: false
      }
    : {
        found: true,
        status: 'draft',
        sendTime: new Date(planned).toISOString(),
        changed: false
      }
}

export const sampleVariation = 'sample-design-a'

/** The sample results of a read (day 1, 2 or 3), and clicks per section. */
export function sampleResults(
  row: ResultRow,
  sections: EmailSection[]
): { results: VariationResult[]; clicks: LinkClicks[]; complete: boolean } {
  const key = row.build_id
  const share = growth[Math.min(row.pulls, growth.length - 1)]!
  const recipients = 800 + Math.round(seed(key, 'recipients') * 2_400)
  const delivered = Math.round(recipients * 0.985)
  const openRate = 0.34 + seed(key, 'open') * 0.18
  const clickRate = 0.012 + seed(key, 'click') * 0.026
  const opens = Math.round(delivered * openRate * share)
  const clicks = Math.max(1, Math.round(delivered * clickRate * share))
  const conversions = Math.round(clicks * (0.06 + seed(key, 'order') * 0.08))
  const value =
    Math.round(conversions * (38 + seed(key, 'aov') * 60) * 100) / 100
  const round4 = (n: number) => Math.round(n * 10_000) / 10_000
  const results: VariationResult[] = [
    {
      campaignId: row.campaign_id,
      messageId: 'sample',
      variationId: sampleVariation,
      variationName: 'Design A',
      statistics: {
        recipients,
        delivered,
        opens_unique: opens,
        open_rate: round4(opens / delivered),
        clicks_unique: clicks,
        click_rate: round4(clicks / delivered),
        conversions,
        conversion_uniques: conversions,
        conversion_value: value,
        revenue_per_recipient: round4(value / recipients),
        unsubscribe_uniques: Math.round(delivered * 0.002 * share),
        unsubscribe_rate: round4(0.002 * share),
        spam_complaints: 0,
        bounced: recipients - delivered
      }
    }
  ]
  // The clicks spread over the sections' links, the top ones clicked most.
  const links = sections.flatMap((s) =>
    s.links.slice(0, 3).map((url) => ({ url, weight: 1 / (s.index + 1) }))
  )
  const total = links.reduce((sum, l) => sum + l.weight, 0)
  const linkClicks: LinkClicks[] = links.map((l) => {
    const count = Math.round((clicks * 1.3 * l.weight) / total)
    return {
      variationId: sampleVariation,
      url: `https://${l.url}`,
      clicks: count,
      unique: Math.round(count * 0.85)
    }
  })
  return { results, clicks: linkClicks, complete: true }
}
