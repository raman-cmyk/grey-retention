import 'server-only'
import type { Route } from 'next'
import type { ClientRequestContext } from '@/features/auth/domain/types'
import {
  audiencesProblem,
  type AudiencesProblem
} from '@/features/audiences/read-model'
import { listHref, segmentHref } from '@/features/audiences/screen'
import { klaviyoData, type KlaviyoData } from '@/features/klaviyo-data/reader'
import { formatCount, formatMoney } from '@/features/klaviyo-data/summary'
import { toSafePreview } from '@/features/email-generation/to-safe-preview'
import type { SafePreview } from '@/features/email-generation/safe-preview'
import {
  formatBrandDate,
  formatBrandDateTime,
  relativeTime,
  timezoneLabel,
  validTimezone
} from '@/lib/brand-time'
import type {
  AudienceRef,
  KlaviyoCampaign,
  KlaviyoFlow,
  KlaviyoSnapshot
} from '@/lib/providers/klaviyo-read'
import { flowEmailHref, flowHref, metricHref } from './hrefs'
import { sourceLine } from './source'
import {
  campaignWords,
  flowSteps,
  liveEmailsLine,
  percent,
  strategyWords,
  triggerWords
} from './words'

/**
 * The pages of Klaviyo's own campaigns, flows, flow emails and metrics
 * (UI-KLV), read from the same Klaviyo data as Results and Audiences for
 * the signed-in member's workspace. The facts the old pages showed, in the
 * owner's words: names, never Klaviyo's ids; dates in the store's time
 * zone; Klaviyo's raw settings stay in Klaviyo. Pure views, for tests, and
 * one loader per page.
 */
export type KlaviyoDetailView<T> =
  | {
      state: 'ready'
      /** Where the numbers come from (sample data today). */
      source: string
      item: T
    }
  /** Klaviyo has nothing with this id. */
  | { state: 'not_found' }
  | AudiencesProblem

/** A date in the store's time zone, and how long ago it was. */
export type KlaviyoDate = { date: string; ago: string } | null

/** A segment or list a campaign sends to or leaves out. */
export type AudienceLink = {
  key: string
  name: string
  /** Segment or List, and what the campaign does with it. */
  details: string[]
  /** Its page under Audiences, or null when Klaviyo no longer has it. */
  href: Route | null
}

export type CampaignDetail = {
  name: string
  /** Sent, Scheduled, Draft or Cancelled. */
  status: string
  /** Headings that match what really happened (a draft never "was sent"). */
  words: ReturnType<typeof campaignWords>
  /** Its send time in the store's time zone, or null when none is set. */
  sendTime: string | null
  /** "Sydney time". */
  zone: string
  created: string | null
  /** How Klaviyo sends it, or null with no send time. */
  strategy: { label: string; line: string } | null
  localTime: boolean
  /** How it did, or null before it was sent. */
  stats: {
    recipients: string
    opened: string
    clicked: string
    orders: string
    sales: string
  } | null
  subject: string
  previewText: string
  from: string
  /** Klaviyo's name for its template. */
  templateName: string
  /** The email, sanitized on the server: links off, nothing from the web. */
  preview: SafePreview | null
  included: AudienceLink[]
  excluded: AudienceLink[]
}

export type FlowStepRow =
  | { kind: 'wait'; key: string; text: string }
  | {
      kind: 'email'
      key: string
      subject: string
      name: string
      live: boolean
      from: string
      href: Route
    }

export type FlowDetail = {
  name: string
  live: boolean
  /** "1 of 2 emails is not live.", when a live flow has some off. */
  notLive: string | null
  /** Sales from the flow in the last 30 days. */
  sales: string
  trigger: {
    label: string
    line: string
    /** The list's or the metric's page, when Klaviyo has it. */
    href: Route | null
    /** The button's words: Open list, Open metric. */
    open: string
  }
  emails: number
  steps: FlowStepRow[]
  created: KlaviyoDate
  updated: KlaviyoDate
}

export type FlowEmailDetail = {
  flow: { name: string; href: Route }
  subject: string
  previewText: string
  name: string
  live: boolean
  from: string
  replyTo: string | null
  /** The wait before it, or null when it goes right away. */
  wait: string | null
  templateName: string
  templateChanged: string | null
  zone: string
  preview: SafePreview | null
}

export type MetricDetail = {
  name: string
  measures: string
  events: string
  /** Shopify or Klaviyo. */
  from: string
  /** Store activity or email activity. */
  kind: string
  since: string | null
  /** The flows this metric starts. */
  flows: { key: string; name: string; details: string[]; href: Route }[]
}

type Reading = { data: KlaviyoData; timezone: string; now: Date }

const campaignStatus: Record<KlaviyoCampaign['status'], string> = {
  sent: 'Sent',
  scheduled: 'Scheduled',
  draft: 'Draft',
  cancelled: 'Cancelled'
}

function when(value: string, timezone: string, now: Date): KlaviyoDate {
  const date = formatBrandDate(value, timezone)
  const ago = relativeTime(value, now)
  return date && ago ? { date, ago } : null
}

const sender = (label: string, email: string) => `${label} <${email}>`

function audienceLinks(
  snapshot: KlaviyoSnapshot,
  refs: AudienceRef[],
  does: string
): AudienceLink[] {
  return refs.map((a) => {
    const known =
      a.kind === 'list'
        ? snapshot.lists.some((l) => l.id === a.id)
        : snapshot.segments.some((s) => s.id === a.id)
    return {
      key: `${a.kind}-${a.id}`,
      name: a.name,
      details: [a.kind === 'list' ? 'List' : 'Segment', does],
      href: known ? (a.kind === 'list' ? listHref : segmentHref)(a.id) : null
    }
  })
}

/** A Klaviyo campaign's page from the Klaviyo data. Pure, for tests. */
export function campaignView(
  { data, timezone, now }: Reading,
  campaignId: string
): KlaviyoDetailView<CampaignDetail> {
  if (data.state !== 'sample') return audiencesProblem(data, now)
  const snapshot = data.snapshot
  const c = snapshot.campaigns.find((x) => x.id === campaignId)
  if (!c) return { state: 'not_found' }
  const words = campaignWords(c.status, c.sendTime !== null)
  const sends = c.status === 'sent' ? 'Sent to it' : 'Sends to it'
  const leaves = c.status === 'sent' ? 'Left out' : 'Leaves it out'
  return {
    state: 'ready',
    source: sourceLine(data, now),
    item: {
      name: c.name,
      status: campaignStatus[c.status],
      words,
      sendTime: c.sendTime ? formatBrandDateTime(c.sendTime, timezone) : null,
      zone: timezoneLabel(timezone),
      created: formatBrandDate(c.created, timezone),
      strategy: c.sendTime ? strategyWords[c.sendStrategy] : null,
      localTime: c.localTime,
      stats: c.stats
        ? {
            recipients: formatCount(c.stats.recipients),
            opened: percent(c.stats.opens, c.stats.recipients),
            clicked: percent(c.stats.clicks, c.stats.recipients),
            orders: formatCount(c.stats.orders),
            sales: formatMoney(c.stats.revenue)
          }
        : null,
      subject: c.subject,
      previewText: c.previewText,
      from: sender(c.fromLabel, c.fromEmail),
      templateName: c.templateName,
      preview: toSafePreview(c.html),
      included: audienceLinks(snapshot, c.included, sends),
      excluded: audienceLinks(snapshot, c.excluded, leaves)
    }
  }
}

function triggerOf(snapshot: KlaviyoSnapshot, flow: KlaviyoFlow) {
  const words = triggerWords(flow)
  // Klaviyo names a flow's list or metric by name (as the old pages did).
  if (flow.trigger.kind === 'list') {
    const list = snapshot.lists.find((l) => l.name === flow.trigger.name)
    return {
      ...words,
      href: list ? listHref(list.id) : null,
      open: 'Open list'
    }
  }
  const metric = snapshot.metrics.find((m) => m.name === flow.trigger.name)
  return {
    ...words,
    href: metric ? metricHref(metric.id) : null,
    open: 'Open metric'
  }
}

/** A flow's page from the Klaviyo data. Pure, for tests. */
export function flowView(
  { data, timezone, now }: Reading,
  flowId: string
): KlaviyoDetailView<FlowDetail> {
  if (data.state !== 'sample') return audiencesProblem(data, now)
  const snapshot = data.snapshot
  const flow = snapshot.flows.find((f) => f.id === flowId)
  if (!flow) return { state: 'not_found' }
  return {
    state: 'ready',
    source: sourceLine(data, now),
    item: {
      name: flow.name,
      live: flow.status === 'live',
      notLive: liveEmailsLine(flow),
      sales: formatMoney(flow.revenue30d),
      trigger: triggerOf(snapshot, flow),
      emails: flow.messages.length,
      steps: flowSteps(flow).map((step): FlowStepRow =>
        step.kind === 'wait'
          ? { kind: 'wait', key: step.key, text: step.text }
          : {
              kind: 'email',
              key: step.key,
              subject: step.message.subject,
              name: step.message.name,
              live: step.message.status === 'live',
              from: step.message.fromLabel,
              href: flowEmailHref(step.message.id)
            }
      ),
      created: when(flow.created, timezone, now),
      updated: when(flow.updated, timezone, now)
    }
  }
}

/** One flow email's page from the Klaviyo data. Pure, for tests. */
export function flowEmailView(
  { data, timezone, now }: Reading,
  messageId: string
): KlaviyoDetailView<FlowEmailDetail> {
  if (data.state !== 'sample') return audiencesProblem(data, now)
  const flow = data.snapshot.flows.find((f) =>
    f.messages.some((m) => m.id === messageId)
  )
  const message = flow?.messages.find((m) => m.id === messageId)
  if (!flow || !message) return { state: 'not_found' }
  const wait = flowSteps(flow).find(
    (s) => s.kind === 'wait' && s.key === `${message.id}-wait`
  )
  return {
    state: 'ready',
    source: sourceLine(data, now),
    item: {
      flow: { name: flow.name, href: flowHref(flow.id) },
      subject: message.subject,
      previewText: message.previewText,
      name: message.name,
      live: message.status === 'live',
      from: sender(message.fromLabel, message.fromEmail),
      replyTo: message.replyTo,
      wait: wait?.kind === 'wait' ? wait.text : null,
      templateName: message.templateName,
      templateChanged: formatBrandDateTime(message.templateUpdated, timezone),
      zone: timezoneLabel(timezone),
      preview: toSafePreview(message.html)
    }
  }
}

const metricKind = {
  eCommerce: 'Store activity',
  Internal: 'Email activity'
} as const

/** A metric's page from the Klaviyo data. Pure, for tests. */
export function metricView(
  { data, timezone, now }: Reading,
  metricId: string
): KlaviyoDetailView<MetricDetail> {
  if (data.state !== 'sample') return audiencesProblem(data, now)
  const metric = data.snapshot.metrics.find((m) => m.id === metricId)
  if (!metric) return { state: 'not_found' }
  return {
    state: 'ready',
    source: sourceLine(data, now),
    item: {
      name: metric.name,
      measures: metric.measures,
      events: formatCount(metric.events30d),
      from: metric.integration,
      kind: metricKind[metric.category],
      since: formatBrandDate(metric.created, timezone),
      flows: data.snapshot.flows
        .filter(
          (f) => f.trigger.kind === 'metric' && f.trigger.name === metric.name
        )
        .map((f) => ({
          key: f.id,
          name: f.name,
          details: [
            'Flow',
            f.status === 'live' ? 'Live' : 'Draft',
            f.status === 'live'
              ? 'Starts when this happens'
              : 'Would start when this happens'
          ],
          href: flowHref(f.id)
        }))
    }
  }
}

const unread: AudiencesProblem = {
  state: 'unavailable',
  reason: 'Klaviyo could not be read just now.',
  retry: true
}

/** Reads the signed-in member's workspace's Klaviyo data, once. */
async function reading(
  context: ClientRequestContext,
  now: Date
): Promise<Reading | null> {
  const timezone = validTimezone(context.timezone)
  try {
    return {
      data: await klaviyoData(context.tenantId, timezone, now.getTime()),
      timezone,
      now
    }
  } catch {
    return null
  }
}

function loader<T>(view: (read: Reading, id: string) => KlaviyoDetailView<T>) {
  return async (
    context: ClientRequestContext,
    id: string,
    now = new Date()
  ): Promise<KlaviyoDetailView<T>> => {
    const read = await reading(context, now)
    return read ? view(read, id) : unread
  }
}

/** Each page for the signed-in member's workspace. */
export const campaignDetail = loader(campaignView)
export const flowDetail = loader(flowView)
export const flowEmailDetail = loader(flowEmailView)
export const metricDetail = loader(metricView)
