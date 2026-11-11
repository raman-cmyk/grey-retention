// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { sampleAsk, type Ask, type AiRun } from '@/features/intelligence/passes'
import { klaviyoClient } from '@/lib/providers/klaviyo/client'
import { recorded } from '@/lib/providers/klaviyo/recorded'
import {
  recordedHistoryTransport,
  type HistoryFailure
} from '@/lib/providers/klaviyo/recorded-history'
import type { KlaviyoResponse } from '@/lib/providers/klaviyo/client'
import type { HistorySnapshot } from './facts'
import { planFromHistory } from './read'
import { historyRunMs, readBrandHistory } from './worker'

type Db = Parameters<typeof readBrandHistory>[0]
type Job = Parameters<typeof readBrandHistory>[1]
const job = {
  id: 'job-1',
  tenant_id: 'tenant-1',
  lease_token: 'lease-1',
  kind: 'brand.read_history',
  input: { mode: 'fixture' }
} as unknown as Job
const now = Date.parse('2026-11-11T12:00:00Z')

function database() {
  const calls: { name: string; args: Record<string, unknown> }[] = []
  const chain = {
    select: () => chain,
    eq: () => chain,
    single: async () => ({ data: { brand_name: 'Cedar Goods' }, error: null })
  }
  return {
    calls,
    db: {
      from: () => chain,
      rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args })
        return { data: {}, error: null }
      })
    } as unknown as Db
  }
}
type Stored = {
  snapshot: HistorySnapshot
  findings: {
    topic: string
    statement: string
    pass: string
    evidence: { ref: string }
    model: string | null
  }[]
  summary: Record<string, unknown>
  live: boolean
}
const storedOf = (calls: ReturnType<typeof database>['calls']) =>
  calls.find((c) => c.name === 'record_klaviyo_history')!
    .args as unknown as Stored

const read = async (
  options: {
    fail?: { on: HistoryFailure; with: KlaviyoResponse }
    live?: boolean
    ask?: Ask | null
    clock?: () => number
  } = {}
) => {
  const transport = recordedHistoryTransport({
    now: new Date(now),
    fail: options.fail
  })
  const { db, calls } = database()
  const run = await readBrandHistory(db, job, {
    client: klaviyoClient('pk_SAMPLE0123456789abcdefghij', {
      transport,
      maxWaits: 0
    }),
    live: options.live ?? false,
    ask: options.ask === undefined ? sampleAsk : options.ask,
    callMs: 10_000,
    now: options.clock ?? (() => now)
  })
  return { run, calls, transport, stored: storedOf(calls) }
}
const gemini =
  (content: unknown): Ask =>
  async () =>
    ({
      ok: true,
      content,
      provider: 'gemini',
      model: 'gemini-2.5-flash'
    }) as AiRun

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('readBrandHistory', () => {
  it('counts what the brand sent: results, emails a week, the usual hour, the scheduled days', async () => {
    const { stored, run, transport } = await read()
    const h = stored.snapshot
    expect(h).toMatchObject({
      currency: 'USD',
      // Klaviyo's US/Pacific, by its standard name.
      timezone: 'America/Los_Angeles',
      // 10 emails in the last 8 weeks; most at 11:00 in the store's time
      // (before the clocks went back).
      sendsPerWeek: 1.3,
      usualSendTime: '11:00',
      flowsRead: true
    })
    expect(h.sent).toHaveLength(10)
    expect(h.sent[1]).toMatchObject({
      id: 'MsgA02',
      subject: '20% off knitwear this weekend',
      recipients: 2380,
      orders: 31,
      revenue: 3120,
      revenuePerRecipient: 1.31,
      openRate: 0.4412
    })
    expect(h.scheduled.map((e) => [e.id, e.audienceIds, e.offer])).toEqual([
      ['MsgS01', ['SegEng90'], false],
      ['MsgS02', ['SegVIP'], true]
    ])
    expect(h.flows.map((f) => [f.name, f.revenue90d])).toEqual([
      ['Abandoned cart', 5350.5],
      ['Welcome series', 2700],
      ['Old winback (draft)', 0]
    ])
    expect(h.audiences[0]).toMatchObject({
      name: 'Engaged 90 days',
      starred: true
    })
    expect(stored.summary).toEqual({
      state: 'ready',
      complete: true,
      flowsRead: true
    })
    expect(run).toMatchObject({
      state: 'ready',
      sent: 10,
      scheduled: 2,
      analysis: 'done'
    })
    // Read-only: GETs and two report questions.
    expect(
      transport.calls
        .filter((c) => c.startsWith('POST'))
        .map((c) => c.split(' ')[1])
    ).toEqual(['/api/campaign-values-reports', '/api/flow-values-reports'])
  })

  it('writes what the history says for the Brand strategist, each citing Klaviyo', async () => {
    const { stored } = await read()
    expect(stored.findings).toEqual([
      expect.objectContaining({
        topic: 'performance',
        statement:
          'The brand sends about 1.3 emails a week, most often at 11:00.',
        evidence: { ref: 'klaviyo:campaigns' },
        pass: 'sample'
      }),
      expect.objectContaining({
        topic: 'performance',
        statement:
          'The email "20% off knitwear this weekend" earned the most per recipient in the last year.',
        evidence: { ref: 'klaviyo:campaign:MsgA02' }
      }),
      expect.objectContaining({
        topic: 'audience',
        statement:
          'Emails go to segments such as Engaged 90 days and VIP customers.',
        evidence: { ref: 'klaviyo:audiences' }
      })
    ])
  })

  it('gives "Plan next 15 days" what it takes', async () => {
    const { stored } = await read()
    const plan = planFromHistory(stored.snapshot, {
      start: '2026-11-12',
      days: 15
    })
    expect(plan).toMatchObject({
      sendsPerWeek: 2,
      sendTime: '11:00',
      existing: [
        { date: expect.any(String), audienceId: 'SegEng90', offer: false },
        { date: expect.any(String), audienceId: 'SegVIP', offer: true }
      ]
    })
    expect(plan.audiences.map((a) => a.label)).toEqual([
      'Engaged 90 days',
      'Do not email',
      'Newsletter',
      'VIP customers'
    ])
    expect(plan.results[0]).toEqual({
      title: 'New: the Field Overshirt in sand',
      sentOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      clicks: 120,
      revenue: 1420
    })
  })

  it('leaves the flows out when the key cannot read them, and goes on', async () => {
    const { stored, run } = await read({
      fail: { on: 'flows', with: recorded.noScope }
    })
    expect(stored.snapshot).toMatchObject({ flows: [], flowsRead: false })
    expect(stored.summary).toMatchObject({ flowsRead: false, complete: true })
    expect(run.flowsRead).toBe(false)
  })

  it('stops for Klaviyo to pause the job on a refused key, a missing campaigns scope or a rate limit, storing nothing', async () => {
    for (const [on, response, kind] of [
      ['sent', recorded.badKey, 'bad_key'],
      ['sent', recorded.noScope, 'missing_scope'],
      ['campaignReport', recorded.throttled(60), 'rate_limited']
    ] as const) {
      const transport = recordedHistoryTransport({
        now: new Date(now),
        fail: { on, with: response }
      })
      const { db, calls } = database()
      await expect(
        readBrandHistory(db, job, {
          client: klaviyoClient('pk_SAMPLE0123456789abcdefghij', {
            transport,
            maxWaits: 0
          }),
          live: false,
          ask: sampleAsk,
          callMs: 10_000,
          now: () => now
        })
      ).rejects.toMatchObject({ kind })
      expect(calls.map((c) => c.name)).not.toContain('record_klaviyo_history')
    }
  })

  it('tries again later, storing nothing, when nothing was read in time', async () => {
    let clock = now
    const answers = recordedHistoryTransport({ now: new Date(now) })
    const slow = (async (request) => {
      const answer = await answers(request)
      if (request.url.includes('/api/metrics'))
        clock = now + historyRunMs - 12_000
      return answer
    }) as typeof answers
    const { db, calls } = database()
    await expect(
      readBrandHistory(db, job, {
        client: klaviyoClient('pk_SAMPLE0123456789abcdefghij', {
          transport: slow,
          maxWaits: 0
        }),
        live: false,
        ask: sampleAsk,
        callMs: 10_000,
        now: () => clock
      })
    ).rejects.toMatchObject({ kind: 'unavailable' })
    expect(calls.map((c) => c.name)).not.toContain('record_klaviyo_history')
  })

  it('stores an account that never sent anything as empty, without findings', async () => {
    const nothing: KlaviyoResponse = {
      status: 200,
      headers: {},
      body: '{"data":[],"links":{"next":null}}'
    }
    const transport = recordedHistoryTransport({
      now: new Date(now),
      fail: { on: 'sent', with: nothing }
    })
    const both = (async (request) =>
      request.url.includes('status%2C%22scheduled') ||
      decodeURIComponent(request.url).includes('equals(status,"scheduled")')
        ? nothing
        : transport(request)) as typeof transport
    const { db, calls } = database()
    const run = await readBrandHistory(db, job, {
      client: klaviyoClient('pk_SAMPLE0123456789abcdefghij', {
        transport: both,
        maxWaits: 0
      }),
      live: false,
      ask: sampleAsk,
      callMs: 10_000,
      now: () => now
    })
    expect(run).toMatchObject({ state: 'empty', analysis: 'skipped' })
    expect(storedOf(calls)).toMatchObject({
      findings: [],
      summary: { state: 'empty', reason: 'no_emails' }
    })
  })

  it("takes a live model's checked words: cited emails it has, no numbers or claims", async () => {
    const { stored } = await read({
      live: true,
      ask: gemini({
        findings: [
          {
            topic: 'performance',
            statement: 'Percentage offers earn the most per recipient.',
            emailIds: ['MsgA02', 'MsgA09'],
            confidence: 0.95
          },
          {
            topic: 'tone',
            statement: 'Subject lines are short and plain.',
            emailIds: [],
            confidence: 0.7
          },
          {
            topic: 'offering',
            statement: 'Emails promote twenty products.',
            emailIds: ['Nope'],
            confidence: 0.7
          },
          {
            topic: 'performance',
            statement: 'Offers earn 3 times more.',
            emailIds: [],
            confidence: 0.7
          },
          {
            topic: 'audience',
            statement: 'The best brand in the world writes to everyone.',
            emailIds: [],
            confidence: 0.7
          }
        ]
      })
    })
    const words = stored.findings.filter((f) => f.pass === 'model')
    expect(words.map((f) => [f.topic, f.evidence.ref])).toEqual([
      ['performance', 'klaviyo:campaign:MsgA02'],
      ['tone', 'klaviyo:campaigns']
    ])
    expect(words[0]!.model).toBe('gemini-2.5-flash')
    // The counted facts are code on a live account.
    expect(stored.findings.filter((f) => f.pass === 'code')).toHaveLength(2)
  })

  it('stores the history without words when the model fails or is not set up', async () => {
    for (const ask of [
      null,
      (async () => ({ ok: false, code: 'unavailable' })) as Ask
    ]) {
      const { stored, run } = await read({ live: true, ask })
      expect(run.analysis).toBe('skipped')
      expect(stored.findings.map((f) => f.pass)).toEqual(['code', 'code'])
    }
  })
})
