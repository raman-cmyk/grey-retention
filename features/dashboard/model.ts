import type { OverviewCampaign } from '@/features/campaigns/overview-model'
import {
  formatCount,
  formatMoney,
  monthToDate,
  revenueSummary,
  upcomingKlaviyoCampaigns
} from '@/features/klaviyo-data/summary'
import type { KlaviyoSnapshot } from '@/features/klaviyo-data/types'

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
  const newSubs = Math.round(
    subs.count - subs.count / (1 + subs.changePercent / 100)
  )
  const trend = subs.changePercent >= 0 ? 'up' : 'down'
  return [
    {
      label: 'Active subscribers',
      value: formatCount(subs.count, true),
      caption: `${trend === 'up' ? '↑' : '↓'} ${Math.abs(subs.changePercent)}% vs previous 30d`,
      trend
    },
    {
      label: 'List growth',
      value: `${newSubs >= 0 ? '+' : '−'}${formatCount(Math.abs(newSubs), true)}`,
      caption: 'new subscribers · 30d'
    },
    {
      label: 'Revenue · flows',
      value: formatMoney(summary.flows, { compact: true }),
      caption: `${summary.liveFlows} live flows · 30d`
    },
    {
      label: 'Revenue · campaigns',
      value: formatMoney(summary.campaigns, { compact: true }),
      caption: `${summary.sentCampaigns} campaigns · 30d`
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
 * fix: the old app said "No upcoming campaigns" while drafts existed).
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
        !['sent', 'cancelled'].includes(c.delivery_state) &&
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

/** "in 2 days 4 hours", "in 35 minutes", "now". */
export function countdown(at: string, now: Date) {
  const ms = Date.parse(at) - now.getTime()
  if (!Number.isFinite(ms) || ms <= 0) return 'now'
  const minutes = Math.floor(ms / 60000)
  const days = Math.floor(minutes / 1440)
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

/** Email revenue this month against an optional goal (for the gauge). */
export function gauge(
  snapshot: KlaviyoSnapshot,
  now: Date,
  goalMinor: number | null
) {
  const value = monthToDate(snapshot, now)
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
 * A short insight written from the numbers, with no AI (the AI runs in
 * sample mode). Mentions the top flow, the best campaign and the best day.
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
  const share = (minor: number) =>
    Math.round((minor / summary.total.minor) * 100)
  const parts = [
    `Flows earned ${share(summary.flows.minor)}% of your email revenue in the last 30 days, campaigns ${share(summary.campaigns.minor)}%.`
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
