import { metricsPath } from './catalog'
import type { KlaviyoResponse, KlaviyoTransport } from './client'
import { resultStatistics } from './results'

/**
 * Recorded Klaviyo answers (revision 2026-10-15) for the results reads'
 * contract tests (LRN-001): the account's metrics, the campaign report
 * grouped per variation, and the Clicked Email counts per link, for a
 * made-up account. Each question is checked against what the spec allows
 * (its statistics, groupings, filters and timeframe); anything else gets
 * Klaviyo's 400. Other requests go to `rest` (the fake draft account).
 */

const json = (status: number, body: unknown): KlaviyoResponse => ({
  status,
  headers: { 'content-type': 'application/vnd.api+json' },
  body: JSON.stringify(body)
})
const refused = (status: number, code = 'invalid') =>
  json(status, { errors: [{ status, code, title: 'Refused.' }] })

export type RecordedVariation = {
  campaignId: string
  messageId: string
  variationId: string
  name: string
  statistics: Record<string, number>
}
export type RecordedClick = {
  messageId: string
  variationId: string
  url: string
  /** Klaviyo counted it as a bot's click. */
  bot?: boolean
  /** Per day. */
  count: number[]
  unique: number[]
}

/** The report's statistics and groupings the spec allows. */
const statistics = new Set<string>([
  ...resultStatistics,
  'average_order_value',
  'clicks',
  'opens',
  'unsubscribes'
])
const groupings = new Set([
  'campaign_id',
  'campaign_message_id',
  'campaign_message_name',
  'group',
  'group_name',
  'send_channel',
  'tag_id',
  'tag_name',
  'text_message_format',
  'variation',
  'variation_name'
])
const aggregateBy = new Set([
  '$message',
  '$variation',
  'URL',
  'Campaign Name',
  'Bot Click'
])
const time =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
const filterTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/

export function recordedResultsTransport(options: {
  rest?: KlaviyoTransport
  variations?: RecordedVariation[]
  clicks?: RecordedClick[]
  /** Leave Clicked Email (or Placed Order) out of the account's metrics. */
  without?: ('Placed Order' | 'Clicked Email')[]
  /** Say there is another page of the report or of the counts. */
  more?: boolean
  /** Questions asked, as their parsed bodies. */
  asked?: { path: string; body: unknown }[]
  /**
   * What Klaviyo keys a click's `$message` by: the campaign message id (by
   * default) or the campaign id (as some accounts report it).
   */
  clicksKeyedBy?: 'message' | 'campaign'
  /** Report rows give the campaign id as their message id too. */
  reportMessageIsCampaign?: boolean
}): KlaviyoTransport {
  const metrics = [
    {
      type: 'metric',
      id: 'PlcdOr',
      attributes: {
        name: 'Placed Order',
        integration: { name: 'Shopify', category: 'eCommerce' }
      }
    },
    {
      type: 'metric',
      id: 'ClkEml',
      attributes: {
        name: 'Clicked Email',
        integration: { name: 'Klaviyo', category: 'Internal' }
      }
    }
  ].filter(
    (m) =>
      !options.without?.includes(
        m.attributes.name as 'Placed Order' | 'Clicked Email'
      )
  )
  return async (request) => {
    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname + url.search === metricsPath)
      return json(200, { data: metrics, links: { next: null } })
    if (
      request.method === 'POST' &&
      url.pathname === '/api/campaign-values-reports'
    ) {
      const body = JSON.parse(request.body ?? 'null')
      options.asked?.push({ path: url.pathname, body })
      const a = body?.data?.attributes
      if (
        body?.data?.type !== 'campaign-values-report' ||
        !Array.isArray(a?.statistics) ||
        a.statistics.some((s: unknown) => !statistics.has(String(s))) ||
        typeof a?.conversion_metric_id !== 'string' ||
        !metrics.some((m) => m.id === a.conversion_metric_id) ||
        !time.test(a?.timeframe?.start ?? '') ||
        !time.test(a?.timeframe?.end ?? '') ||
        !Array.isArray(a?.group_by) ||
        a.group_by.some((g: unknown) => !groupings.has(String(g))) ||
        !a.group_by.includes('campaign_id') ||
        !a.group_by.includes('campaign_message_id')
      )
        return refused(400)
      const filter =
        /^and\(contains-any\(campaign_id,\[((?:"[A-Za-z0-9]+",?)+)\]\),equals\(send_channel,"email"\)\)$/.exec(
          a.filter ?? ''
        )
      if (!filter) return refused(400)
      const ids = [...filter[1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!)
      if (ids.length > 100) return refused(400)
      const rows = (options.variations ?? [])
        .filter((v) => ids.includes(v.campaignId))
        .map((v) => ({
          groupings: {
            campaign_id: v.campaignId,
            campaign_message_id: options.reportMessageIsCampaign
              ? v.campaignId
              : v.messageId,
            ...(a.group_by.includes('variation')
              ? { variation: v.variationId }
              : {}),
            ...(a.group_by.includes('variation_name')
              ? { variation_name: v.name }
              : {})
          },
          statistics: Object.fromEntries(
            Object.entries(v.statistics).filter(([k]) =>
              a.statistics.includes(k)
            )
          )
        }))
      return json(200, {
        data: {
          type: 'campaign-values-report',
          id: 'rpt1',
          attributes: { results: rows }
        },
        links: {
          self: 'https://a.klaviyo.com/api/campaign-values-reports',
          next: options.more
            ? 'https://a.klaviyo.com/api/campaign-values-reports?page[cursor]=x'
            : null
        }
      })
    }
    if (
      request.method === 'POST' &&
      url.pathname === '/api/metric-aggregates'
    ) {
      const body = JSON.parse(request.body ?? 'null')
      options.asked?.push({ path: url.pathname, body })
      const a = body?.data?.attributes
      const filters: string[] = Array.isArray(a?.filter) ? a.filter : []
      const from = filters
        .map((f) => /^greater-or-equal\(datetime,(.+)\)$/.exec(f)?.[1])
        .find(Boolean)
      const to = filters
        .map((f) => /^less-than\(datetime,(.+)\)$/.exec(f)?.[1])
        .find(Boolean)
      const message = filters
        .map((f) => /^equals\(\$message,"([A-Za-z0-9_-]+)"\)$/.exec(f)?.[1])
        .find(Boolean)
      // Klaviyo's guide: one filter besides the date range.
      const others = filters.filter(
        (f) => !/^(?:greater-or-equal|less-than)\(datetime,/.test(f)
      )
      if (
        body?.data?.type !== 'metric-aggregate' ||
        !metrics.some((m) => m.id === a?.metric_id) ||
        !Array.isArray(a?.measurements) ||
        a.measurements.some(
          (m: unknown) => !['count', 'unique', 'sum_value'].includes(String(m))
        ) ||
        !['day', 'hour', 'week', 'month'].includes(a?.interval) ||
        !Array.isArray(a?.by) ||
        a.by.some((b: unknown) => !aggregateBy.has(String(b))) ||
        !from ||
        !to ||
        !filterTime.test(from) ||
        !filterTime.test(to) ||
        !message ||
        others.length !== 1
      )
        return refused(400)
      const keyOf = (c: RecordedClick) =>
        options.clicksKeyedBy === 'campaign'
          ? (options.variations ?? []).find((v) => v.messageId === c.messageId)
              ?.campaignId
          : c.messageId
      const rows = (options.clicks ?? [])
        .filter((c) => keyOf(c) === message)
        .map((c) => ({
          dimensions: a.by.map((b: string) =>
            b === '$variation'
              ? c.variationId
              : b === 'URL'
                ? c.url
                : b === 'Bot Click'
                  ? c.bot
                    ? 'true'
                    : 'false'
                  : null
          ),
          measurements: { count: c.count, unique: c.unique }
        }))
      return json(200, {
        data: {
          type: 'metric-aggregate',
          id: 'agg1',
          attributes: { dates: [from], data: rows },
          links: { self: 'https://a.klaviyo.com/api/metric-aggregates' }
        },
        links: {
          next: options.more
            ? 'https://a.klaviyo.com/api/metric-aggregates?page[cursor]=x'
            : null
        }
      })
    }
    if (options.rest) return options.rest(request)
    return refused(404, 'not_found')
  }
}
