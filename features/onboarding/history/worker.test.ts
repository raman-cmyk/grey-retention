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
import { planFromHistory, unknownAudience } from './read'
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

function database(
  timezone: string | null = null,
  voice: {
    pushes?: string[]
    products?: string[]
    /** The samples an earlier read kept (`brand_voice_samples`). */
    kept?: Record<string, unknown>[]
    /** The campaigns GROS drafted cannot be read. */
    broken?: boolean
    /** Reading the products throws (a bug). */
    bug?: boolean
  } = {}
) {
  const calls: { name: string; args: Record<string, unknown> }[] = []
  const chain = (row: Record<string, unknown>) => {
    const c = {
      select: () => c,
      eq: () => c,
      single: async () => ({ data: row, error: null })
    }
    return c
  }
  // PIC-23 part 2b: the campaigns GROS drafted and the products' titles.
  const list = (
    rows: Record<string, unknown>[],
    error: { code: string } | null = null,
    bug = false
  ) => {
    const c = {
      select: () => c,
      eq: () => c,
      not: () => c,
      is: () => c,
      order: () => c,
      limit: () => c,
      then: (done: (r: { data: unknown; error: unknown }) => unknown) => {
        if (bug) throw new TypeError('a secret customer line')
        return done({ data: error ? null : rows, error })
      }
    }
    return c
  }
  return {
    calls,
    db: {
      from: (table: string) =>
        table === 'klaviyo_draft_pushes'
          ? list(
              (voice.pushes ?? []).map((campaign_id) => ({ campaign_id })),
              voice.broken ? { code: '42P01' } : null
            )
          : table === 'brand_voice_samples'
            ? list(voice.kept ?? [])
            : table === 'products'
              ? list(
                  (voice.products ?? ['Weekend Knit']).map((title) => ({
                    title
                  })),
                  null,
                  voice.bug
                )
              : chain(
                  table === 'tenants'
                    ? { timezone }
                    : { brand_name: 'Cedar Goods' }
                ),
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
    variationsApart?: boolean
    reportsCut?: boolean
    /** Answers some requests differently (null: as recorded). */
    instead?: (url: string) => KlaviyoResponse | null
    timezone?: string | null
    live?: boolean
    ask?: Ask | null
    clock?: () => number
    voice?: Parameters<typeof database>[1]
    templatesGone?: string[]
    noTemplateScope?: boolean
  } = {}
) => {
  const recordedAnswers = recordedHistoryTransport({
    now: new Date(now),
    fail: options.fail,
    variationsApart: options.variationsApart,
    reportsCut: options.reportsCut,
    templatesGone: options.templatesGone,
    noTemplateScope: options.noTemplateScope
  })
  const transport = (async (request) =>
    options.instead?.(decodeURIComponent(request.url)) ??
    recordedAnswers(request)) as typeof recordedAnswers
  transport.calls = recordedAnswers.calls
  const { db, calls } = database(options.timezone ?? null, options.voice)
  const waits: number[] = []
  const run = await readBrandHistory(db, job, {
    client: klaviyoClient('pk_SAMPLE0123456789abcdefghij', {
      transport,
      maxWaits: 0
    }),
    live: options.live ?? false,
    ask: options.ask === undefined ? sampleAsk : options.ask,
    callMs: 10_000,
    now: options.clock ?? (() => now),
    sleep: async (ms) => {
      waits.push(ms)
    }
  })
  return { run, calls, transport, waits, stored: storedOf(calls) }
}
const refused = (status: number): KlaviyoResponse => ({
  status,
  headers: { 'content-type': 'application/vnd.api+json' },
  body: JSON.stringify({ errors: [{ status, code: 'invalid' }] })
})
const allParts = {
  sent: true,
  scheduled: true,
  audiences: true,
  campaignReport: true,
  flows: true,
  flowReport: true,
  lists: true,
  segments: true
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
    const { stored, run, transport, waits } = await read()
    const h = stored.snapshot
    expect(h).toMatchObject({
      currency: 'USD',
      // The workspace has no timezone: Klaviyo's US/Pacific, by its
      // standard name.
      timezone: 'America/Los_Angeles',
      // 10 emails since the first, 45 days ago; most at 11:00 in the
      // store's time (before the clocks went back), one at each
      // recipient's 11:00, one at Klaviyo's times (not counted).
      sendsPerWeek: 1.6,
      usualSendTime: '11:00',
      flowsRead: true,
      window: { sentDays: 365, sentCap: 300, flowDays: 90 },
      parts: allParts
    })
    expect(h.sent).toHaveLength(10)
    // An archived campaign was still sent; an A/B test is marked.
    expect(h.sent.find((e) => e.id === 'MsgA03')).toBeDefined()
    expect(h.sent.find((e) => e.id === 'MsgA09')).toMatchObject({
      abTest: true
    })
    expect(h.sent.find((e) => e.id === 'MsgA07')).toMatchObject({
      strategy: 'optimized'
    })
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
    expect(h.flows.map((f) => [f.name, f.sends90d, f.revenue90d])).toEqual([
      ['Abandoned cart', 1020, 5350.5],
      ['Welcome series', 900, 2700],
      ['Old winback (draft)', 0, 0]
    ])
    expect(h.audiences.map((a) => [a.id, a.excludedOnly])).toEqual([
      ['SegEng90', false],
      ['LstSuppr', true],
      ['LstNews', false],
      ['SegVIP', false],
      ['SegOld', false]
    ])
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
    // The variations came with the list: none asked for apart.
    expect(
      transport.calls.some((c) => c.includes('/campaign-variations?'))
    ).toBe(false)
    // Klaviyo answers one report question a second.
    expect(waits).toEqual([1_100])
  })

  it("reads every day and hour in the workspace's timezone, when it has one", async () => {
    const { stored } = await read({ timezone: 'Europe/Berlin' })
    expect(stored.snapshot).toMatchObject({
      timezone: 'Europe/Berlin',
      // 18:00 UTC is 19:00 in Berlin since the clocks went back (25
      // October: four emails), 20:00 before (three).
      usualSendTime: '19:00'
    })
    expect(stored.snapshot.scheduled[0]!.date).toBe('2026-11-13')
  })

  it("asks for a message's variations apart when the list leaves them out", async () => {
    const { stored, transport } = await read({ variationsApart: true })
    expect(
      transport.calls.filter((c) => c.includes('/campaign-variations?'))
    ).toHaveLength(12)
    expect(stored.snapshot.sent[1]).toMatchObject({
      id: 'MsgA02',
      subject: '20% off knitwear this weekend'
    })
    expect(stored.snapshot.sent.find((e) => e.id === 'MsgA09')).toMatchObject({
      abTest: true
    })
    expect(stored.summary).toMatchObject({ complete: true })
  })

  it('calls the read incomplete when some content cannot be read', async () => {
    const { stored } = await read({
      variationsApart: true,
      fail: { on: 'variations', with: refused(404) }
    })
    expect(stored.summary).toMatchObject({ complete: false })
    // The report still counts them as emails, without a subject.
    expect(stored.snapshot.sent).toHaveLength(10)
    expect(stored.snapshot.sent[0]!.subject).toBeNull()
    // The scheduled ones still take their days.
    expect(stored.snapshot.scheduled.map((e) => e.id)).toEqual([
      'MsgS01',
      'MsgS02'
    ])
  })

  it('keeps the flows already read when their report is refused for access', async () => {
    const { stored } = await read({
      fail: { on: 'flowReport', with: recorded.noScope }
    })
    expect(stored.snapshot.flowsRead).toBe(true)
    expect(stored.snapshot.flows.map((f) => [f.name, f.revenue90d])).toEqual([
      ['Abandoned cart', null],
      ['Old winback (draft)', null],
      ['Welcome series', null]
    ])
  })

  it('stores an account with flows but nothing sent as empty, even when a detail is cut short', async () => {
    const nothing: KlaviyoResponse = {
      status: 200,
      headers: { 'content-type': 'application/vnd.api+json' },
      body: '{"data":[],"links":{"next":null}}'
    }
    const { run, stored } = await read({
      reportsCut: true,
      instead: (url) =>
        url.includes('/api/campaign-messages?') ? nothing : null
    })
    expect(run).toMatchObject({ state: 'empty', complete: false })
    expect(stored.summary).toMatchObject({
      state: 'empty',
      complete: false,
      reason: 'no_emails'
    })
    expect(stored.snapshot.flows).toHaveLength(3)
  })

  it('keeps the results Klaviyo gave when a report has another page, and says the read is not whole', async () => {
    const { stored } = await read({ reportsCut: true })
    expect(stored.snapshot.parts).toMatchObject({
      campaignReport: false,
      flowReport: false
    })
    expect(stored.snapshot.sent[1]!.revenue).toBe(3120)
    // Flow results not read whole are unknown, not added up.
    expect(stored.snapshot.flows.every((f) => f.sends90d === null)).toBe(true)
    expect(stored.summary).toMatchObject({ complete: false })
    // No "best email" from a part of the results.
    expect(stored.findings.map((f) => f.statement)).not.toContainEqual(
      expect.stringContaining('earned the most')
    )
  })

  it('asks no report without a Placed Order metric: the results are unknown, not nothing', async () => {
    const { stored, transport } = await read({
      instead: (url) =>
        url.includes('/api/metrics?')
          ? {
              status: 200,
              headers: { 'content-type': 'application/vnd.api+json' },
              body: JSON.stringify({
                data: [
                  {
                    type: 'metric',
                    id: 'OpnEml',
                    attributes: {
                      name: 'Opened Email',
                      integration: {
                        object: 'integration',
                        id: '0rG4eQ',
                        name: 'Klaviyo'
                      }
                    }
                  }
                ],
                links: { next: null }
              })
            }
          : null
    })
    expect(transport.calls.filter((c) => c.startsWith('POST'))).toEqual([])
    expect(stored.snapshot.sent.every((e) => e.revenue === null)).toBe(true)
    expect(
      stored.snapshot.flows.map((f) => [f.sends90d, f.revenue90d])
    ).toEqual([
      [null, null],
      [null, null],
      [null, null]
    ])
    expect(stored.findings.map((f) => f.statement)).not.toContainEqual(
      expect.stringContaining('earned the most')
    )
  })

  it('leaves out a refused campaign report, the flow report Klaviyo slows down, or the scheduled audiences, and goes on', async () => {
    const campaign = await read({
      fail: { on: 'campaignReport', with: refused(400) }
    })
    expect(campaign.stored.snapshot.sent[1]!.revenue).toBeNull()
    expect(campaign.stored.snapshot.flows[0]!.revenue90d).toBe(5350.5)

    const flows = await read({
      fail: { on: 'flowReport', with: recorded.throttled(60) }
    })
    expect(flows.stored.snapshot.flows[0]!.revenue90d).toBeNull()
    expect(flows.stored.summary).toMatchObject({ complete: false })

    const audiences = await read({
      fail: { on: 'audiences', with: refused(400) }
    })
    // The days still count as taken, to an audience not known.
    expect(
      audiences.stored.snapshot.scheduled.map((e) => e.audienceIds)
    ).toEqual([[], []])
    expect(audiences.stored.summary).toMatchObject({ complete: false })
  })

  it('writes what the history says for the Brand strategist, each citing Klaviyo', async () => {
    const { stored } = await read()
    expect(stored.findings).toEqual([
      expect.objectContaining({
        topic: 'performance',
        statement:
          'The brand sends about 1.6 emails a week, most often at 11:00.',
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
      // The two sent in the week before count against its first week.
      existing: [
        { date: '2026-11-05', audienceId: unknownAudience, offer: true },
        { date: '2026-11-08', audienceId: unknownAudience, offer: false },
        { date: '2026-11-13', audienceId: 'SegEng90', offer: false },
        { date: '2026-11-16', audienceId: 'SegVIP', offer: true }
      ]
    })
    // Never the suppression list, never an inactive segment.
    expect(plan.audiences.map((a) => a.label)).toEqual([
      'Engaged 90 days',
      'VIP customers',
      'Newsletter'
    ])
    expect(plan.results[0]).toEqual({
      title: 'New: the Field Overshirt in sand',
      sentOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      clicks: 120,
      revenue: 1420
    })
  })

  it('leaves the flows out when the key cannot read them, and goes on', async () => {
    const { stored, run, transport } = await read({
      fail: { on: 'flows', with: recorded.noScope }
    })
    expect(stored.snapshot).toMatchObject({ flows: [], flowsRead: false })
    expect(stored.summary).toMatchObject({ flowsRead: false, complete: true })
    expect(run.flowsRead).toBe(false)
    // No flow report asked.
    expect(
      transport.calls
        .filter((c) => c.startsWith('POST'))
        .map((c) => c.split(' ')[1])
    ).toEqual(['/api/campaign-values-reports'])
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

  it("keeps the owner's voice from the letter they sent, after the history's reads and before it is stored, never GROS's own drafts", async () => {
    const { calls, transport } = await read()
    const names = calls.map((c) => c.name)
    expect(names.indexOf('record_voice_samples')).toBeGreaterThanOrEqual(0)
    expect(names.indexOf('record_voice_samples')).toBeLessThan(
      names.indexOf('record_klaviyo_history')
    )
    // The templates are read last, after every other read of the history.
    const templates = transport.calls
      .map((c, i) => (c.includes('/api/templates/') ? i : -1))
      .filter((i) => i >= 0)
    expect(templates.length).toBeGreaterThan(0)
    expect(Math.min(...templates)).toBe(
      transport.calls.length - templates.length
    )
    const voice = calls.find((c) => c.name === 'record_voice_samples')!.args
    expect(voice).toMatchObject({ job: 'job-1', lease: 'lease-1' })
    const samples = voice.samples as {
      messageId: string
      text: string
      weight: number
      sentAt: string | null
    }[]
    // The founder's letter only: the designed emails say too little, and
    // the one with a customer's name and email says too little once they go.
    expect(samples.map((x) => x.messageId)).toEqual(['MsgA08'])
    expect(samples[0]!.weight).toBe(3)
    expect(samples[0]!.text.startsWith('Hi [first name],')).toBe(true)
    expect(samples[0]!.text).toContain('I started Cedar Goods in my garage')
    expect(samples[0]!.sentAt).toMatch(/^2026-/)
    expect(JSON.stringify(samples)).not.toMatch(/Jordan|someone@example/)

    // A campaign GROS drafted is never read: a whole read with none left
    // clears the samples.
    const ours = await read({ voice: { pushes: ['CmpA08'] } })
    expect(
      ours.transport.calls.some((c) => c.includes('/api/templates/TplMsgA08'))
    ).toBe(false)
    expect(
      ours.calls.find((c) => c.name === 'record_voice_samples')!.args.samples
    ).toEqual([])
  })

  it('keeps the earlier samples when it could not read the emails, and stores the history all the same', async () => {
    const voiceOf = (r: Awaited<ReturnType<typeof read>>) =>
      r.calls.map((c) => c.name).includes('record_voice_samples')
    // The key cannot read templates.
    const scope = await read({ noTemplateScope: true })
    expect(voiceOf(scope)).toBe(false)
    expect(scope.stored.summary.state).toBe('ready')
    // Klaviyo slows down: the voice stops at its first template.
    const slow = await read({
      fail: { on: 'templates', with: recorded.throttled(30) }
    })
    expect(voiceOf(slow)).toBe(false)
    expect(
      slow.transport.calls.filter((c) => c.includes('/api/templates/'))
    ).toHaveLength(1)
    expect(slow.stored.summary.state).toBe('ready')
    // A refused key on a template: the history read has its answer.
    const key = await read({ fail: { on: 'templates', with: recorded.badKey } })
    expect(voiceOf(key)).toBe(false)
    expect(key.stored.summary.state).toBe('ready')
    // No sent email's template is known (its content could not be read).
    const blind = await read({
      variationsApart: true,
      fail: { on: 'variations', with: refused(404) }
    })
    expect(voiceOf(blind)).toBe(false)
    expect(blind.stored.summary.state).toBe('ready')
    // Every template in a shape we do not read.
    const odd = await read({
      instead: (url) =>
        url.includes('/api/templates/')
          ? {
              status: 200,
              headers: { 'content-type': 'application/vnd.api+json' },
              body: JSON.stringify({ data: { type: 'something-else' } })
            }
          : null
    })
    expect(voiceOf(odd)).toBe(false)
    expect(odd.stored.summary.state).toBe('ready')
  })

  it('merges a read cut short with the samples kept before, the one found again winning', async () => {
    const before = (id: string, text: string) => ({
      message_id: id,
      text,
      weight: 2,
      words: 30,
      sent_at: '2026-06-01T10:00:00+00:00'
    })
    const words =
      'We knit every scarf slowly on old machines in the valley, and each one is checked twice by hand before it is folded, wrapped and sent to you.'
    const { calls } = await read({
      // One designed email refused: the read is not whole.
      instead: (url) =>
        url.includes('/api/templates/TplMsgA02') ? refused(422) : null,
      voice: {
        kept: [before('MsgOLD', words), before('MsgA08', `${words} Again.`)]
      }
    })
    const samples = calls.find((c) => c.name === 'record_voice_samples')!.args
      .samples as { messageId: string; weight: number; text: string }[]
    expect(samples.map((x) => x.messageId)).toEqual(['MsgA08', 'MsgOLD'])
    expect(samples[0]!.weight).toBe(3)
    expect(samples[0]!.text.startsWith('Hi [first name],')).toBe(true)
  })

  it('logs a database error in the voice by its code, and stores the history', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { calls, stored } = await read({ voice: { broken: true } })
    expect(calls.map((c) => c.name)).not.toContain('record_voice_samples')
    expect(stored.summary.state).toBe('ready')
    const logged = error.mock.calls.map((c) => String(c[0])).join('\n')
    expect(logged).toContain('42P01')
    expect(logged).toContain('the voice read left out')
  })

  it('reads no template when no time is left for the voice, and stops reading them when time runs out', async () => {
    let t = now
    const late = await read({
      clock: () => t,
      instead: (url) => {
        if (url.includes('/api/segments')) t = now + 12_000
        return null
      }
    })
    expect(
      late.transport.calls.some((c) => c.includes('/api/templates/'))
    ).toBe(false)
    expect(late.calls.map((c) => c.name)).not.toContain('record_voice_samples')
    expect(late.run.analysis).toBe('done')
    t = now
    const slow = await read({
      clock: () => t,
      instead: (url) => {
        if (url.includes('/api/templates/')) t += 5_000
        return null
      }
    })
    expect(
      slow.transport.calls.filter((c) => c.includes('/api/templates/')).length
    ).toBeLessThan(5)
    // The newest are designed emails: nothing found, the samples kept.
    expect(slow.calls.map((c) => c.name)).not.toContain('record_voice_samples')
    expect(slow.stored.summary.state).toBe('ready')
  })

  it('drops a sample read again that no longer says enough', async () => {
    const words =
      'We knit every scarf slowly on old machines in the valley, and each one is checked twice by hand before it is folded, wrapped and sent to you.'
    const { calls } = await read({
      instead: (url) =>
        url.includes('/api/templates/TplMsgA02') ? refused(422) : null,
      voice: {
        kept: [
          {
            message_id: 'MsgA05',
            text: words,
            weight: 1,
            words: 30,
            sent_at: '2026-06-01T10:00:00+00:00'
          }
        ]
      }
    })
    const samples = calls.find((c) => c.name === 'record_voice_samples')!.args
      .samples as { messageId: string }[]
    expect(samples.map((x) => x.messageId)).toEqual(['MsgA08'])
  })

  it('logs a bug in the voice by its class, never its message, and stores the history', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { stored } = await read({ voice: { bug: true } })
    expect(stored.summary.state).toBe('ready')
    const logged = error.mock.calls.map((c) => String(c[0])).join('\n')
    expect(logged).toContain('TypeError')
    expect(logged).not.toContain('a secret customer line')
  })
})
