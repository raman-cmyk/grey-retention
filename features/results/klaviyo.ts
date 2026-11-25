import type { Route } from 'next'
import type { KlaviyoData } from '@/features/klaviyo-data/reader'
import { formatCount, formatMoney } from '@/features/klaviyo-data/summary'
import {
  flowHref,
  klaviyoCampaignHref,
  metricHref
} from '@/features/klaviyo-detail/hrefs'
import { sourceLine } from '@/features/klaviyo-detail/source'
import { triggerWords } from '@/features/klaviyo-detail/words'
import { formatBrandDate } from '@/lib/brand-time'
import type { KlaviyoCampaign } from '@/lib/providers/klaviyo-read'

/**
 * What Results shows from Klaviyo itself (UI-KLV): the account's campaigns,
 * flows and metrics, each row opening its own page under Results. Read
 * from the same Klaviyo data as Audiences, for the signed-in member's
 * workspace; null when Klaviyo cannot be read (Results then shows only
 * the emails GROS made, and Settings says why).
 */
export type KlaviyoRow = {
  key: string
  title: string
  /** Joined with a middle dot. */
  details: string[]
  href: Route
}

export type KlaviyoResults = {
  /** Where the numbers come from (sample data today), on each card. */
  source: string
  campaigns: KlaviyoRow[]
  flows: KlaviyoRow[]
  metrics: KlaviyoRow[]
}

const status: Record<KlaviyoCampaign['status'], string> = {
  sent: 'Sent',
  scheduled: 'Scheduled',
  draft: 'Draft',
  cancelled: 'Cancelled'
}

const emails = (n: number) => (n === 1 ? '1 email' : `${n} emails`)

/** The rows from the Klaviyo data. Pure, for tests. */
export function klaviyoResults(
  data: KlaviyoData,
  timezone: string,
  now: Date
): KlaviyoResults | null {
  if (data.state !== 'sample') return null
  const { campaigns, flows, metrics } = data.snapshot
  return {
    source: sourceLine(data, now),
    campaigns: campaigns.map((c) => ({
      key: c.id,
      title: c.name,
      details: [
        status[c.status],
        c.sendTime ? (formatBrandDate(c.sendTime, timezone) ?? '') : '',
        c.stats ? `${formatCount(c.stats.recipients)} sent` : '',
        c.stats ? `${formatMoney(c.stats.revenue)} in sales` : ''
      ].filter(Boolean),
      href: klaviyoCampaignHref(c.id)
    })),
    flows: flows.map((f) => ({
      key: f.id,
      title: f.name,
      details: [
        f.status === 'live' ? 'Live' : 'Draft',
        triggerWords(f).label,
        emails(f.messages.length),
        `${formatMoney(f.revenue30d)} in 30 days`
      ],
      href: flowHref(f.id)
    })),
    metrics: metrics.map((m) => ({
      key: m.id,
      title: m.name,
      details: [`${formatCount(m.events30d)} in 30 days`, m.integration],
      href: metricHref(m.id)
    }))
  }
}
