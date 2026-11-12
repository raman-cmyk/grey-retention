import { createHash } from 'node:crypto'
import type { Database } from '@/lib/supabase/database.types'
import type {
  LinkClicks,
  ResultStatistic,
  VariationResult
} from '@/lib/providers/klaviyo/results'
import { keptUrl, sectionOf, type EmailSection } from './sections'

/**
 * What one check of a pushed email means (LRN-001), as code with no
 * Klaviyo or database in it: the status Klaviyo shows, when the email is
 * next looked at, its results once a day for three days after the send,
 * and when to stop trying.
 */

export type ResultRow =
  Database['public']['Tables']['klaviyo_email_results']['Row']
export type EmailStatus =
  'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled' | 'deleted' | 'stale'

/** How a read was made (`save_klaviyo_result` checks each key). */
export type ReadContext = {
  reportFrom?: string
  reportTo?: string
  clicksFrom?: string
  clicksTo?: string
  /** The account's currency for `conversion_value`, when known. */
  currency?: string | null
  /** The metric orders were counted on (`clicked_email`: no orders). */
  conversion?: 'placed_order' | 'clicked_email' | null
  /** The read came before Klaviyo's 5-day attribution window closed. */
  attributionOpen?: boolean
  sendStrategy?: string | null
  sentAtFrom?: 'send_time' | 'send_times' | 'first_seen'
  /** Both of our designs were read apart (null: one design only). */
  abSplit?: boolean | null
  /** What Klaviyo keyed the clicks by (null: none found). */
  clicksBy?: 'message' | 'campaign' | null
  /** Clicks Klaviyo counted as bots' and left out. */
  botsLeftOut?: number
  /** The report had this campaign. */
  reported?: boolean
  /** This read could not read the results (or clicks): the earlier ones are kept. */
  resultsKept?: boolean
  clicksKept?: boolean
}

/** What `save_klaviyo_result` takes. */
export type ResultPatch = {
  status?: EmailStatus
  changed?: boolean
  sent_at?: string
  pulls?: number
  results?: StoredResult[]
  clicks?: StoredClick[]
  complete?: boolean
  context?: ReadContext
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
  design: 'A' | 'B' | null
  url: string
  section: number | null
  block: string | null
  clicks: number
  /** Each day's unique clickers, added up (two days, counted twice). */
  unique: number
}

export const hourMs = 3_600_000
export const dayMs = 24 * hourMs
/** Results reads after a send: one a day, three in all. */
export const pullsAfterSend = 3
/** A draft never sent is looked at until this many days after its day. */
export const staleAfterDays = 14
/** A sent email whose results cannot be read is given up on after this. */
export const giveUpAfterMs = 10 * dayMs + hourMs
/** Klaviyo's attribution window for orders (ONB-103 uses the same). */
export const attributionMs = 5 * dayMs
/** A due read Klaviyo has not reported is waited for this long. */
export const reportGraceMs = 12 * hourMs
/** How long a check waits after Klaviyo could not be read. */
export const pauseMs = {
  rate_limited: 60_000,
  klaviyo_unavailable: hourMs,
  klaviyo_answer: hourMs,
  klaviyo_not_reported: hourMs,
  default: 6 * hourMs,
  /** Never longer (the database allows 8 days). */
  most: 7 * dayMs
}

const iso = (ms: number) => new Date(ms).toISOString()

/**
 * At most `n` characters, never half of a character pair (an emoji), no
 * control characters: text the database stores.
 */
export function cut(s: string, n: number) {
  return Array.from(s.replace(/[\u0000-\u001f\u007f]/g, ' '))
    .slice(0, n)
    .join('')
    .replace(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
      '�'
    )
    .trim()
}

const statuses = new Set<EmailStatus>([
  'draft',
  'scheduled',
  'sending',
  'sent',
  'cancelled'
])

/**
 * Klaviyo's status as ours ("Cancelled: No Recipients" is cancelled); null
 * for one Klaviyo may add later.
 */
export function statusOf(
  klaviyo: string | null | undefined
): EmailStatus | null {
  const s = (klaviyo ?? '').trim().toLowerCase()
  if (/^cancel/.test(s)) return 'cancelled'
  return statuses.has(s as EmailStatus) ? (s as EmailStatus) : null
}

/** A day so long past that an email planned for it (or due then) is stale. */
function longPastDay(
  day: string | null | undefined,
  now: number,
  days = staleAfterDays
) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(day)) return false
  // A day's margin for the store's timezone (the database checks it in UTC).
  return Date.parse(`${day.slice(0, 10)}T00:00:00Z`) + (days + 1) * dayMs < now
}
/**
 * How long past its day a scheduled email Klaviyo cannot be read for is
 * given up on (the owner may have moved it later: unknown until read).
 */
export const scheduledGiveUpDays = 45
const plannedDay = (row: ResultRow) =>
  (row.planned as { date?: unknown }).date as string | undefined

/** When the next results read is due: a day after the send, then each day. */
export function pullDueAt(row: ResultRow, sentAt: string) {
  return Math.max(
    Date.parse(sentAt) + (row.pulls + 1) * dayMs,
    // And a day after the last read (taken up to 10 minutes early, as the
    // database allows).
    row.results_at ? Date.parse(row.results_at) + dayMs : 0
  )
}

export type StatusRead =
  | { found: false }
  | {
      found: true
      status: string
      /** When Klaviyo sent (or will send) it, ISO. */
      sendTime: string | null
      /** The earliest per-variation send time, when it gives no one time. */
      firstSendTime?: string | null
      sendStrategy?: string | null
      /** Its variations no longer match what we last wrote. */
      changed: boolean
    }

export type Checked = {
  patch: ResultPatch
  /** A results read is due now (sent, fewer than three reads). */
  pullDue: boolean
  /** When it was (or is) due. */
  dueAt: number
}

/** Where a sent email's send time comes from. */
export function sendTimeOf(
  read: StatusRead,
  now: number,
  builtAt: number
): { at: number; from: 'send_time' | 'send_times' | 'first_seen' } {
  if (!read.found) return { at: now, from: 'first_seen' }
  for (const [value, from] of [
    [read.sendTime, 'send_time'],
    [read.firstSendTime, 'send_times']
  ] as const) {
    const at = value ? Date.parse(value) : NaN
    // Klaviyo's time, never ahead of now nor before the email was built.
    if (Number.isFinite(at) && at <= now && at >= builtAt - 30 * 60_000)
      return { at, from }
  }
  return { at: now, from: 'first_seen' }
}

/**
 * The outcome of a status check. Nothing comes back from sent, cancelled
 * or deleted (a sent email Klaviyo still shows stays sent); a status
 * Klaviyo may add later keeps the one we had. A draft or a scheduled email
 * is looked at again in an hour; one long past its day (and, scheduled,
 * past its send time) is stale. A sent email's send time is Klaviyo's (or
 * the earliest of its per-variation times), else when it was first seen.
 */
export function afterStatus(
  row: ResultRow,
  read: StatusRead,
  now: number,
  builtAt: number = Date.parse(row.created_at)
): Checked {
  if (!read.found)
    return {
      patch: { status: 'deleted', final: true, next_check_at: iso(now) },
      pullDue: false,
      dueAt: now
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
      pullDue: false,
      dueAt: now
    }
  if (status === 'sent') {
    const sentAt = row.sent_at ?? iso(sendTimeOf(read, now, builtAt).at)
    const dueAt = pullDueAt(row, sentAt)
    return {
      patch: {
        status,
        ...changed,
        ...(row.sent_at ? {} : { sent_at: sentAt }),
        next_check_at: iso(Math.min(Math.max(dueAt, now), now + pauseMs.most))
      },
      pullDue: row.pulls < pullsAfterSend && dueAt <= now + 10 * 60_000,
      dueAt
    }
  }
  const scheduledFor = read.sendTime ?? read.firstSendTime ?? null
  const laterSend =
    status === 'scheduled' && !!scheduledFor && !longPastDay(scheduledFor, now)
  if (
    (was === 'draft' || was === 'scheduled') &&
    (status === 'draft' || status === 'scheduled') &&
    longPastDay(plannedDay(row), now) &&
    // A send the owner scheduled later than planned is still followed.
    !laterSend
  )
    return {
      patch: {
        status: 'stale',
        ...changed,
        final: true,
        next_check_at: iso(now)
      },
      pullDue: false,
      dueAt: now
    }
  return {
    patch: { status, ...changed, next_check_at: iso(now + hourMs) },
    pullDue: false,
    dueAt: now
  }
}

/**
 * A check that could not read Klaviyo: put back for later, or ended when
 * there is no point any more (a draft long past its day is stale; a sent
 * email unread for ten days is closed, saying why). `patch` is what the
 * status read already said, kept.
 */
export function pausedPatch(
  row: ResultRow,
  reason: string,
  now: number,
  waitMs: number,
  patch?: ResultPatch
): ResultPatch {
  const was = row.status as EmailStatus
  const status = patch?.status ?? was
  const sentAt = patch?.sent_at ?? row.sent_at
  if (
    (was === 'draft' &&
      status === 'draft' &&
      longPastDay(plannedDay(row), now)) ||
    (was === 'scheduled' &&
      status === 'scheduled' &&
      longPastDay(plannedDay(row), now, scheduledGiveUpDays))
  )
    return {
      ...patch,
      status: 'stale',
      final: true,
      paused: reason,
      next_check_at: iso(now)
    }
  // Counted from the send, or from when we first met the email if later.
  if (
    status === 'sent' &&
    sentAt &&
    now >
      Math.max(Date.parse(sentAt), Date.parse(row.created_at)) + giveUpAfterMs
  )
    return { ...patch, final: true, paused: reason, next_check_at: iso(now) }
  return {
    ...patch,
    paused: reason,
    next_check_at: iso(now + Math.min(Math.max(waitMs, 60_000), pauseMs.most))
  }
}

type Template = { approach?: unknown; variation?: unknown; deleted?: unknown }

/** Our design of a variation: the template we put on it, else its name. */
export function designOf(
  templates: Template[],
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
/** The clicks one row keeps, in bytes (the database allows 200,000). */
const maxClickBytes = 150_000
const variationId = /^[A-Za-z0-9_-]{1,64}$/
const whole = (n: number) => Math.min(999_999_999, Math.max(0, Math.round(n)))

/**
 * One results read, as the row stores it (`save_klaviyo_result` checks
 * it): each variation's counts under our design, each address's clicks
 * under its section (the clicker's own parameters left out), what the row
 * can hold and no more. Not complete when Klaviyo had more, a part was
 * not read, or the two designs of an A/B draft were not read apart.
 */
export function resultsPatch(
  row: ResultRow,
  sentAt: string,
  read: {
    /** null: not read this time (the earlier results are kept). */
    results: VariationResult[] | null
    /** null: not read this time (the earlier clicks are kept). */
    clicks: LinkClicks[] | null
    complete: boolean
    templates: Template[]
    sections: EmailSection[]
    trackingParams?: string[]
    context: ReadContext
  },
  now: number
): ResultPatch {
  const pulls = row.pulls + 1
  const final = pulls >= pullsAfterSend
  const kept = {
    results: Array.isArray(row.results)
      ? (row.results as unknown as StoredResult[])
      : [],
    clicks: Array.isArray(row.clicks)
      ? (row.clicks as unknown as StoredClick[])
      : []
  }
  const readResults = read.results ?? []
  const results: StoredResult[] = readResults.slice(0, maxResults).map((r) => {
    const name = r.variationName ? cut(r.variationName, 120) || null : null
    return {
      variation:
        r.variationId && variationId.test(r.variationId) ? r.variationId : null,
      name,
      design: designOf(read.templates, r.variationId, name),
      statistics: Object.fromEntries(
        Object.entries(r.statistics).filter(
          ([k, v]) =>
            typeof v === 'number' &&
            Number.isFinite(v) &&
            v >= 0 &&
            (!k.endsWith('_rate') || v <= 1)
        )
      )
    }
  })
  const designs = new Map(
    (read.results ? results : kept.results).map(
      (r) => [r.variation, r.design] as const
    )
  )
  // One row per variation and address once the clicker's own token is out.
  const merged = new Map<string, LinkClicks>()
  for (const c of read.clicks ?? []) {
    const url = keptUrl(c.url)
    if (!url) continue
    const variation =
      c.variationId && variationId.test(c.variationId) ? c.variationId : null
    const key = `${variation ?? ''}\n${url}`
    const was = merged.get(key)
    merged.set(
      key,
      was
        ? {
            ...was,
            clicks: was.clicks + c.clicks,
            unique: was.unique + c.unique
          }
        : { ...c, variationId: variation, url }
    )
  }
  const clicks: StoredClick[] = []
  let bytes = 2
  let cutShort = false
  for (const c of merged.values()) {
    const url = c.url
    if (clicks.length >= maxClicks) {
      cutShort = true
      break
    }
    const at = sectionOf(read.sections, c.url, read.trackingParams)
    const variation =
      c.variationId && variationId.test(c.variationId) ? c.variationId : null
    const click: StoredClick = {
      variation,
      design:
        designs.get(variation) ?? designOf(read.templates, variation, null),
      url,
      section: at?.section ?? null,
      block: at?.block ?? null,
      clicks: whole(c.clicks),
      unique: Math.min(whole(c.unique), whole(c.clicks))
    }
    const size = Buffer.byteLength(JSON.stringify(click)) + 1
    if (bytes + size > maxClickBytes) {
      cutShort = true
      break
    }
    bytes += size
    clicks.push(click)
  }
  const planned = (row.planned as { designs?: unknown }).designs
  const stored = read.results ? results : kept.results
  const abSplit =
    planned === 'both'
      ? ['A', 'B'].every((d) => stored.some((r) => r.design === d))
      : null
  return {
    status: 'sent',
    pulls,
    results: stored,
    clicks: read.clicks ? clicks : kept.clicks,
    complete:
      read.complete &&
      !!read.results &&
      !!read.clicks &&
      !cutShort &&
      readResults.length <= maxResults &&
      abSplit !== false,
    context: {
      ...read.context,
      abSplit,
      ...(read.results ? {} : { resultsKept: true }),
      ...(read.clicks ? {} : { clicksKept: true })
    },
    final,
    next_check_at: iso(
      final
        ? now
        : Math.min(
            Math.max(Date.parse(sentAt) + (pulls + 1) * dayMs, now + dayMs),
            now + pauseMs.most
          )
    )
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
  return {
    found: true,
    status: planned <= now ? 'sent' : 'draft',
    sendTime: new Date(planned).toISOString(),
    sendStrategy: 'static',
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
