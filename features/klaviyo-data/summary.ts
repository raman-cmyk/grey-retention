import type { KlaviyoCampaign, KlaviyoSnapshot, Money } from './types'

/** One money format for every card: `$22.6K` (compact) or `$22,638`. */
export function formatMoney(
  value: Money,
  {
    compact = false,
    cents = false
  }: { compact?: boolean; cents?: boolean } = {}
) {
  const amount = value.minor / 100
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: value.currency,
      notation: compact ? 'compact' : 'standard',
      maximumFractionDigits: compact ? 1 : cents ? 2 : 0,
      minimumFractionDigits: cents && !compact ? 2 : 0
    }).format(amount)
  } catch {
    return `${Math.round(amount).toLocaleString('en-US')} ${value.currency}`
  }
}

export function formatCount(value: number, compact = false) {
  return new Intl.NumberFormat('en-US', {
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: compact ? 1 : 0
  }).format(value)
}

const sum = (values: Money[], currency: string): Money => ({
  minor: values.reduce((total, v) => total + v.minor, 0),
  currency
})

/**
 * The 30-day revenue numbers every card shows. They are derived from the
 * same rows, so flows + campaigns always equals the chart total.
 */
export function revenueSummary(snapshot: KlaviyoSnapshot) {
  const currency = snapshot.account.currency
  const flows = sum(
    snapshot.flows.map((f) => f.revenue30d),
    currency
  )
  const campaigns = sum(
    snapshot.campaigns.flatMap((c) => (c.revenue30d ? [c.revenue30d] : [])),
    currency
  )
  const total = sum(
    snapshot.daily.map((d) => d.revenue),
    currency
  )
  const activeDays = snapshot.daily.filter((d) => d.revenue.minor > 0).length
  const best = snapshot.daily.reduce<(typeof snapshot.daily)[number] | null>(
    (top, day) => (!top || day.revenue.minor > top.revenue.minor ? day : top),
    null
  )
  return {
    flows,
    campaigns,
    total,
    activeDays,
    averagePerDay: {
      minor: snapshot.daily.length
        ? Math.round(total.minor / snapshot.daily.length)
        : 0,
      currency
    } satisfies Money,
    bestDay: best,
    liveFlows: snapshot.flows.filter((f) => f.status === 'live').length,
    draftFlows: snapshot.flows.filter((f) => f.status === 'draft').length,
    sentCampaigns: snapshot.campaigns.filter((c) => c.status === 'sent').length
  }
}

/** Email revenue in the current month, in the account timezone. */
export function monthToDate(snapshot: KlaviyoSnapshot, now: Date): Money {
  const month = new Intl.DateTimeFormat('en-CA', {
    timeZone: snapshot.account.timezone,
    year: 'numeric',
    month: '2-digit'
  }).format(now)
  return sum(
    snapshot.daily
      .filter((d) => d.date.startsWith(month))
      .map((d) => d.revenue),
    snapshot.account.currency
  )
}

/** Klaviyo campaigns that will send after `now`, soonest first. */
export function upcomingKlaviyoCampaigns(
  snapshot: KlaviyoSnapshot,
  now: Date
): KlaviyoCampaign[] {
  return snapshot.campaigns
    .filter(
      (c) =>
        c.status === 'scheduled' &&
        c.sendTime !== null &&
        Date.parse(c.sendTime) > now.getTime()
    )
    .sort((a, b) => Date.parse(a.sendTime!) - Date.parse(b.sendTime!))
}

/** Campaigns by send time, newest first; never-sent drafts last (§3 fix). */
export function campaignsNewestFirst(campaigns: readonly KlaviyoCampaign[]) {
  return [...campaigns].sort((a, b) => {
    if (a.sendTime === null) return b.sendTime === null ? 0 : 1
    if (b.sendTime === null) return -1
    return Date.parse(b.sendTime) - Date.parse(a.sendTime)
  })
}
