// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { KlaviyoError, klaviyoClient, type KlaviyoTransport } from './client'
import {
  campaignAudiencesPath,
  campaignReportPath,
  messagesPath,
  readAudiences,
  readCampaignAudiences,
  readCampaignMessages,
  readCampaignReport,
  readFlowReport,
  readFlows,
  readMessageContent,
  variationsPath
} from './history'
import { recorded } from './recorded'
import { recordedHistoryTransport } from './recorded-history'

const key = 'pk_SAMPLE0123456789abcdefghij'
const now = new Date('2026-11-11T12:00:00Z')
const always = () => true
const lastYear = new Date(now.getTime() - 365 * 86_400_000)
const client = (transport: KlaviyoTransport) =>
  klaviyoClient(key, { transport, maxWaits: 0 })
const failure = async (call: Promise<unknown>) => {
  try {
    await call
  } catch (error) {
    return error as KlaviyoError
  }
  throw new Error('expected a failure')
}

describe('the history reads, against recorded Klaviyo answers', () => {
  it('reads the sent emails with their campaign and subject, from the last year', async () => {
    const transport = recordedHistoryTransport({ now })
    const since = new Date(now.getTime() - 365 * 86_400_000)
    const read = await readCampaignMessages(
      client(transport),
      'sent',
      since,
      always
    )
    expect(read).toMatchObject({ complete: true, skipped: 0 })
    expect(read.records).toHaveLength(10)
    expect(read.records[1]).toEqual({
      id: 'MsgA02',
      campaignId: 'CmpA02',
      campaignName: '20% off knitwear this weekend',
      archived: false,
      name: '20% off knitwear this weekend (email)',
      status: 'sent',
      sendAt: expect.stringMatching(/T18:00:00\.000Z$/),
      strategy: 'static',
      channel: 'email',
      subject: '20% off knitwear this weekend',
      preview: 'Use code KNIT20 at checkout.',
      contentKnown: true,
      abTest: false
    })
    expect(transport.calls).toEqual([
      'GET /api/campaign-messages?fields[campaign-message]=definition.name,definition.status,definition.send_options.send_time,definition.send_options.send_strategy,created&fields[campaign]=definition.name,definition.archived,definition.send_settings.send_strategy&filter=equals(status,"sent"),greater-than(created,2025-11-11T12:00:00Z)&include=campaign,campaign-variations&page[size]=100&sort=-created'
    ])
  })

  it('keeps archived campaigns, and tells how each email was timed and tested', async () => {
    const read = await readCampaignMessages(
      client(recordedHistoryTransport({ now })),
      'sent',
      lastYear,
      always
    )
    const byId = new Map(read.records.map((m) => [m.id, m]))
    expect(byId.get('MsgA03')).toMatchObject({ archived: true })
    expect(byId.get('MsgA05')).toMatchObject({
      strategy: 'local',
      sendAt: expect.stringMatching(/T11:00:00\.000Z$/)
    })
    expect(byId.get('MsgA07')).toMatchObject({ strategy: 'optimized' })
    // An A/B test: two variations, the first one's subject.
    expect(byId.get('MsgA09')).toMatchObject({
      abTest: true,
      subject: 'Last chance: 15% off overshirts'
    })
  })

  it('asks for the variations one message at a time when the list leaves them out', async () => {
    const transport = recordedHistoryTransport({ now, variationsApart: true })
    const read = await readCampaignMessages(
      client(transport),
      'sent',
      lastYear,
      always
    )
    expect(read.records[0]).toMatchObject({
      id: 'MsgA01',
      contentKnown: false,
      subject: null,
      channel: null
    })
    expect(await readMessageContent(client(transport), 'MsgA09')).toEqual({
      channel: 'email',
      subject: 'Last chance: 15% off overshirts',
      preview: 'Ends at midnight.',
      abTest: true,
      found: true
    })
    expect(transport.calls.at(-1)).toBe(
      'GET /api/campaign-messages/MsgA09/campaign-variations?fields[campaign-variation]=definition.details'
    )
    expect(() => variationsPath('Msg/../x')).toThrow(KlaviyoError)
  })

  it('reads the scheduled emails and their audiences', async () => {
    const transport = recordedHistoryTransport({ now })
    const scheduled = await readCampaignMessages(
      client(transport),
      'scheduled',
      null,
      always
    )
    expect(scheduled.records.map((m) => [m.id, m.status])).toEqual([
      ['MsgS01', 'scheduled'],
      ['MsgS02', 'scheduled']
    ])
    const audiences = await readCampaignAudiences(
      client(transport),
      ['CmpS01', 'CmpS02'],
      always
    )
    expect(audiences.records).toEqual([
      { campaignId: 'CmpS01', included: ['SegEng90'], excluded: ['LstSuppr'] },
      { campaignId: 'CmpS02', included: ['SegVIP'], excluded: ['LstSuppr'] }
    ])
    expect(transport.calls[0]).toContain('filter=equals(status,"scheduled")')
    expect(transport.calls[1]).toContain('filter=any(id,["CmpS01","CmpS02"])')
  })

  it('asks the reports as a read-only question, and reads their rows', async () => {
    const requests: Parameters<KlaviyoTransport>[0][] = []
    const inner = recordedHistoryTransport({ now })
    const transport: KlaviyoTransport = async (request) => {
      requests.push(request)
      return inner(request)
    }
    const report = await readCampaignReport(client(transport), 'PlcdOr')
    expect(report.complete).toBe(true)
    expect(report.rows).toHaveLength(10)
    expect(report.rows[1]).toMatchObject({
      groupings: { campaign_message_id: 'MsgA02' },
      statistics: { recipients: 2380, conversion_value: 3120 }
    })
    expect(requests[0]).toMatchObject({
      method: 'POST',
      url: `https://a.klaviyo.com${campaignReportPath}`,
      headers: {
        'content-type': 'application/vnd.api+json',
        revision: '2026-10-15'
      }
    })
    expect(JSON.parse(requests[0]!.body!)).toEqual({
      data: {
        type: 'campaign-values-report',
        attributes: {
          statistics: expect.arrayContaining([
            'recipients',
            'conversion_value',
            'revenue_per_recipient'
          ]),
          timeframe: { key: 'last_365_days' },
          conversion_metric_id: 'PlcdOr',
          group_by: ['campaign_id', 'campaign_message_id', 'send_channel'],
          filter: 'equals(send_channel,"email")'
        }
      }
    })
    expect(
      (await readFlowReport(client(transport), 'PlcdOr')).rows.map(
        (r) => r.groupings.flow_id
      )
    ).toEqual(['FlwCart', 'FlwCart', 'FlwWel'])
    expect(JSON.parse(requests[1]!.body!).data.attributes).toMatchObject({
      statistics: ['recipients', 'conversions', 'conversion_value'],
      timeframe: { key: 'last_90_days' },
      group_by: ['flow_id', 'flow_message_id', 'send_channel']
    })
  })

  it('says a report is not whole when Klaviyo has another page', async () => {
    const transport = recordedHistoryTransport({ now, reportsCut: true })
    expect(await readCampaignReport(client(transport), 'PlcdOr')).toMatchObject(
      { complete: false, rows: expect.arrayContaining([expect.anything()]) }
    )
    expect((await readFlowReport(client(transport), 'PlcdOr')).complete).toBe(
      false
    )
  })

  it('asks a question only of the two reports, and only with one', async () => {
    const transport = recordedHistoryTransport({ now })
    for (const call of [
      client(transport).query('/api/campaigns', {}, 'campaigns:read'),
      client(transport).query(
        '/api/campaign-values-reports/../profiles',
        {},
        'campaigns:read'
      ),
      client(transport).query(campaignReportPath, null, 'campaigns:read')
    ])
      expect((await failure(call)).kind).toBe('rejected')
    expect(transport.calls).toEqual([])
  })

  it('reads the flows, lists and segments', async () => {
    const transport = recordedHistoryTransport({ now })
    expect(
      (await readFlows(client(transport), always)).records.map((f) => [
        f.id,
        f.status
      ])
    ).toEqual([
      ['FlwWel', 'live'],
      ['FlwCart', 'live'],
      ['FlwOld', 'draft']
    ])
    expect(
      (await readAudiences(client(transport), 'list', always)).records.map(
        (a) => a.name
      )
    ).toEqual(['Newsletter', 'Do not email'])
    expect(
      (await readAudiences(client(transport), 'segment', always)).records[0]
    ).toEqual({
      id: 'SegEng90',
      kind: 'segment',
      name: 'Engaged 90 days',
      active: true,
      starred: true
    })
  })

  it('names a missing Flows scope, so the flows can be left out', async () => {
    const transport = recordedHistoryTransport({
      now,
      fail: { on: 'flows', with: recorded.noScope }
    })
    const error = await failure(readFlows(client(transport), always))
    expect(error).toMatchObject({
      kind: 'missing_scope',
      details: { scope: 'flows:read' }
    })
  })

  it('calls a report of an unknown shape a change on their side', async () => {
    const transport = recordedHistoryTransport({
      now,
      fail: {
        on: 'campaignReport',
        with: { status: 200, headers: {}, body: '{"data":{}}' }
      }
    })
    expect(
      (await failure(readCampaignReport(client(transport), 'PlcdOr'))).kind
    ).toBe('invalid_response')
  })

  it('builds no address from an id that is not one', () => {
    expect(() => campaignAudiencesPath(['ok', 'x"]),equals(name,"y'])).toThrow(
      KlaviyoError
    )
    expect(() => campaignAudiencesPath([])).toThrow(KlaviyoError)
    expect(messagesPath('scheduled', null)).toContain(
      'filter=equals(status,"scheduled")&'
    )
  })
})
