import 'server-only'
import { z } from 'zod'
import { KlaviyoError, type KlaviyoClient } from './client'
import { reportRows } from './history'

/**
 * The results of the emails we pushed (LRN-001), in the shapes revision
 * 2026-10-15 publishes: the campaign report per A/B variation (opens,
 * clicks, orders, revenue) and the Clicked Email counts per link. Both are
 * questions Klaviyo takes as a POST; nothing is written. The report allows
 * 2 questions a minute (225 a day), so one question covers every due
 * campaign of an account (at most 100).
 */

const kid = /^[A-Za-z0-9]{1,64}$/
const invalid = (endpoint: string) =>
  new KlaviyoError('invalid_response', { endpoint })

export const campaignReportPath = '/api/campaign-values-reports'
export const metricAggregatesPath = '/api/metric-aggregates'
/** Campaigns one report question may name (Klaviyo's list filter limit). */
export const maxReportCampaigns = 100
/** Link rows kept per email (one per variation and address). */
export const maxLinkRows = 200

/** What a result counts (rates come as fractions, 0 to 1). */
export const resultStatistics = [
  'recipients',
  'delivered',
  'opens_unique',
  'open_rate',
  'clicks_unique',
  'click_rate',
  'conversions',
  'conversion_uniques',
  'conversion_value',
  'revenue_per_recipient',
  'unsubscribe_uniques',
  'unsubscribe_rate',
  'spam_complaints',
  'bounced'
] as const
export type ResultStatistic = (typeof resultStatistics)[number]

export type VariationResult = {
  campaignId: string
  messageId: string
  /** Klaviyo's variation id; null when the report gives none. */
  variationId: string | null
  variationName: string | null
  statistics: Partial<Record<ResultStatistic, number>>
}

/** Klaviyo ignores a timeframe's offset and uses the account's timezone. */
const day = (d: Date) => d.toISOString().slice(0, 19) + '+00:00'

/**
 * The results of these campaigns' email messages, per variation, from
 * `from` to `to` (both a day wider than the send, so the account's own
 * timezone cuts nothing off). Rows of another campaign or channel are left
 * out.
 */
export async function readCampaignResults(
  client: KlaviyoClient,
  conversionMetricId: string,
  campaignIds: string[],
  window: { from: Date; to: Date }
): Promise<{ rows: VariationResult[]; complete: boolean }> {
  if (
    !campaignIds.length ||
    campaignIds.length > maxReportCampaigns ||
    campaignIds.some((id) => !kid.test(id)) ||
    !kid.test(conversionMetricId) ||
    !(window.from < window.to)
  )
    throw invalid(campaignReportPath)
  const read = reportRows(
    await client.query(
      campaignReportPath,
      {
        data: {
          type: 'campaign-values-report',
          attributes: {
            statistics: resultStatistics,
            timeframe: { start: day(window.from), end: day(window.to) },
            conversion_metric_id: conversionMetricId,
            group_by: [
              'campaign_id',
              'campaign_message_id',
              'variation',
              'variation_name'
            ],
            filter: `and(contains-any(campaign_id,[${campaignIds.map((id) => `"${id}"`).join(',')}]),equals(send_channel,"email"))`
          }
        }
      },
      'campaigns:read'
    ),
    campaignReportPath
  )
  const asked = new Set(campaignIds)
  const known = new Set<string>(resultStatistics)
  const rows = read.rows.flatMap((r) => {
    const campaignId = r.groupings.campaign_id
    const messageId = r.groupings.campaign_message_id
    if (!campaignId || !asked.has(campaignId) || !messageId) return []
    if (!kid.test(messageId)) return []
    const variation = r.groupings.variation ?? null
    return [
      {
        campaignId,
        messageId,
        variationId: variation && kid.test(variation) ? variation : null,
        variationName: r.groupings.variation_name?.slice(0, 120) || null,
        statistics: Object.fromEntries(
          Object.entries(r.statistics).filter(([k]) => known.has(k))
        ) as VariationResult['statistics']
      }
    ]
  })
  return { rows, complete: read.complete }
}

export type LinkClicks = {
  variationId: string | null
  /** The address clicked, as Klaviyo recorded it. */
  url: string
  clicks: number
  /** Unique clickers per day, added up (a person on two days counts twice). */
  unique: number
}

const aggregateAnswer = z.object({
  data: z.object({
    attributes: z.object({
      data: z.array(
        z.object({
          dimensions: z.array(z.string().nullable()),
          measurements: z.record(z.string(), z.array(z.number().nullable()))
        })
      )
    })
  }),
  links: z.object({ next: z.string().nullish() }).partial().nullish()
})

/** Klaviyo's filter time: UTC, no offset (the query says its timezone). */
const filterTime = (d: Date) => d.toISOString().slice(0, 19)
const total = (values: (number | null)[] | undefined) =>
  (values ?? []).reduce<number>(
    (sum, v) =>
      sum + (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0),
    0
  )

/**
 * One email message's link clicks from `from` to `to`, per variation and
 * address (Klaviyo's Clicked Email metric). Addresses longer than 2,000
 * characters and rows beyond `maxLinkRows` are left out.
 */
export async function readLinkClicks(
  client: KlaviyoClient,
  clickedMetricId: string,
  messageId: string,
  window: { from: Date; to: Date }
): Promise<{ rows: LinkClicks[]; complete: boolean }> {
  if (
    !kid.test(clickedMetricId) ||
    !kid.test(messageId) ||
    !(window.from < window.to)
  )
    throw invalid(metricAggregatesPath)
  const parsed = aggregateAnswer.safeParse(
    await client.query(
      metricAggregatesPath,
      {
        data: {
          type: 'metric-aggregate',
          attributes: {
            metric_id: clickedMetricId,
            measurements: ['count', 'unique'],
            interval: 'day',
            by: ['$variation', 'URL'],
            filter: [
              `greater-or-equal(datetime,${filterTime(window.from)})`,
              `less-than(datetime,${filterTime(window.to)})`,
              `equals($message,"${messageId}")`
            ],
            timezone: 'UTC',
            page_size: 500
          }
        }
      },
      'metrics:read'
    )
  )
  if (!parsed.success) throw invalid(metricAggregatesPath)
  const rows: LinkClicks[] = []
  let complete = !parsed.data.links?.next
  for (const r of parsed.data.data.attributes.data) {
    const [variation, url] = r.dimensions
    if (!url || url.length > 2_000) continue
    if (rows.length >= maxLinkRows) {
      complete = false
      break
    }
    rows.push({
      variationId: variation && kid.test(variation) ? variation : null,
      url,
      clicks: Math.round(total(r.measurements.count)),
      unique: Math.round(total(r.measurements.unique))
    })
  }
  return { rows, complete }
}
