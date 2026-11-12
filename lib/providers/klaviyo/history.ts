import 'server-only'
import { z } from 'zod'
import { readPages, type MorePages, type PagedRead } from './catalog'
import { KlaviyoError, type KlaviyoClient } from './client'

/**
 * Reads of what a Klaviyo account already sent (ONB-103): campaign messages
 * with their subjects, the campaigns' audiences, the campaign and flow
 * reports, the flows, lists and segments. Read-only: the two reports are
 * questions Klaviyo takes as a POST, nothing is written. Every address and
 * value is one revision 2026-10-15 publishes (Klaviyo's OpenAPI spec). As
 * for the catalog, a page is asked for only while `more()` allows it, and a
 * record of a shape we do not know is skipped and counted.
 */

export type CampaignMessage = {
  id: string
  campaignId: string | null
  campaignName: string | null
  /** The campaign is archived in Klaviyo (it was still sent). */
  archived: boolean
  name: string | null
  status: 'sent' | 'scheduled'
  /** When it was (or will be) sent, ISO; null when Klaviyo does not say. */
  sendAt: string | null
  /**
   * How it is sent: `static` at one time, `local` at the same clock time in
   * each recipient's timezone, `optimized` at a time Klaviyo picks per
   * recipient (send-time optimization or a send-time test).
   */
  strategy: 'static' | 'local' | 'optimized'
  channel: string | null
  subject: string | null
  preview: string | null
  /** Its variations came with it (their subject, preview and channel). */
  contentKnown: boolean
  /** It has more than one variation (an A/B content test). */
  abTest: boolean
}

export type CampaignAudience = {
  campaignId: string
  included: string[]
  excluded: string[]
}

export type ReportRow = {
  groupings: Record<string, string>
  statistics: Record<string, number>
}

export type ReportRead = {
  rows: ReportRow[]
  /** False when Klaviyo said there was more than this one page. */
  complete: boolean
}

export type Flow = {
  id: string
  name: string
  status: string
  trigger: string | null
}

export type Audience = {
  id: string
  kind: 'list' | 'segment'
  name: string
  active: boolean
  starred: boolean
}

/** Pages of messages (100 a page), flows (50), lists and segments (10). */
export const maxMessagePages = 3
export const maxFlowPages = 2
export const maxAudiencePages = 6

const stamp = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z')

export function messagesPath(status: 'sent' | 'scheduled', since: Date | null) {
  const filter =
    status === 'sent' && since
      ? `equals(status,"sent"),greater-than(created,${stamp(since)})`
      : `equals(status,"${status}")`
  return (
    '/api/campaign-messages?fields[campaign-message]=definition.name,definition.status,definition.send_options.send_time,definition.send_options.send_strategy,created' +
    `&fields[campaign]=definition.name,definition.archived,definition.send_settings.send_strategy&filter=${filter}` +
    '&include=campaign,campaign-variations&page[size]=100&sort=-created'
  )
}

const kidPattern = /^[A-Za-z0-9]{1,64}$/

export function campaignAudiencesPath(ids: string[]) {
  if (!ids.length || ids.length > 100 || ids.some((id) => !kidPattern.test(id)))
    throw new KlaviyoError('invalid_response', { endpoint: '/api/campaigns/' })
  return (
    `/api/campaigns?fields[campaign]=definition.name&fields[campaign-audience]=definition.included,definition.excluded` +
    `&filter=any(id,[${ids.map((id) => `"${id}"`).join(',')}])&include=campaign-audiences&page[size]=100`
  )
}

export function variationsPath(messageId: string) {
  if (!kidPattern.test(messageId))
    throw new KlaviyoError('invalid_response', {
      endpoint: '/api/campaign-messages/'
    })
  return `/api/campaign-messages/${messageId}/campaign-variations?fields[campaign-variation]=definition.details`
}

export const campaignReportPath = '/api/campaign-values-reports'
export const flowReportPath = '/api/flow-values-reports'
export const flowsPath =
  '/api/flows?fields[flow]=name,status,trigger_type&filter=equals(archived,false)&page[size]=50'
export const listsPath = '/api/lists?fields[list]=name&page[size]=10'
export const segmentsPath =
  '/api/segments?fields[segment]=name,is_active,is_starred&page[size]=10'

/** What the reports count (rates come as fractions, 0 to 1). */
export const campaignStatistics = [
  'recipients',
  'opens_unique',
  'open_rate',
  'clicks_unique',
  'click_rate',
  'conversions',
  'conversion_value',
  'revenue_per_recipient',
  'unsubscribe_rate'
] as const
export const flowStatistics = [
  'recipients',
  'conversions',
  'conversion_value'
] as const

const id = z.string().regex(kidPattern)
const text = (max: number) =>
  z
    .string()
    .nullish()
    .transform((v) => (v?.trim() ? v.trim().slice(0, max) : null))
const when = z
  .string()
  .nullish()
  .transform((v) =>
    v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null
  )

const messageRecord = z.object({
  type: z.literal('campaign-message'),
  id,
  attributes: z.object({
    definition: z.object({
      name: text(200),
      status: z.string().nullish(),
      send_options: z
        .object({ send_time: when, send_strategy: z.string().nullish() })
        .nullish()
    }),
    created: z.string().nullish()
  }),
  relationships: z
    .object({
      campaign: z.object({ data: z.object({ id }).nullish() }).nullish(),
      'campaign-variations': z
        .object({ data: z.array(z.object({ id: z.string() })).nullish() })
        .nullish()
    })
    .nullish()
})
const campaignRecord = z.object({
  type: z.literal('campaign'),
  id,
  attributes: z.object({
    definition: z.object({
      name: text(200),
      archived: z.boolean().nullish(),
      send_settings: z.object({ send_strategy: z.string().nullish() }).nullish()
    })
  }),
  relationships: z
    .object({
      'campaign-audiences': z
        .object({ data: z.array(z.object({ id: z.string() })).nullish() })
        .nullish()
    })
    .nullish()
})
const variationRecord = z.object({
  type: z.literal('campaign-variation'),
  id: z.string(),
  attributes: z.object({
    definition: z.object({
      details: z
        .object({
          channel: z.string().nullish(),
          subject: text(300),
          preview_text: text(300)
        })
        .passthrough()
        .nullish()
    })
  })
})
const audienceRecord = z.object({
  type: z.literal('campaign-audience'),
  id: z.string(),
  attributes: z.object({
    definition: z.object({
      included: z.array(z.string()).nullish(),
      excluded: z.array(z.string()).nullish()
    })
  })
})

const localStrategies = new Set([
  'local_timezone',
  'content_variation_local_timezone',
  'timezone'
])
const optimizedStrategies = new Set([
  'send_time_optimization',
  'personalized_send_time_optimization',
  'ab_send_time_test'
])
function strategyOf(
  message: string | null | undefined,
  campaign: string | null | undefined
) {
  const s = (message ?? campaign ?? '').toLowerCase()
  if (optimizedStrategies.has(s)) return 'optimized' as const
  if (localStrategies.has(s) || (campaign ?? '').toLowerCase() === 'timezone')
    return 'local' as const
  return 'static' as const
}

type Details = z.infer<
  typeof variationRecord
>['attributes']['definition']['details']
const contentOf = (details: Details | undefined) => ({
  channel: details?.channel?.trim().toLowerCase() || null,
  subject: details?.subject ?? null,
  preview: details?.preview_text ?? null
})

/** Campaign messages of one status, each with its campaign and first variation. */
export function readCampaignMessages(
  client: KlaviyoClient,
  status: 'sent' | 'scheduled',
  since: Date | null,
  more: MorePages
): Promise<PagedRead<CampaignMessage>> {
  return readPages(
    client,
    messagesPath(status, since),
    'campaigns:read',
    maxMessagePages,
    more,
    (body) => {
      let skipped = 0
      const campaigns = new Map<
        string,
        { name: string | null; archived: boolean; strategy: string | null }
      >()
      const variations = new Map<string, z.infer<typeof variationRecord>>()
      for (const raw of body.included ?? []) {
        const c = campaignRecord.safeParse(raw)
        if (c.success) {
          campaigns.set(c.data.id, {
            name: c.data.attributes.definition.name,
            archived: c.data.attributes.definition.archived === true,
            strategy:
              c.data.attributes.definition.send_settings?.send_strategy ?? null
          })
          continue
        }
        const v = variationRecord.safeParse(raw)
        if (v.success) variations.set(v.data.id, v.data)
      }
      const records: CampaignMessage[] = []
      for (const raw of body.data) {
        const m = messageRecord.safeParse(raw)
        if (!m.success) {
          skipped++
          continue
        }
        const d = m.data.attributes.definition
        const campaignId = m.data.relationships?.campaign?.data?.id ?? null
        const campaign = campaignId ? campaigns.get(campaignId) : undefined
        const ids = m.data.relationships?.['campaign-variations']?.data ?? []
        const variation = ids.map((r) => variations.get(r.id)).find(Boolean)
        records.push({
          id: m.data.id,
          campaignId,
          campaignName: campaign?.name ?? null,
          archived: campaign?.archived ?? false,
          name: d.name,
          status,
          sendAt: d.send_options?.send_time ?? null,
          strategy: strategyOf(
            d.send_options?.send_strategy,
            campaign?.strategy
          ),
          ...contentOf(variation?.attributes.definition.details),
          contentKnown: !!variation,
          abTest: ids.length > 1
        })
      }
      return { records, skipped }
    }
  )
}

/**
 * The content of one message (its first variation's subject, preview and
 * channel), for a message whose variations did not come with the list.
 */
export async function readMessageContent(
  client: KlaviyoClient,
  messageId: string
) {
  const body = z
    .object({ data: z.array(z.unknown()) })
    .safeParse(await client.get(variationsPath(messageId), 'campaigns:read'))
  if (!body.success)
    throw new KlaviyoError('invalid_response', {
      endpoint: '/api/campaign-messages/'
    })
  const variations = body.data.data.flatMap((raw) => {
    const v = variationRecord.safeParse(raw)
    return v.success ? [v.data] : []
  })
  return {
    ...contentOf(variations[0]?.attributes.definition.details),
    abTest: variations.length > 1,
    found: variations.length > 0
  }
}

/** The audiences (lists and segments, by id) of campaigns, 100 at a time. */
export async function readCampaignAudiences(
  client: KlaviyoClient,
  campaignIds: string[],
  more: MorePages
): Promise<PagedRead<CampaignAudience>> {
  const records: CampaignAudience[] = []
  let skipped = 0
  for (let start = 0; start < campaignIds.length; start += 100) {
    if (start > 0 && !more()) return { records, complete: false, skipped }
    const read = await readPages(
      client,
      campaignAudiencesPath(campaignIds.slice(start, start + 100)),
      'campaigns:read',
      1,
      more,
      (body) => {
        const audiences = new Map<string, z.infer<typeof audienceRecord>>()
        for (const raw of body.included ?? []) {
          const a = audienceRecord.safeParse(raw)
          if (a.success) audiences.set(a.data.id, a.data)
        }
        let bad = 0
        const found: CampaignAudience[] = []
        for (const raw of body.data) {
          const c = campaignRecord.safeParse(raw)
          if (!c.success) {
            bad++
            continue
          }
          const own = (c.data.relationships?.['campaign-audiences']?.data ?? [])
            .map((r) => audiences.get(r.id)?.attributes.definition)
            .filter((a) => !!a)
          found.push({
            campaignId: c.data.id,
            included: [
              ...new Set(own.flatMap((a) => a!.included ?? []))
            ].filter((x) => kidPattern.test(x)),
            excluded: [
              ...new Set(own.flatMap((a) => a!.excluded ?? []))
            ].filter((x) => kidPattern.test(x))
          })
        }
        return { records: found, skipped: bad }
      }
    )
    records.push(...read.records)
    skipped += read.skipped
    if (!read.complete) return { records, complete: false, skipped }
  }
  return { records, complete: true, skipped }
}

const reportAnswer = z.object({
  data: z.object({
    attributes: z.object({
      results: z.array(
        z.object({
          groupings: z.record(z.string(), z.unknown()),
          statistics: z.record(z.string(), z.unknown())
        })
      )
    })
  }),
  links: z.object({ next: z.string().nullish() }).partial().nullish()
})

function reportRows(body: unknown, endpoint: string): ReportRead {
  const parsed = reportAnswer.safeParse(body)
  if (!parsed.success) throw new KlaviyoError('invalid_response', { endpoint })
  return {
    rows: parsed.data.data.attributes.results.map((r) => ({
      groupings: Object.fromEntries(
        Object.entries(r.groupings).flatMap(([k, v]) =>
          typeof v === 'string' && v.length <= 200 ? [[k, v]] : []
        )
      ),
      statistics: Object.fromEntries(
        Object.entries(r.statistics).flatMap(([k, v]) =>
          typeof v === 'number' && Number.isFinite(v) && v >= 0 ? [[k, v]] : []
        )
      )
    })),
    // More than one page: not followed (a report allows 2 questions a minute).
    complete: !parsed.data.links?.next
  }
}

/** The email campaigns' results of the last year, per campaign message. */
export async function readCampaignReport(
  client: KlaviyoClient,
  conversionMetricId: string
): Promise<ReportRead> {
  return reportRows(
    await client.query(
      campaignReportPath,
      {
        data: {
          type: 'campaign-values-report',
          attributes: {
            statistics: campaignStatistics,
            timeframe: { key: 'last_365_days' },
            conversion_metric_id: conversionMetricId,
            group_by: ['campaign_id', 'campaign_message_id', 'send_channel'],
            filter: 'equals(send_channel,"email")'
          }
        }
      },
      'campaigns:read'
    ),
    campaignReportPath
  )
}

/** The flows' email results of the last 90 days, per flow message. */
export async function readFlowReport(
  client: KlaviyoClient,
  conversionMetricId: string
): Promise<ReportRead> {
  return reportRows(
    await client.query(
      flowReportPath,
      {
        data: {
          type: 'flow-values-report',
          attributes: {
            statistics: flowStatistics,
            timeframe: { key: 'last_90_days' },
            conversion_metric_id: conversionMetricId,
            group_by: ['flow_id', 'flow_message_id', 'send_channel'],
            filter: 'equals(send_channel,"email")'
          }
        }
      },
      'flows:read'
    ),
    flowReportPath
  )
}

const flowRecord = z.object({
  type: z.literal('flow'),
  id,
  attributes: z.object({
    name: z.string().nullish(),
    status: z.string().nullish(),
    trigger_type: z.string().nullish()
  })
})

export function readFlows(client: KlaviyoClient, more: MorePages) {
  return readPages(
    client,
    flowsPath,
    'flows:read',
    maxFlowPages,
    more,
    (body) => {
      let skipped = 0
      const records: Flow[] = body.data.flatMap((raw) => {
        const f = flowRecord.safeParse(raw)
        if (!f.success) {
          skipped++
          return []
        }
        return [
          {
            id: f.data.id,
            name:
              f.data.attributes.name?.trim().slice(0, 200) || 'Untitled flow',
            status: (f.data.attributes.status ?? 'unknown')
              .toLowerCase()
              .slice(0, 20),
            trigger: f.data.attributes.trigger_type?.slice(0, 40) ?? null
          }
        ]
      })
      return { records, skipped }
    }
  )
}

const groupRecord = (type: 'list' | 'segment') =>
  z.object({
    type: z.literal(type),
    id,
    attributes: z.object({
      name: z.string().trim().min(1).max(300),
      is_active: z.boolean().nullish(),
      is_starred: z.boolean().nullish()
    })
  })

/** The account's lists or segments. */
export function readAudiences(
  client: KlaviyoClient,
  kind: 'list' | 'segment',
  more: MorePages
) {
  const schema = groupRecord(kind)
  return readPages(
    client,
    kind === 'list' ? listsPath : segmentsPath,
    kind === 'list' ? 'lists:read' : 'segments:read',
    maxAudiencePages,
    more,
    (body) => {
      let skipped = 0
      const records: Audience[] = body.data.flatMap((raw) => {
        const g = schema.safeParse(raw)
        if (!g.success) {
          skipped++
          return []
        }
        return [
          {
            id: g.data.id,
            kind,
            name: g.data.attributes.name.slice(0, 200),
            active: g.data.attributes.is_active !== false,
            starred: g.data.attributes.is_starred === true
          }
        ]
      })
      return { records, skipped }
    }
  )
}
