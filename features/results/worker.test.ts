// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { fingerprints } from '@/features/klaviyo-push/pusher'
import {
  klaviyoClient,
  type KlaviyoTransport
} from '@/lib/providers/klaviyo/client'
import { fakeDraftAccount } from '@/lib/providers/klaviyo/recorded-drafts'
import {
  recordedResultsTransport,
  type RecordedClick,
  type RecordedVariation
} from '@/lib/providers/klaviyo/recorded-results'
import { dayMs, hourMs, type ResultPatch, type ResultRow } from './sync'
import { runEmailResults, type ResultsSource } from './worker'

type Db = Parameters<typeof runEmailResults>[0]
const key = 'pk_SAMPLE0123456789abcdefghij'
const now = Date.parse('2026-11-20T12:00:00Z')
const iso = (ms: number) => new Date(ms).toISOString()
const html =
  '<table><tr data-block="hero_product"><td><a href="https://cedar.example/p/1">A</a></td></tr>' +
  '<tr data-block="product_grid"><td><a href="https://cedar.example/p/2">B</a></td></tr></table>'

const row = (over: Partial<ResultRow> = {}): ResultRow => ({
  tenant_id: 't1',
  build_id: 'b1',
  run_id: 'r1',
  slot: 0,
  sample: false,
  campaign_id: 'CmpR01',
  message_id: 'MsgR01',
  planned: {
    date: '2026-11-18',
    time: '18:00',
    plannedSendAt: '2026-11-18T18:00:00.000Z'
  },
  status: 'draft',
  changed: false,
  sent_at: null,
  checked_at: null,
  next_check_at: iso(now),
  pulls: 0,
  results: [],
  clicks: [],
  results_at: null,
  complete: true,
  final: false,
  paused: null,
  lease_token: `lease-${over.build_id ?? 'b1'}`,
  lease_until: iso(now + 60_000),
  created_at: iso(now - dayMs),
  updated_at: iso(now - dayMs),
  ...over
})

/** A database with these claimed rows, their builds and pushes. */
function database(
  rows: ResultRow[],
  options: { written?: Record<string, string | null>; lost?: string[] } = {}
) {
  const saved: { build: string; lease: string; patch: ResultPatch }[] = []
  const query = (data: unknown[]) => {
    const q = {
      select: () => q,
      in: async () => ({ data, error: null })
    }
    return q
  }
  const db = {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === 'claim_klaviyo_results') return { data: rows, error: null }
      if (name === 'save_klaviyo_result') {
        if (options.lost?.includes(args.build as string))
          return { data: null, error: { code: 'PT409', message: 'lease' } }
        saved.push(args as (typeof saved)[number])
        return { data: null, error: null }
      }
      throw new Error(`unexpected rpc ${name}`)
    }),
    from: (table: string) =>
      query(
        table === 'email_builds'
          ? rows.map((r) => ({
              id: r.build_id,
              push_key: `push-${r.build_id}`,
              email: { html }
            }))
          : rows.map((r) => ({
              tenant_id: r.tenant_id,
              push_key: `push-${r.build_id}`,
              templates: [
                {
                  approach: 'A',
                  id: 'T1',
                  variation: 'VarA01',
                  deleted: false
                },
                { approach: 'B', id: 'T2', variation: 'VarB01', deleted: false }
              ],
              written:
                options.written && r.build_id in options.written
                  ? options.written[r.build_id]
                  : null
            }))
      )
  } as unknown as Db
  return { db, saved }
}

/** A live account with one A/B draft (CmpR01 / MsgR01). */
function account(status = 'Draft', sendTime: string | null = null) {
  const a = fakeDraftAccount({ audiences: ['LstAll'] })
  a.campaigns.set('CmpR01', {
    name: 'N',
    description: 'GROS draft k',
    createdAt: '2026-11-01T00:00:00Z',
    included: ['LstAll'],
    audienceRef: 'LstAll',
    messageIds: ['MsgR01']
  })
  for (const [id, name, templateId] of [
    ['VarA01', 'Design A', 'T1'],
    ['VarB01', 'Design B', 'T2']
  ] as const)
    a.variations.set(id, {
      messageId: 'MsgR01',
      name,
      subject: 'Weekend knit',
      preview: 'Soft and warm',
      templateId
    })
  a.messages.set('MsgR01', {
    campaignId: 'CmpR01',
    name: 'N',
    status,
    sendTime,
    winnerPercentage: 0,
    variationIds: ['VarA01', 'VarB01']
  })
  return a
}
const written = () =>
  fingerprints([
    { subject: 'Weekend knit', preview: 'Soft and warm' },
    { subject: 'Weekend knit', preview: 'Soft and warm' }
  ])
const variations: RecordedVariation[] = [
  {
    campaignId: 'CmpR01',
    messageId: 'MsgR01',
    variationId: 'VarA01',
    name: 'Design A',
    statistics: {
      recipients: 600,
      opens_unique: 250,
      open_rate: 0.42,
      conversions: 2,
      conversion_value: 90
    }
  },
  {
    campaignId: 'CmpR01',
    messageId: 'MsgR01',
    variationId: 'VarB01',
    name: 'Design B',
    statistics: {
      recipients: 590,
      opens_unique: 230,
      open_rate: 0.39,
      conversions: 3,
      conversion_value: 120
    }
  }
]
const clicks: RecordedClick[] = [
  {
    messageId: 'MsgR01',
    variationId: 'VarA01',
    url: 'https://cedar.example/p/1?utm_source=klaviyo',
    count: [9, 2],
    unique: [8, 2]
  }
]
const live =
  (transport: KlaviyoTransport) => async (): Promise<ResultsSource> => ({
    kind: 'live',
    client: klaviyoClient(key, { transport, maxWaits: 0 })
  })
const run = (
  db: Db,
  sourceFor: (tenantId: string) => Promise<ResultsSource>,
  over: { now?: () => number; deadline?: number } = {}
) =>
  runEmailResults(db, {
    sourceFor,
    now: over.now ?? (() => now),
    deadline: over.deadline ?? now + 30_000,
    callMs: 1_000
  })

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('the hourly results run', () => {
  it('follows a synthetic brand’s sample draft from draft to three days of results', async () => {
    let r = row({ sample: true, message_id: null })
    const at = [
      Date.parse('2026-11-18T12:00:00Z'),
      Date.parse('2026-11-19T18:05:00Z'),
      Date.parse('2026-11-20T18:05:00Z'),
      Date.parse('2026-11-21T18:05:00Z')
    ]
    const steps: ResultPatch[] = []
    for (const t of at) {
      const { db, saved } = database([r])
      const sourceFor = vi.fn()
      await run(db, sourceFor, { now: () => t, deadline: t + 30_000 })
      // No Klaviyo for a sample: no source asked.
      expect(sourceFor).not.toHaveBeenCalled()
      const patch = saved[0]!.patch
      steps.push(patch)
      r = {
        ...r,
        status: patch.status ?? r.status,
        sent_at: patch.sent_at ?? r.sent_at,
        pulls: patch.pulls ?? r.pulls,
        final: patch.final ?? false
      }
    }
    expect(
      steps.map((p) => [p.status, p.pulls ?? 0, p.final ?? false])
    ).toEqual([
      ['draft', 0, false],
      ['sent', 1, false],
      ['sent', 2, false],
      ['sent', 3, true]
    ])
    expect(steps[1]).toMatchObject({
      sent_at: '2026-11-18T18:00:00.000Z',
      results: [{ variation: 'sample-design-a', design: 'A' }],
      clicks: [
        { section: 0, block: 'hero_product' },
        { section: 1, block: 'product_grid' }
      ]
    })
  })

  it('reads a sent live draft’s results per design and its clicks per section', async () => {
    const sentAt = iso(now - dayMs - hourMs)
    const a = account('Sent', sentAt)
    const asked: { path: string; body: unknown }[] = []
    const { db, saved } = database([row()], { written: { b1: written() } })
    const result = await run(
      db,
      live(
        recordedResultsTransport({
          rest: a.transport,
          variations,
          clicks,
          asked
        })
      )
    )
    expect(result).toMatchObject({ checked: 1, pulled: 1, paused: 0 })
    expect(saved[0]).toMatchObject({
      build: 'b1',
      lease: 'lease-b1',
      patch: {
        status: 'sent',
        sent_at: sentAt,
        pulls: 1,
        complete: true,
        final: false,
        next_check_at: iso(Date.parse(sentAt) + 2 * dayMs),
        results: [
          { variation: 'VarA01', name: 'Design A', design: 'A' },
          { variation: 'VarB01', name: 'Design B', design: 'B' }
        ],
        clicks: [
          {
            variation: 'VarA01',
            section: 0,
            block: 'hero_product',
            clicks: 11,
            unique: 10
          }
        ]
      }
    })
    expect(saved[0]!.patch).not.toHaveProperty('changed')
    // Reads only: one status read, the metrics, one report, one count.
    expect(a.calls.every((c) => c.startsWith('GET '))).toBe(true)
    expect(asked.map((q) => q.path)).toEqual([
      '/api/campaign-values-reports',
      '/api/metric-aggregates'
    ])
  })

  it('looks at a scheduled draft again in an hour, and says when it was changed in Klaviyo', async () => {
    const a = account('Scheduled', iso(now + dayMs))
    const { db, saved } = database([row()], { written: { b1: 'f'.repeat(16) } })
    await run(db, live(recordedResultsTransport({ rest: a.transport })))
    expect(saved[0]!.patch).toEqual({
      status: 'scheduled',
      changed: true,
      next_check_at: iso(now + hourMs)
    })
  })

  it('ends with a draft deleted in Klaviyo', async () => {
    const a = account()
    a.messages.clear()
    const { db, saved } = database([row()])
    await run(db, live(recordedResultsTransport({ rest: a.transport })))
    expect(saved[0]!.patch).toEqual({
      status: 'deleted',
      final: true,
      next_check_at: iso(now)
    })
  })

  it('pauses every check of a workspace on Klaviyo’s rate limit, for as long as it says', async () => {
    const busy: KlaviyoTransport = async () => ({
      status: 429,
      headers: { 'retry-after': '120' },
      body: '{"errors":[{"code":"throttled"}]}'
    })
    const { db, saved } = database([
      row(),
      row({ build_id: 'b2', message_id: 'MsgR02' }),
      row({ tenant_id: 't2', build_id: 'b3', sample: true, message_id: null })
    ])
    const result = await run(db, live(busy))
    expect(
      saved.map((s) => [s.build, s.patch.paused ?? null, s.patch.next_check_at])
    ).toEqual([
      ['b1', 'rate_limited', iso(now + 120_000)],
      ['b2', 'rate_limited', iso(now + 120_000)],
      // Another workspace goes on.
      ['b3', null, expect.any(String)]
    ])
    expect(result.paused).toBe(2)
  })

  it('logs a refused key or a missing scope and looks again in six hours, never with the key', async () => {
    for (const [status, reason] of [
      [401, 'klaviyo_key_rejected'],
      [403, 'klaviyo_scope_missing']
    ] as const) {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const refused: KlaviyoTransport = async () => ({
        status,
        headers: {},
        body: '{"errors":[{"code":"not_authorized"}]}'
      })
      const { db, saved } = database([row()])
      await run(db, live(refused))
      expect(saved[0]!.patch).toEqual({
        paused: reason,
        next_check_at: iso(now + 6 * hourMs)
      })
      expect(JSON.stringify(warn.mock.calls)).not.toContain(key)
    }
  })

  it('puts back only the email whose answer it could not read', async () => {
    const a = account('Draft')
    const odd: KlaviyoTransport = async (request) =>
      request.url.includes('MsgR09')
        ? { status: 400, headers: {}, body: '{"errors":[{"code":"invalid"}]}' }
        : a.transport(request)
    const { db, saved } = database([
      row({ build_id: 'b9', message_id: 'MsgR09' }),
      row()
    ])
    await run(db, live(odd))
    expect(
      saved.map((s) => [s.build, s.patch.paused ?? s.patch.status])
    ).toEqual([
      ['b9', 'klaviyo_answer'],
      ['b1', 'draft']
    ])
  })

  it('puts a check back when Klaviyo is not switched on for the workspace', async () => {
    const { db, saved } = database([row()])
    await run(db, async () => ({ kind: 'off', reason: 'klaviyo_off' }))
    expect(saved[0]!.patch).toEqual({
      paused: 'klaviyo_off',
      next_check_at: iso(now + 6 * hourMs)
    })
  })

  it('reads counts without orders when the account has no Placed Order metric', async () => {
    const a = account('Sent', iso(now - dayMs - hourMs))
    const asked: { path: string; body: unknown }[] = []
    const { db, saved } = database([row()])
    await run(
      db,
      live(
        recordedResultsTransport({
          rest: a.transport,
          variations,
          clicks,
          asked,
          without: ['Placed Order']
        })
      )
    )
    const report = asked[0]!.body as {
      data: { attributes: { conversion_metric_id: string } }
    }
    expect(report.data.attributes.conversion_metric_id).toBe('ClkEml')
    expect(saved[0]!.patch).toMatchObject({ pulls: 1, complete: false })
    for (const r of saved[0]!.patch.results!) {
      expect(r.statistics).not.toHaveProperty('conversions')
      expect(r.statistics).not.toHaveProperty('conversion_value')
    }
  })

  it('puts a due read back when the account has neither metric', async () => {
    const a = account('Sent', iso(now - dayMs - hourMs))
    const { db, saved } = database([row()])
    await run(
      db,
      live(
        recordedResultsTransport({
          rest: a.transport,
          without: ['Placed Order', 'Clicked Email']
        })
      )
    )
    expect(saved[0]!.patch).toEqual({
      paused: 'klaviyo_no_metrics',
      next_check_at: iso(now + 6 * hourMs)
    })
  })

  it('starts nothing past its time and leaves the checks for the next run', async () => {
    const transport = vi.fn(account().transport)
    const { db, saved } = database([row()])
    const result = await run(db, live(transport), { deadline: now + 500 })
    expect(transport).not.toHaveBeenCalled()
    expect(saved).toEqual([])
    expect(result.deferred).toBe(1)
  })

  it('goes on when a check’s lease ran out', async () => {
    const a = account('Draft')
    const { db, saved } = database([row(), row({ build_id: 'b2' })], {
      lost: ['b1']
    })
    const result = await run(
      db,
      live(recordedResultsTransport({ rest: a.transport }))
    )
    expect(saved.map((s) => s.build)).toEqual(['b2'])
    expect(result.checked).toBe(1)
  })
})
