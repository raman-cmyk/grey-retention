import type { KlaviyoResponse, KlaviyoTransport } from './client'
import {
  campaignReportPath,
  flowReportPath,
  flowsPath,
  listsPath,
  segmentsPath
} from './history'
import { recorded } from './recorded'
import { catalogRecordings } from './recorded-catalog'

/**
 * Recorded answers of what a made-up Klaviyo account sent (revision
 * 2026-10-15, ONB-103): campaign messages with their campaigns and
 * variations, the campaigns' audiences, the campaign and flow reports, the
 * flows, lists and segments. No real account, customer or result is in
 * here. Dates are relative to `now`.
 *
 * The store sends about twice a week at 10:00 (US/Pacific); the "20% off
 * knitwear" email earned the most per recipient; two emails are scheduled
 * for the coming week; a welcome series and an abandoned-cart flow run.
 */

const day = 86_400_000
const json = (status: number, body: unknown): KlaviyoResponse => ({
  status,
  headers: { 'content-type': 'application/vnd.api+json' },
  body: JSON.stringify(body)
})

type Email = {
  id: string
  subject: string
  preview: string
  /** Days ago (negative: scheduled ahead). */
  days: number
  /** Hour of the day, UTC (18:00 UTC is 10:00 in US/Pacific winter time). */
  hourUtc?: number
  recipients: number
  revenue: number
  orders: number
  opens: number
  clicks: number
}

const sentEmails: Email[] = [
  {
    id: 'MsgA01',
    subject: 'New: the Field Overshirt in sand',
    preview: 'Made for cool mornings.',
    days: 3,
    recipients: 2400,
    revenue: 1420,
    orders: 14,
    opens: 980,
    clicks: 120
  },
  {
    id: 'MsgA02',
    subject: '20% off knitwear this weekend',
    preview: 'Use code KNIT20 at checkout.',
    days: 6,
    recipients: 2380,
    revenue: 3120,
    orders: 31,
    opens: 1050,
    clicks: 210
  },
  {
    id: 'MsgA03',
    subject: 'How we make the Weekend Knit',
    preview: 'A visit to our mill.',
    days: 10,
    recipients: 2350,
    revenue: 610,
    orders: 6,
    opens: 990,
    clicks: 75
  },
  {
    id: 'MsgA04',
    subject: 'Back in stock: Canvas Tote',
    preview: 'It sold out in a week.',
    days: 13,
    recipients: 2330,
    revenue: 1180,
    orders: 12,
    opens: 940,
    clicks: 140
  },
  {
    id: 'MsgA05',
    subject: 'Our customers’ favourite layers',
    preview: 'Rated 4.8 by 300 buyers.',
    days: 17,
    recipients: 2300,
    revenue: 940,
    orders: 9,
    opens: 900,
    clicks: 98
  },
  {
    id: 'MsgA06',
    subject: 'Free shipping on orders over $75',
    preview: 'This week only.',
    days: 20,
    recipients: 2290,
    revenue: 1710,
    orders: 18,
    opens: 960,
    clicks: 170
  },
  {
    id: 'MsgA07',
    subject: 'Trail Socks are here',
    preview: 'Merino, made to last.',
    days: 24,
    recipients: 2250,
    revenue: 520,
    orders: 11,
    opens: 870,
    clicks: 90
  },
  {
    id: 'MsgA08',
    subject: 'A note from our founder',
    preview: 'Why we started Cedar Goods.',
    days: 31,
    hourUtc: 16,
    recipients: 2200,
    revenue: 380,
    orders: 4,
    opens: 1010,
    clicks: 60
  },
  {
    id: 'MsgA09',
    subject: 'Last chance: 15% off overshirts',
    preview: 'Ends at midnight.',
    days: 38,
    recipients: 2180,
    revenue: 2410,
    orders: 25,
    opens: 980,
    clicks: 190
  },
  {
    id: 'MsgA10',
    subject: 'Small test send',
    preview: 'Internal.',
    days: 45,
    recipients: 40,
    revenue: 300,
    orders: 2,
    opens: 30,
    clicks: 10
  }
]
const scheduledEmails: Email[] = [
  {
    id: 'MsgS01',
    subject: 'Winter layers are here',
    preview: 'Warm, light, made to last.',
    days: -2,
    recipients: 0,
    revenue: 0,
    orders: 0,
    opens: 0,
    clicks: 0
  },
  {
    id: 'MsgS02',
    subject: '25% off for our VIPs',
    preview: 'Use code VIP25.',
    days: -5,
    recipients: 0,
    revenue: 0,
    orders: 0,
    opens: 0,
    clicks: 0
  }
]

export function historyRecordings(options: { now?: Date } = {}) {
  const now = (options.now ?? new Date()).getTime()
  const at = (e: Email) =>
    new Date(
      Math.floor((now - e.days * day) / day) * day +
        (e.hourUtc ?? 18) * 3_600_000
    )
      .toISOString()
      .replace(/\.\d{3}Z$/, '+00:00')
  const campaignId = (e: Email) => e.id.replace('Msg', 'Cmp')
  const message = (e: Email, status: 'sent' | 'scheduled') => ({
    type: 'campaign-message',
    id: e.id,
    attributes: {
      created: new Date(now - (e.days + 3) * day)
        .toISOString()
        .replace(/\.\d{3}Z$/, '+00:00'),
      definition: {
        name: `${e.subject} (email)`,
        status,
        send_options: { send_time: at(e) }
      }
    },
    relationships: {
      campaign: { data: { type: 'campaign', id: campaignId(e) } },
      'campaign-variations': {
        data: [{ type: 'campaign-variation', id: `var-${e.id}` }]
      }
    }
  })
  const included = (emails: Email[]) =>
    emails.flatMap((e) => [
      {
        type: 'campaign',
        id: campaignId(e),
        attributes: { definition: { name: e.subject, archived: false } }
      },
      {
        type: 'campaign-variation',
        id: `var-${e.id}`,
        attributes: {
          created: '2026-01-01T00:00:00+00:00',
          updated: '2026-01-01T00:00:00+00:00',
          definition: {
            name: 'Main',
            details: {
              channel: 'email',
              subject: e.subject,
              preview_text: e.preview,
              from_label: 'Cedar Goods',
              from_email: 'hello@cedar.example'
            }
          }
        }
      }
    ])
  const page = (data: unknown[], extra: Record<string, unknown> = {}) =>
    json(200, {
      data,
      ...extra,
      links: { self: 'https://a.klaviyo.com/api/', next: null }
    })

  return {
    sent: page(
      sentEmails.map((e) => message(e, 'sent')),
      { included: included(sentEmails) }
    ),
    scheduled: page(
      scheduledEmails.map((e) => message(e, 'scheduled')),
      { included: included(scheduledEmails) }
    ),
    /** The scheduled campaigns' audiences. */
    campaignAudiences: page(
      scheduledEmails.map((e) => ({
        type: 'campaign',
        id: campaignId(e),
        attributes: { definition: { name: e.subject } },
        relationships: {
          'campaign-audiences': {
            data: [{ type: 'campaign-audience', id: `aud-${e.id}` }]
          }
        }
      })),
      {
        included: scheduledEmails.map((e) => ({
          type: 'campaign-audience',
          id: `aud-${e.id}`,
          attributes: {
            definition: {
              included: e.id === 'MsgS02' ? ['SegVIP'] : ['SegEng90'],
              excluded: ['LstSuppr']
            }
          }
        }))
      }
    ),
    campaignReport: json(200, {
      data: {
        type: 'campaign-values-report',
        attributes: {
          results: sentEmails.map((e) => ({
            groupings: {
              send_channel: 'email',
              campaign_id: campaignId(e),
              campaign_message_id: e.id
            },
            statistics: {
              recipients: e.recipients,
              opens_unique: e.opens,
              open_rate: e.opens / e.recipients,
              clicks_unique: e.clicks,
              click_rate: e.clicks / e.recipients,
              conversions: e.orders,
              conversion_value: e.revenue,
              revenue_per_recipient: e.revenue / e.recipients,
              unsubscribe_rate: 0.002
            }
          }))
        }
      },
      links: { self: 'https://a.klaviyo.com/api/campaign-values-reports/' }
    }),
    flows: page([
      {
        type: 'flow',
        id: 'FlwWel',
        attributes: {
          name: 'Welcome series',
          status: 'live',
          trigger_type: 'Added to List'
        }
      },
      {
        type: 'flow',
        id: 'FlwCart',
        attributes: {
          name: 'Abandoned cart',
          status: 'live',
          trigger_type: 'Metric'
        }
      },
      {
        type: 'flow',
        id: 'FlwOld',
        attributes: {
          name: 'Old winback (draft)',
          status: 'draft',
          trigger_type: 'Metric'
        }
      }
    ]),
    flowReport: json(200, {
      data: {
        type: 'flow-values-report',
        attributes: {
          results: [
            {
              groupings: {
                flow_id: 'FlwCart',
                flow_message_id: 'FmC1',
                send_channel: 'email'
              },
              statistics: {
                recipients: 600,
                conversions: 40,
                conversion_value: 4100,
                click_rate: 0.12
              }
            },
            {
              groupings: {
                flow_id: 'FlwCart',
                flow_message_id: 'FmC2',
                send_channel: 'email'
              },
              statistics: {
                recipients: 420,
                conversions: 12,
                conversion_value: 1250.5,
                click_rate: 0.08
              }
            },
            {
              groupings: {
                flow_id: 'FlwWel',
                flow_message_id: 'FmW1',
                send_channel: 'email'
              },
              statistics: {
                recipients: 900,
                conversions: 30,
                conversion_value: 2700,
                click_rate: 0.1
              }
            }
          ]
        }
      },
      links: { self: 'https://a.klaviyo.com/api/flow-values-reports/' }
    }),
    lists: page([
      { type: 'list', id: 'LstNews', attributes: { name: 'Newsletter' } },
      { type: 'list', id: 'LstSuppr', attributes: { name: 'Do not email' } }
    ]),
    segments: page([
      {
        type: 'segment',
        id: 'SegEng90',
        attributes: {
          name: 'Engaged 90 days',
          is_active: true,
          is_starred: true
        }
      },
      {
        type: 'segment',
        id: 'SegVIP',
        attributes: {
          name: 'VIP customers',
          is_active: true,
          is_starred: false
        }
      },
      {
        type: 'segment',
        id: 'SegOld',
        attributes: {
          name: 'Old test segment',
          is_active: false,
          is_starred: false
        }
      }
    ])
  }
}

const sentQuery =
  /^\/api\/campaign-messages\?fields\[campaign-message\]=definition\.name,definition\.status,definition\.send_options\.send_time,created&fields\[campaign\]=definition\.name,definition\.archived&filter=equals\(status,"sent"\),greater-than\(created,\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\)&include=campaign,campaign-variations&page\[size\]=100&sort=-created$/
const scheduledQuery =
  '/api/campaign-messages?fields[campaign-message]=definition.name,definition.status,definition.send_options.send_time,created&fields[campaign]=definition.name,definition.archived&filter=equals(status,"scheduled")&include=campaign,campaign-variations&page[size]=100&sort=-created'
const audiencesQuery =
  /^\/api\/campaigns\?fields\[campaign\]=definition\.name&fields\[campaign-audience\]=definition\.included,definition\.excluded&filter=any\(id,\[("[A-Za-z0-9]+",?)+\]\)&include=campaign-audiences&page\[size\]=100$/

export type HistoryFailure =
  | 'sent'
  | 'scheduled'
  | 'audiences'
  | 'campaignReport'
  | 'flows'
  | 'flowReport'
  | 'lists'
  | 'segments'

/**
 * A transport answering from the recordings, like Klaviyo: the account,
 * the metrics (ONB-102's recordings), and each history read only at its
 * exact address; reports only as a POST. `fail` answers one read with a
 * given response instead.
 */
export function recordedHistoryTransport(
  options: {
    now?: Date
    fail?: { on: HistoryFailure; with: KlaviyoResponse }
  } = {}
): KlaviyoTransport & { calls: string[] } {
  const calls: string[] = []
  const transport = (async (request) => {
    const r = historyRecordings({ now: options.now })
    const url = new URL(request.url)
    const path = decodeURIComponent(url.pathname + url.search)
    calls.push(`${request.method} ${path}`)
    const fail = (on: HistoryFailure) =>
      options.fail?.on === on ? options.fail.with : null
    const notFound = json(404, { errors: [{ status: 404, code: 'not_found' }] })
    if (request.method === 'POST') {
      if (path === campaignReportPath)
        return fail('campaignReport') ?? r.campaignReport
      if (path === flowReportPath) return fail('flowReport') ?? r.flowReport
      return notFound
    }
    if (path.startsWith('/api/accounts?')) return recorded.account
    if (path === '/api/metrics?fields[metric]=name,integration')
      return catalogRecordings({ now: options.now }).metrics
    if (sentQuery.test(path)) return fail('sent') ?? r.sent
    if (path === scheduledQuery) return fail('scheduled') ?? r.scheduled
    if (audiencesQuery.test(path))
      return fail('audiences') ?? r.campaignAudiences
    if (path === flowsPath) return fail('flows') ?? r.flows
    if (path === listsPath) return fail('lists') ?? r.lists
    if (path === segmentsPath) return fail('segments') ?? r.segments
    return notFound
  }) as KlaviyoTransport & { calls: string[] }
  transport.calls = calls
  return transport
}
