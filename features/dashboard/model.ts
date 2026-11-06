import type { Route } from 'next'
import type { OverviewCampaign } from '@/features/campaigns/overview-model'
import {
  formatCount,
  formatMoney,
  monthToDate,
  revenueSummary,
  upcomingKlaviyoCampaigns
} from '@/features/klaviyo-data/summary'
import { formatBrandDate } from '@/lib/brand-time'
import type { KlaviyoSnapshot } from '@/lib/providers/klaviyo-read'

/** The dashboard's URL state; every link keeps the parts it doesn't change. */
export type DashboardQuery = {
  tab?: string
  attr?: string
  insight?: string
  focus?: string
  p?: string
}

const order: (keyof DashboardQuery)[] = ['tab', 'attr', 'insight', 'focus', 'p']

export function readQuery(
  raw: Record<string, string | string[] | undefined>
): DashboardQuery {
  const one = (value: string | string[] | undefined) =>
    (Array.isArray(value) ? value[0] : value)?.slice(0, 64)
  return Object.fromEntries(
    order.flatMap((key) => {
      const value = one(raw[key])
      return value ? [[key, value]] : []
    })
  )
}

/**
 * `/dashboard?…` with `patch` applied to the current query (null removes a
 * key), so switching attribution keeps the open Klaviyo tab and the reverse
 * (docs/OWNER_JOURNEYS.md §3: the toggle changes ONLY the gauge card).
 */
export function dashboardHref(
  current: DashboardQuery,
  patch: Partial<Record<keyof DashboardQuery, string | null>>,
  hash?: string
): Route {
  const next = { ...current }
  for (const [key, value] of Object.entries(patch) as [
    keyof DashboardQuery,
    string | null
  ][]) {
    if (value === null) delete next[key]
    else next[key] = value
  }
  const params = new URLSearchParams()
  for (const key of order) if (next[key]) params.set(key, next[key]!)
  const query = params.toString()
  return `/dashboard${query ? `?${query}` : ''}${hash ? `#${hash}` : ''}` as Route
}

export type Kpi = {
  label: string
  value: string
  caption: string
  trend?: 'up' | 'down'
}

/**
 * The KPI strip. Only numbers we really have are shown: the old app's
 * "Coming soon" tiles are gone (docs/OWNER_JOURNEYS.md §18.7), and every
 * revenue tile names its source and period (§3 friction).
 */
export function dashboardKpis(snapshot: KlaviyoSnapshot): Kpi[] {
  const summary = revenueSummary(snapshot)
  const subs = snapshot.activeSubscribers
  const previous =
    subs.changePercent > -100
      ? subs.count / (1 + subs.changePercent / 100)
      : null
  const net = previous === null ? null : Math.round(subs.count - previous)
  const trend =
    subs.changePercent > 0 ? 'up' : subs.changePercent < 0 ? 'down' : undefined
  const plural = (n: number, word: string) =>
    `${n} ${word}${n === 1 ? '' : 's'}`
  return [
    {
      label: 'Active subscribers',
      value: formatCount(subs.count, true),
      caption:
        previous === null
          ? 'no subscribers in the previous 30d'
          : `${trend === 'up' ? '↑ ' : trend === 'down' ? '↓ ' : ''}${Math.abs(subs.changePercent)}% vs previous 30d`,
      trend
    },
    {
      label: 'Net change',
      value:
        net === null
          ? '—'
          : `${net > 0 ? '+' : net < 0 ? '−' : ''}${formatCount(Math.abs(net), true)}`,
      caption: 'subscribers · 30d'
    },
    {
      label: 'Revenue · flows',
      value: formatMoney(summary.flows, { compact: true }),
      caption: `from ${plural(summary.earningFlows, 'flow')} · 30d`
    },
    {
      label: 'Revenue · campaigns',
      value: formatMoney(summary.campaigns, { compact: true }),
      caption: `from ${plural(summary.earningCampaigns, 'campaign')} · 30d`
    },
    {
      label: 'Abandoned checkouts',
      value: formatCount(snapshot.abandonedCheckouts30d),
      caption: 'checkouts · 30d'
    }
  ]
}

export type UpcomingSend = {
  id: string
  name: string
  at: string
  source: 'workspace' | 'klaviyo'
  href: `/campaigns/${string}` | null
}

/**
 * Next sends from BOTH this workspace and Klaviyo (docs/OWNER_JOURNEYS.md §3
 * fix: the old app said "No upcoming campaigns" while drafts existed). Only
 * campaigns that can still send count: not rejected, failed or blocked.
 */
export function upcomingSends(
  campaigns: readonly OverviewCampaign[],
  snapshot: KlaviyoSnapshot | null,
  now: Date
): UpcomingSend[] {
  const local: UpcomingSend[] = campaigns
    .filter(
      (c) =>
        !c.superseded_by_plan &&
        c.calendar_state !== 'rejected' &&
        !['sent', 'cancelled', 'failed', 'blocked'].includes(
          c.delivery_state
        ) &&
        Date.parse(c.planned_at) > now.getTime()
    )
    .map((c) => ({
      id: c.id,
      name: c.title,
      at: c.planned_at,
      source: 'workspace',
      href: `/campaigns/${c.id}` as const
    }))
  const klaviyo: UpcomingSend[] = snapshot
    ? upcomingKlaviyoCampaigns(snapshot, now).map((c) => ({
        id: c.id,
        name: c.name,
        at: c.sendTime!,
        source: 'klaviyo',
        href: null
      }))
    : []
  return [...local, ...klaviyo].sort(
    (a, b) =>
      Date.parse(a.at) - Date.parse(b.at) || a.name.localeCompare(b.name)
  )
}

/** "in 2 days 4 hours", "in 35 minutes", "now"; past a month, the date. */
export function countdown(at: string, now: Date, timezone = 'UTC') {
  const ms = Date.parse(at) - now.getTime()
  if (!Number.isFinite(ms) || ms <= 0) return 'now'
  const minutes = Math.floor(ms / 60000)
  const days = Math.floor(minutes / 1440)
  if (days > 30) return `on ${formatBrandDate(at, timezone)}`
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  const plural = (n: number, word: string) =>
    `${n} ${word}${n === 1 ? '' : 's'}`
  if (days > 0)
    return `in ${plural(days, 'day')}${hours ? ` ${plural(hours, 'hour')}` : ''}`
  if (hours > 0)
    return `in ${plural(hours, 'hour')}${mins ? ` ${plural(mins, 'minute')}` : ''}`
  return `in ${plural(Math.max(1, mins), 'minute')}`
}

/** Email revenue this month (brand timezone) against an optional goal. */
export function gauge(
  snapshot: KlaviyoSnapshot,
  now: Date,
  goalMinor: number | null,
  timezone: string
) {
  const value = monthToDate(snapshot, now, timezone)
  const fraction =
    goalMinor && goalMinor > 0
      ? Math.min(1, Math.max(0, value.minor / goalMinor))
      : 0
  return {
    value,
    label: formatMoney(value, { cents: true }),
    goal:
      goalMinor && goalMinor > 0
        ? formatMoney({ minor: goalMinor, currency: value.currency })
        : null,
    fraction
  }
}

/**
 * A short insight written from the numbers, with no AI. Mentions the share
 * of revenue by source (always adding up to 100%), the top flow and the best
 * campaign.
 */
export function numbersInsight(snapshot: KlaviyoSnapshot) {
  const summary = revenueSummary(snapshot)
  if (summary.total.minor <= 0)
    return 'No email revenue in the last 30 days yet.'
  const topFlow = [...snapshot.flows].sort(
    (a, b) => b.revenue30d.minor - a.revenue30d.minor
  )[0]
  const topCampaign = [...snapshot.campaigns]
    .filter((c) => c.revenue30d)
    .sort((a, b) => b.revenue30d!.minor - a.revenue30d!.minor)[0]
  const flowShare = Math.round(
    (summary.flows.minor / summary.total.minor) * 100
  )
  const parts = [
    `Flows earned ${flowShare}% of your email revenue in the last 30 days, campaigns ${100 - flowShare}%.`
  ]
  if (topFlow && topFlow.revenue30d.minor > 0)
    parts.push(
      `${topFlow.name} was the top flow (${formatMoney(topFlow.revenue30d)}).`
    )
  if (topCampaign)
    parts.push(
      `Your best campaign was “${topCampaign.name}” (${formatMoney(topCampaign.revenue30d!)}).`
    )
  return parts.join(' ')
}
