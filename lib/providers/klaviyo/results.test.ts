// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { findStoreMetrics } from './catalog'
import { KlaviyoError, klaviyoClient, type KlaviyoTransport } from './client'
import { readDraft } from './drafts'
import { fakeDraftAccount } from './recorded-drafts'
import {
  recordedResultsTransport,
  type RecordedVariation
} from './recorded-results'
import {
  maxLinkRows,
  readCampaignResults,
  readLinkClicks,
  resultStatistics
} from './results'

const key = 'pk_SAMPLE0123456789abcdefghij'
const client = (transport: KlaviyoTransport) =>
  klaviyoClient(key, { transport, maxWaits: 0 })
const window = {
  from: new Date('2026-11-01T00:00:00Z'),
  to: new Date('2026-11-05T00:00:00Z')
}
const failure = async (call: Promise<unknown>) => {
  try {
    await call
  } catch (error) {
    return error as KlaviyoError
  }
  throw new Error('expected a failure')
}
const variations: RecordedVariation[] = [
  {
    campaignId: 'CmpR01',
    messageId: 'MsgR01',
    variationId: 'VarA01',
    name: 'Design A',
    statistics: {
      recipients: 1200,
      delivered: 1188,
      opens_unique: 500,
      open_rate: 0.4209,
      clicks_unique: 31,
      click_rate: 0.0261,
      conversions: 4,
      conversion_uniques: 4,
      conversion_value: 212.5,
      revenue_per_recipient: 0.1771,
      unsubscribe_uniques: 2,
      unsubscribe_rate: 0.0017,
      spam_complaints: 0,
      bounced: 12
    }
  },
  {
    campaignId: 'CmpR01',
    messageId: 'MsgR01',
    variationId: 'VarB01',
    name: 'Design B',
    statistics: { recipients: 1190, open_rate: 0.39 }
  },
  {
    campaignId: 'CmpOther',
    messageId: 'MsgOther',
    variationId: 'VarX',
    name: 'Someone else',
    statistics: { recipients: 9 }
  }
]

describe('the campaign report per variation, against recorded answers', () => {
  it('asks once for every campaign, per variation, in the spec’s shape', async () => {
    const asked: { path: string; body: unknown }[] = []
    const read = await readCampaignResults(
      client(recordedResultsTransport({ variations, asked })),
      'PlcdOr',
      ['CmpR01'],
      window
    )
    expect(read.complete).toBe(true)
    expect(read.rows).toEqual([
      {
        campaignId: 'CmpR01',
        messageId: 'MsgR01',
        variationId: 'VarA01',
        variationName: 'Design A',
        statistics: variations[0]!.statistics
      },
      {
        campaignId: 'CmpR01',
        messageId: 'MsgR01',
        variationId: 'VarB01',
        variationName: 'Design B',
        statistics: { recipients: 1190, open_rate: 0.39 }
      }
    ])
    expect(asked[0]).toEqual({
      path: '/api/campaign-values-reports',
      body: {
        data: {
          type: 'campaign-values-report',
          attributes: {
            statistics: [...resultStatistics],
            timeframe: {
              start: '2026-11-01T00:00:00+00:00',
              end: '2026-11-05T00:00:00+00:00'
            },
            conversion_metric_id: 'PlcdOr',
            group_by: [
              'campaign_id',
              'campaign_message_id',
              'variation',
              'variation_name'
            ],
            filter:
              'and(contains-any(campaign_id,["CmpR01"]),equals(send_channel,"email"))'
          }
        }
      }
    })
  })

  it('leaves out rows of other campaigns and counts it never asked for', async () => {
    const transport: KlaviyoTransport = async () => ({
      status: 200,
      headers: {},
      body: JSON.stringify({
        data: {
          attributes: {
            results: [
              {
                groupings: {
                  campaign_id: 'CmpOther',
                  campaign_message_id: 'M1'
                },
                statistics: { recipients: 5 }
              },
              {
                groupings: { campaign_id: 'CmpR01' },
                statistics: { recipients: 5 }
              },
              {
                groupings: {
                  campaign_id: 'CmpR01',
                  campaign_message_id: 'MsgR01',
                  variation: 'bad/id'
                },
                statistics: { recipients: 7, made_up: 3, open_rate: -1 }
              }
            ]
          }
        },
        links: { next: 'https://a.klaviyo.com/api/campaign-values-reports?x' }
      })
    })
    const read = await readCampaignResults(
      client(transport),
      'PlcdOr',
      ['CmpR01'],
      window
    )
    expect(read).toEqual({
      rows: [
        {
          campaignId: 'CmpR01',
          messageId: 'MsgR01',
          variationId: null,
          variationName: null,
          statistics: { recipients: 7 }
        }
      ],
      // More than one page: said, never followed.
      complete: false
    })
  })

  it('never asks with ids that are not ids, too many campaigns or no window', async () => {
    const transport = vi.fn(recordedResultsTransport({ variations }))
    const c = client(transport)
    for (const call of [
      readCampaignResults(c, 'PlcdOr', [], window),
      readCampaignResults(c, 'PlcdOr', ['a"]),x'], window),
      readCampaignResults(
        c,
        'PlcdOr',
        Array.from({ length: 101 }, (_, i) => `C${i}`),
        window
      ),
      readCampaignResults(c, 'bad id', ['CmpR01'], window),
      readCampaignResults(c, 'PlcdOr', ['CmpR01'], {
        from: window.to,
        to: window.from
      })
    ])
      expect((await failure(call)).kind).toBe('invalid_response')
    expect(transport).not.toHaveBeenCalled()
  })

  it('says an answer of another shape is not one, and passes Klaviyo’s refusals on', async () => {
    const odd: KlaviyoTransport = async () => ({
      status: 200,
      headers: {},
      body: JSON.stringify({ data: { attributes: { rows: [] } } })
    })
    expect(
      (
        await failure(
          readCampaignResults(client(odd), 'PlcdOr', ['C1'], window)
        )
      ).kind
    ).toBe('invalid_response')
    const busy: KlaviyoTransport = async () => ({
      status: 429,
      headers: { 'retry-after': '40' },
      body: '{"errors":[{"code":"throttled"}]}'
    })
    expect(
      await failure(readCampaignResults(client(busy), 'PlcdOr', ['C1'], window))
    ).toMatchObject({
      kind: 'rate_limited',
      details: { retryAfterSeconds: 40 }
    })
  })
})

describe('the link clicks of one email, against recorded answers', () => {
  const clicks = [
    {
      messageId: 'MsgR01',
      variationId: 'VarA01',
      url: 'https://cedar.example/products/knit?utm_source=klaviyo',
      count: [20, 8, 3],
      unique: [17, 7, 3]
    },
    {
      messageId: 'MsgR01',
      variationId: 'VarB01',
      url: 'https://cedar.example/',
      count: [4, null as unknown as number],
      unique: [4, 0]
    },
    {
      messageId: 'MsgOther',
      variationId: 'VarX',
      url: 'https://cedar.example/x',
      count: [9],
      unique: [9]
    }
  ]

  it('counts each variation’s clicks per address, the days added up', async () => {
    const asked: { path: string; body: unknown }[] = []
    const read = await readLinkClicks(
      client(recordedResultsTransport({ clicks, asked })),
      'ClkEml',
      'MsgR01',
      window
    )
    expect(read).toEqual({
      rows: [
        {
          variationId: 'VarA01',
          url: 'https://cedar.example/products/knit?utm_source=klaviyo',
          clicks: 31,
          unique: 27
        },
        {
          variationId: 'VarB01',
          url: 'https://cedar.example/',
          clicks: 4,
          unique: 4
        }
      ],
      complete: true,
      bots: 0
    })
    expect(asked[0]).toEqual({
      path: '/api/metric-aggregates',
      body: {
        data: {
          type: 'metric-aggregate',
          attributes: {
            metric_id: 'ClkEml',
            measurements: ['count', 'unique'],
            interval: 'day',
            by: ['$variation', 'URL', 'Bot Click'],
            filter: [
              'greater-or-equal(datetime,2026-11-01T00:00:00)',
              'less-than(datetime,2026-11-05T00:00:00)',
              'equals($message,"MsgR01")'
            ],
            timezone: 'UTC',
            page_size: 500
          }
        }
      }
    })
  })

  it('keeps at most 200 addresses, leaves out a too long one, and says when it was not all', async () => {
    const many = Array.from({ length: maxLinkRows + 5 }, (_, i) => ({
      messageId: 'MsgR01',
      variationId: 'VarA01',
      url:
        i === 0
          ? `https://cedar.example/${'x'.repeat(2_001)}`
          : `https://cedar.example/p${i}`,
      count: [1],
      unique: [1]
    }))
    const read = await readLinkClicks(
      client(recordedResultsTransport({ clicks: many })),
      'ClkEml',
      'MsgR01',
      window
    )
    expect(read.rows).toHaveLength(maxLinkRows)
    expect(read.rows.some((r) => r.url.length > 2_000)).toBe(false)
    expect(read.complete).toBe(false)
  })

  it('leaves out and counts the clicks Klaviyo says were a bot’s, and takes ids as PSH-001 stores them', async () => {
    const read = await readLinkClicks(
      client(
        recordedResultsTransport({
          clicks: [
            { ...clicks[0]!, messageId: 'Msg_R-01' },
            { ...clicks[1]!, messageId: 'Msg_R-01', bot: true }
          ]
        })
      ),
      'ClkEml',
      'Msg_R-01',
      window
    )
    expect(read.rows.map((r) => r.url)).toEqual([clicks[0]!.url])
    expect(read.bots).toBe(4)
  })

  it('never asks for an id that is not one', async () => {
    const transport = vi.fn(recordedResultsTransport({ clicks }))
    for (const call of [
      readLinkClicks(client(transport), 'ClkEml', 'a")', window),
      readLinkClicks(client(transport), 'x y', 'MsgR01', window)
    ])
      expect((await failure(call)).kind).toBe('invalid_response')
    expect(transport).not.toHaveBeenCalled()
  })
})

describe('the reads LRN-001 shares', () => {
  it('finds the account’s Clicked Email metric next to Placed Order', async () => {
    expect(
      await findStoreMetrics(client(recordedResultsTransport({})), () => true)
    ).toMatchObject({ placedOrder: 'PlcdOr', clickedEmail: 'ClkEml' })
  })

  it('takes Klaviyo’s own Clicked Email, never one another integration sends', async () => {
    const metrics =
      (list: unknown[]): KlaviyoTransport =>
      async () => ({
        status: 200,
        headers: {},
        body: JSON.stringify({ data: list, links: { next: null } })
      })
    const other = {
      type: 'metric',
      id: 'OthClk',
      attributes: { name: 'Clicked Email', integration: { name: 'Zapier' } }
    }
    const own = {
      type: 'metric',
      id: 'ClkEml',
      attributes: { name: 'Clicked Email', integration: { name: 'Klaviyo' } }
    }
    expect(
      (await findStoreMetrics(client(metrics([other, own])), () => true))
        .clickedEmail
    ).toBe('ClkEml')
    expect(
      (await findStoreMetrics(client(metrics([other])), () => true))
        .clickedEmail
    ).toBeNull()
  })

  it('reads a draft’s send time once Klaviyo has one', async () => {
    const account = fakeDraftAccount({ audiences: ['LstAll'] })
    const c = client(account.transport)
    account.campaigns.set('CmpR01', {
      name: 'N',
      description: 'GROS draft k',
      createdAt: '2026-11-01T00:00:00Z',
      included: ['LstAll'],
      audienceRef: 'LstAll',
      messageIds: ['MsgR01']
    })
    account.variations.set('VarA01', {
      messageId: 'MsgR01',
      name: 'Design A',
      subject: 'S',
      preview: 'P',
      templateId: 'T1'
    })
    account.messages.set('MsgR01', {
      campaignId: 'CmpR01',
      name: 'N',
      status: 'Draft',
      winnerPercentage: null,
      variationIds: ['VarA01']
    })
    expect(await readDraft(c, 'MsgR01')).toMatchObject({
      status: 'draft',
      sendTime: null
    })
    account.messages.get('MsgR01')!.status = 'Sent'
    account.messages.get('MsgR01')!.sendTime = '2026-11-02T18:00:00+00:00'
    expect(await readDraft(c, 'MsgR01')).toMatchObject({
      status: 'sent',
      sendTime: '2026-11-02T18:00:00.000Z'
    })
    account.messages.get('MsgR01')!.sendTime = 'soon'
    expect((await readDraft(c, 'MsgR01'))!.sendTime).toBeNull()
    // Fields read only as hints never make the answer unreadable, whatever
    // their shape.
    for (const extra of [
      { send_options: { send_times: [] }, tracking_options: [] },
      {
        send_options: {
          send_times: [{ datetime: '2026-11-02T17:00:00Z', is_local: true }],
          send_strategy: 'Static!'
        },
        tracking_options: {
          tracking_params: [{ name: 'ref' }, 7, { name: '' }]
        }
      },
      { send_options: 'later', tracking_options: null }
    ]) {
      const raw = account.transport
      const read = await readDraft(
        client(async (request) => {
          const answer = await raw(request)
          const body = JSON.parse(answer.body)
          Object.assign(body.data.attributes.definition, extra)
          return { ...answer, body: JSON.stringify(body) }
        }),
        'MsgR01'
      )
      expect(read).not.toBeNull()
    }
    const listed = await readDraft(
      client(async (request) => {
        const answer = await account.transport(request)
        const body = JSON.parse(answer.body)
        body.data.attributes.definition.send_options = {
          send_times: [
            { datetime: '2026-11-02T17:00:00Z' },
            { datetime: '2026-11-02T16:00:00Z' }
          ]
        }
        body.data.attributes.definition.tracking_options = {
          tracking_params: [{ type: 'static', name: 'ref', value: 'nl' }]
        }
        return { ...answer, body: JSON.stringify(body) }
      }),
      'MsgR01'
    )
    expect(listed).toMatchObject({
      firstSendTime: '2026-11-02T16:00:00.000Z',
      trackingParams: ['ref']
    })
  })

  it('posts only Klaviyo’s report questions, never anything else', async () => {
    const transport = vi.fn(recordedResultsTransport({}))
    const c = client(transport)
    for (const path of [
      '/api/campaigns',
      '/api/metric-aggregates/../profiles',
      'https://evil.example/api/metric-aggregates'
    ])
      expect(await failure(c.query(path, {}, 'metrics:read'))).toBeInstanceOf(
        KlaviyoError
      )
    expect(transport).not.toHaveBeenCalled()
  })
})
