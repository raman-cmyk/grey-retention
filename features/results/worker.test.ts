// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { fingerprints } from '@/features/klaviyo-push/fingerprints'
import { designHash, htmlHash } from '@/features/klaviyo-push/html'
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
    plannedSendAt: '2026-11-18T18:00:00.000Z',
    designs: 'both'
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
  context: {},
  final: false,
  paused: null,
  lease_token: `lease-${over.build_id ?? 'b1'}`,
  lease_until: iso(now + 60_000),
  created_at: '2026-11-15T00:00:00.000Z',
  updated_at: iso(now - dayMs),
  ...over
})
const sent = (over: Partial<ResultRow> = {}) =>
  row({ status: 'sent', sent_at: iso(now - dayMs - hourMs), ...over })

/** A database with these claimed rows (claimed in these batches), their builds and pushes. */
function database(
  batches: ResultRow[][],
  options: {
    written?: Record<string, string | null>
    refuse?: Record<string, string>
    /** A build's designs (B is `html`); both `html` by default. */
    designs?: Record<string, { html: string; designA?: string }>
    /** A build's push templates' fingerprints, by design (its designs' by default). */
    hashes?: Record<string, { A?: string; B?: string }>
    /** What PSH-001 recorded each variation showing. */
    shown?: Record<string, string>
  } = {}
) {
  const designsOf = (build: string) =>
    options.designs?.[build] ?? { html, designA: undefined }
  const all = batches.flat()
  const saved: { build: string; lease: string; patch: ResultPatch }[] = []
  const claims: number[] = []
  const query = (data: unknown[]) => {
    const q = { select: () => q, in: async () => ({ data, error: null }) }
    return q
  }
  const queue = [...batches]
  const db = {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === 'claim_klaviyo_results') {
        claims.push(args.lim as number)
        return { data: queue.shift() ?? [], error: null }
      }
      if (name === 'save_klaviyo_result') {
        const code = options.refuse?.[args.build as string]
        if (code) return { data: null, error: { code, message: 'refused' } }
        saved.push(args as (typeof saved)[number])
        return { data: null, error: null }
      }
      throw new Error(`unexpected rpc ${name}`)
    }),
    from: (table: string) =>
      query(
        table === 'email_builds'
          ? all.map((r) => ({
              id: r.build_id,
              push_key: `push-${r.build_id}`,
              created_at: '2026-11-15T00:00:00.000Z',
              ...designsOf(r.build_id),
              text: null
            }))
          : all.map((r) => {
              const d = designsOf(r.build_id)
              const hash = options.hashes?.[r.build_id]
              return {
                tenant_id: r.tenant_id,
                push_key: `push-${r.build_id}`,
                templates: [
                  {
                    approach: 'A',
                    id: 'T1',
                    variation: 'VarA01',
                    hash: hash?.A ?? designHash(d.designA ?? d.html),
                    deleted: false
                  },
                  {
                    approach: 'B',
                    id: 'T2',
                    variation: 'VarB01',
                    hash: hash?.B ?? designHash(d.html),
                    deleted: false
                  }
                ],
                written:
                  options.written && r.build_id in options.written
                    ? options.written[r.build_id]
                    : null,
                shown: options.shown?.[r.build_id] ?? null,
                images: {}
              }
            })
      )
  } as unknown as Db
  return { db, saved, claims }
}

/** A live account with one A/B draft (CmpR01 / MsgR01). */
function account(
  status = 'Draft',
  sendTime: string | null = null,
  extra: Record<string, unknown> = {}
) {
  const a = fakeDraftAccount({ audiences: ['LstAll'] })
  a.campaigns.set('CmpR01', {
    name: 'N',
    description: 'GROS draft k',
    createdAt: '2026-11-15T00:00:00Z',
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
    variationIds: ['VarA01', 'VarB01'],
    ...extra
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
      clicks_unique: 9,
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
      clicks_unique: 4,
      conversions: 3,
      conversion_value: 120
    }
  }
]
const clicks: RecordedClick[] = [
  {
    messageId: 'MsgR01',
    variationId: 'VarA01',
    url: 'https://cedar.example/p/1?utm_source=klaviyo&_kx=person.token',
    count: [9, 2],
    unique: [8, 2]
  },
  {
    messageId: 'MsgR01',
    variationId: 'VarA01',
    url: 'https://cedar.example/p/2',
    bot: true,
    count: [40],
    unique: [1]
  }
]
const live =
  (transport: KlaviyoTransport) => async (): Promise<ResultsSource> => ({
    kind: 'live',
    client: klaviyoClient(key, { transport, maxWaits: 0 }),
    currency: 'USD'
  })
const run = (
  db: Db,
  sourceFor: (tenantId: string) => Promise<ResultsSource>,
  over: {
    now?: () => number
    deadline?: number
    limit?: number
    wait?: (ms: number) => Promise<void>
  } = {}
) =>
  runEmailResults(db, {
    sourceFor,
    now: over.now ?? (() => now),
    deadline: over.deadline ?? now + 30_000,
    callMs: 1_000,
    limit: over.limit,
    wait: over.wait ?? (async () => {})
  })

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('the hourly results run', () => {
  it('follows a synthetic brand’s sample draft from draft to three days of results', async () => {
    let r = row({
      sample: true,
      message_id: null,
      planned: {
        date: '2026-11-18',
        time: '18:00',
        plannedSendAt: '2026-11-18T18:00:00.000Z',
        designs: 'A'
      }
    })
    const at = [
      Date.parse('2026-11-18T12:00:00Z'),
      Date.parse('2026-11-19T18:05:00Z'),
      Date.parse('2026-11-20T18:05:00Z'),
      Date.parse('2026-11-21T18:05:00Z')
    ]
    const steps: ResultPatch[] = []
    for (const t of at) {
      const { db, saved } = database([[r]])
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
        results_at:
          patch.pulls !== undefined && patch.pulls > r.pulls
            ? iso(t)
            : r.results_at,
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
      complete: true,
      results: [{ variation: 'sample-design-a', design: 'A' }],
      clicks: [
        { section: 0, block: 'hero_product', design: 'A' },
        { section: 1, block: 'product_grid', design: 'A' }
      ],
      context: { attributionOpen: true, abSplit: null, sentAtFrom: 'send_time' }
    })
  })

  it('reads a sent live draft’s results per design and its clicks per section, with how it read them', async () => {
    const sentAt = iso(now - dayMs - hourMs)
    const a = account('Sent', sentAt)
    const asked: { path: string; body: unknown }[] = []
    const waits: number[] = []
    const { db, saved } = database([[row()]], { written: { b1: written() } })
    const result = await run(
      db,
      live(
        recordedResultsTransport({
          rest: a.transport,
          variations,
          clicks,
          asked
        })
      ),
      { wait: async (ms) => void waits.push(ms) }
    )
    expect(result).toMatchObject({
      checked: 1,
      pulled: 1,
      paused: 0,
      failed: 0
    })
    expect(saved[0]).toMatchObject({
      build: 'b1',
      lease: 'lease-b1',
      patch: {
        status: 'sent',
        sent_at: sentAt,
        pulls: 1,
        complete: true,
        final: false,
        results: [
          { variation: 'VarA01', name: 'Design A', design: 'A' },
          { variation: 'VarB01', name: 'Design B', design: 'B' }
        ],
        // The bot's clicks are left out; the clicker's own token is never kept.
        clicks: [
          {
            variation: 'VarA01',
            design: 'A',
            url: 'https://cedar.example/p/1?utm_source=klaviyo',
            section: 0,
            block: 'hero_product',
            clicks: 11,
            unique: 10
          }
        ],
        context: {
          currency: 'USD',
          conversion: 'placed_order',
          attributionOpen: true,
          sentAtFrom: 'send_time',
          abSplit: true,
          clicksBy: 'message',
          botsLeftOut: 40,
          reported: true,
          reportTo: iso(now + dayMs),
          clicksFrom: iso(Date.parse(sentAt) - dayMs)
        }
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

  it('matches the report on the campaign, and asks for clicks by the campaign when none came by the message', async () => {
    const a = account('Sent', iso(now - dayMs - hourMs))
    const asked: { path: string; body: unknown }[] = []
    const { db, saved } = database([[row()]])
    await run(
      db,
      live(
        recordedResultsTransport({
          rest: a.transport,
          variations,
          clicks,
          asked,
          reportMessageIsCampaign: true,
          clicksKeyedBy: 'campaign'
        })
      )
    )
    expect(saved[0]!.patch.results).toHaveLength(2)
    expect(saved[0]!.patch.context).toMatchObject({ clicksBy: 'campaign' })
    expect(saved[0]!.patch.clicks).toHaveLength(1)
    expect(
      asked
        .filter((q) => q.path === '/api/metric-aggregates')
        .map(
          (q) =>
            (q.body as { data: { attributes: { filter: string[] } } }).data
              .attributes.filter[2]
        )
    ).toEqual(['equals($message,"MsgR01")', 'equals($message,"CmpR01")'])
  })

  it('keeps the earlier clicks when none come though people clicked, asking first by the key that worked', async () => {
    const earlier = [
      {
        variation: 'VarA01',
        design: 'A',
        url: 'https://cedar.example/p/1',
        section: 0,
        block: 'hero_product',
        clicks: 3,
        unique: 3
      }
    ]
    const asked: { path: string; body: unknown }[] = []
    const { db, saved } = database([
      [
        sent({
          sent_at: iso(now - 2 * dayMs - 13 * hourMs),
          pulls: 1,
          results_at: iso(now - dayMs - 13 * hourMs),
          results: [
            {
              variation: 'VarA01',
              name: 'Design A',
              design: 'A',
              statistics: { clicks_unique: 3 }
            }
          ],
          clicks: earlier,
          context: { clicksBy: 'campaign' }
        })
      ]
    ])
    // Not reported, and no clicks by either key.
    await run(
      db,
      live(
        recordedResultsTransport({
          rest: account('Sent', iso(now - 3 * dayMs)).transport,
          variations: [],
          clicks: [],
          asked
        })
      )
    )
    expect(saved[0]!.patch).toMatchObject({
      pulls: 2,
      clicks: earlier,
      complete: false,
      context: { resultsKept: true, clicksKept: true }
    })
    expect(
      asked
        .filter((q) => q.path === '/api/metric-aggregates')
        .map(
          (q) =>
            (q.body as { data: { attributes: { filter: string[] } } }).data
              .attributes.filter[2]
        )
    ).toEqual(['equals($message,"CmpR01")', 'equals($message,"MsgR01")'])
  })

  it('says an A/B draft read without its two designs apart is not whole', async () => {
    const a = account('Sent', iso(now - dayMs - hourMs))
    const { db, saved } = database([[row()]])
    await run(
      db,
      live(
        recordedResultsTransport({
          rest: a.transport,
          variations: [
            { ...variations[0]!, variationId: 'Bundled', name: 'All' }
          ],
          clicks
        })
      )
    )
    expect(saved[0]!.patch).toMatchObject({
      pulls: 1,
      complete: false,
      context: { abSplit: false }
    })
  })

  it('waits for a campaign Klaviyo has not reported yet, then saves the read as not whole', async () => {
    const sentAt = iso(now - dayMs - hourMs)
    const transport = () =>
      recordedResultsTransport({
        rest: account('Sent', sentAt).transport,
        variations: [],
        clicks
      })
    const early = database([[row()]])
    await run(early.db, live(transport()))
    expect(early.saved[0]!.patch).toEqual({
      status: 'sent',
      sent_at: sentAt,
      paused: 'klaviyo_not_reported',
      next_check_at: iso(now + hourMs)
    })
    const before = [
      {
        variation: 'VarA01',
        name: 'Design A',
        design: 'A',
        statistics: { recipients: 7 }
      }
    ]
    const late = database([
      [
        sent({
          sent_at: iso(now - 2 * dayMs - 13 * hourMs),
          pulls: 1,
          results_at: iso(now - dayMs - 13 * hourMs),
          results: before
        })
      ]
    ])
    const t = now
    await run(late.db, live(transport()), { now: () => t })
    // Not reported after waiting: saved as not whole, the earlier results kept.
    expect(late.saved[0]!.patch).toMatchObject({
      pulls: 2,
      results: before,
      complete: false,
      context: { reported: false, resultsKept: true }
    })
  })

  it('looks at a scheduled draft again in an hour, and says when it was changed in Klaviyo', async () => {
    const a = account('Scheduled', iso(now + dayMs))
    const { db, saved } = database([[row()]], {
      written: { b1: 'f'.repeat(16) }
    })
    await run(db, live(recordedResultsTransport({ rest: a.transport })))
    expect(saved[0]!.patch).toEqual({
      status: 'scheduled',
      changed: true,
      next_check_at: iso(now + hourMs)
    })
  })

  it('ends with a draft deleted in Klaviyo, also after a results read', async () => {
    for (const r of [
      row(),
      sent({ pulls: 1, results_at: iso(now - hourMs) })
    ]) {
      const a = account()
      a.messages.clear()
      const { db, saved } = database([[r]])
      await run(db, live(recordedResultsTransport({ rest: a.transport })))
      expect(saved[0]!.patch).toEqual({
        status: 'deleted',
        final: true,
        next_check_at: iso(now)
      })
    }
  })

  it('pauses every check of a workspace on Klaviyo’s rate limit, for as long as it says', async () => {
    const busy: KlaviyoTransport = async () => ({
      status: 429,
      headers: { 'retry-after': '120' },
      body: '{"errors":[{"code":"throttled"}]}'
    })
    const { db, saved } = database([
      [
        row(),
        row({ build_id: 'b2', message_id: 'MsgR02' }),
        row({ tenant_id: 't2', build_id: 'b3', sample: true, message_id: null })
      ]
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

  it('logs a refused key, a missing scope or an outage and looks again later, never with the key', async () => {
    for (const [status, reason, wait] of [
      [401, 'klaviyo_key_rejected', 6 * hourMs],
      [403, 'klaviyo_scope_missing', 6 * hourMs],
      [503, 'klaviyo_unavailable', hourMs]
    ] as const) {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const refused: KlaviyoTransport = async () => ({
        status,
        headers: {},
        body: '{"errors":[{"code":"not_authorized"}]}'
      })
      const { db, saved } = database([[row()]])
      await run(db, live(refused))
      expect(saved[0]!.patch).toEqual({
        paused: reason,
        next_check_at: iso(now + wait)
      })
      expect(JSON.stringify(warn.mock.calls)).not.toContain(key)
    }
  })

  it('keeps what a due email’s status read said when its read is put back', async () => {
    const busyReport: KlaviyoTransport = async (request) =>
      request.url.includes('campaign-values-reports')
        ? {
            status: 429,
            headers: { 'retry-after': '30' },
            body: '{"errors":[{"code":"throttled"}]}'
          }
        : recordedResultsTransport({
            rest: account('Sent', iso(now - dayMs - hourMs)).transport
          })(request)
    const { db, saved } = database([[row({ status: 'scheduled' })]])
    await run(db, live(busyReport))
    expect(saved[0]!.patch).toEqual({
      status: 'sent',
      sent_at: iso(now - dayMs - hourMs),
      paused: 'rate_limited',
      next_check_at: iso(now + 60_000)
    })
  })

  it('saves the results when the clicks cannot be read, as not whole', async () => {
    const a = account('Sent', iso(now - dayMs - hourMs))
    const results = recordedResultsTransport({ rest: a.transport, variations })
    const busyClicks: KlaviyoTransport = async (request) =>
      request.url.includes('metric-aggregates')
        ? {
            status: 429,
            headers: { 'retry-after': '2' },
            body: '{"errors":[{"code":"throttled"}]}'
          }
        : results(request)
    const earlier = [
      {
        variation: 'VarA01',
        design: 'A',
        url: 'https://cedar.example/p/1',
        section: 0,
        block: 'hero_product',
        clicks: 3,
        unique: 3
      }
    ]
    const { db, saved } = database([
      [
        sent({
          sent_at: iso(now - 3 * dayMs - hourMs),
          pulls: 2,
          results_at: iso(now - dayMs - hourMs),
          clicks: earlier
        })
      ]
    ])
    await run(db, live(busyClicks))
    // The third read ends it with the clicks read the day before.
    expect(saved[0]!.patch).toMatchObject({
      pulls: 3,
      final: true,
      clicks: earlier,
      complete: false,
      context: { clicksKept: true },
      results: [{ design: 'A' }, { design: 'B' }]
    })
  })

  it('puts due reads back when the report cannot be read, then saves them keeping what was read before', async () => {
    const sentAt = iso(now - dayMs - hourMs)
    const odd = (): KlaviyoTransport => {
      const rest = recordedResultsTransport({
        rest: account('Sent', sentAt).transport,
        clicks
      })
      return async (request) =>
        request.url.includes('campaign-values-reports')
          ? {
              status: 400,
              headers: {},
              body: '{"errors":[{"code":"invalid"}]}'
            }
          : rest(request)
    }
    const early = database([[row()]])
    await run(early.db, live(odd()))
    expect(early.saved[0]!.patch).toEqual({
      status: 'sent',
      sent_at: sentAt,
      paused: 'klaviyo_answer',
      next_check_at: iso(now + hourMs)
    })
    const late = database([[sent({ sent_at: iso(now - dayMs - 13 * hourMs) })]])
    await run(late.db, live(odd()))
    expect(late.saved[0]!.patch).toMatchObject({
      pulls: 1,
      results: [],
      complete: false,
      context: { reported: false, resultsKept: true, clicksKept: true }
    })
  })

  it('puts back only the email whose answer it could not read', async () => {
    const a = account('Draft')
    const odd: KlaviyoTransport = async (request) =>
      request.url.includes('MsgR09')
        ? { status: 400, headers: {}, body: '{"errors":[{"code":"invalid"}]}' }
        : a.transport(request)
    const { db, saved } = database([
      [row({ build_id: 'b9', message_id: 'MsgR09' }), row()]
    ])
    await run(db, live(odd))
    expect(
      saved.map((s) => [s.build, s.patch.paused ?? s.patch.status])
    ).toEqual([
      ['b9', 'klaviyo_answer'],
      ['b1', 'draft']
    ])
  })

  it('puts a check back when Klaviyo is not switched on, and ends one there is no point in', async () => {
    const { db, saved } = database([
      [
        row(),
        // A draft long past its day: stale.
        row({ build_id: 'b2', planned: { date: '2026-10-01' } }),
        // Sent, unread for ten days since we met it: closed, saying why.
        sent({
          build_id: 'b3',
          sent_at: iso(now - 11 * dayMs),
          created_at: iso(now - 12 * dayMs)
        }),
        // Sent long ago but met only lately: not yet.
        sent({
          build_id: 'b4',
          sent_at: iso(now - 11 * dayMs),
          created_at: iso(now - dayMs)
        }),
        // Scheduled, long past its day: the owner may have moved it later.
        row({
          build_id: 'b5',
          status: 'scheduled',
          planned: { date: '2026-10-20' }
        })
      ]
    ])
    await run(db, async () => ({ kind: 'off', reason: 'klaviyo_off' }))
    expect(saved.map((s) => [s.build, s.patch])).toEqual([
      ['b1', { paused: 'klaviyo_off', next_check_at: iso(now + 6 * hourMs) }],
      [
        'b2',
        {
          status: 'stale',
          final: true,
          paused: 'klaviyo_off',
          next_check_at: iso(now)
        }
      ],
      ['b3', { final: true, paused: 'klaviyo_off', next_check_at: iso(now) }],
      ['b4', { paused: 'klaviyo_off', next_check_at: iso(now + 6 * hourMs) }],
      ['b5', { paused: 'klaviyo_off', next_check_at: iso(now + 6 * hourMs) }]
    ])
  })

  it('reads counts without orders when the account has no Placed Order metric', async () => {
    const a = account('Sent', iso(now - dayMs - hourMs))
    const asked: { path: string; body: unknown }[] = []
    const { db, saved } = database([[row()]])
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
    expect(saved[0]!.patch).toMatchObject({
      pulls: 1,
      complete: false,
      context: { conversion: 'clicked_email' }
    })
    for (const r of saved[0]!.patch.results!) {
      expect(r.statistics).not.toHaveProperty('conversions')
      expect(r.statistics).not.toHaveProperty('conversion_value')
    }
  })

  it('puts a due read back when the account has neither metric, keeping its status', async () => {
    const a = account('Sent', iso(now - dayMs - hourMs))
    const { db, saved } = database([[row()]])
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
      status: 'sent',
      sent_at: iso(now - dayMs - hourMs),
      paused: 'klaviyo_no_metrics',
      next_check_at: iso(now + 6 * hourMs)
    })
  })

  it('reads the due results with the time it kept, leaving the other statuses for the next run', async () => {
    // Each Klaviyo request takes 400 ms, as live: each at most 6 s, 35 s in all.
    let t = now
    const sentAt = iso(now - dayMs - hourMs)
    const sentAccount = recordedResultsTransport({
      rest: account('Sent', sentAt).transport,
      variations,
      clicks
    })
    const draftAccount = account('Draft').transport
    const transport: KlaviyoTransport = async (request) => {
      t += 400
      if (/MsgD\d+/.test(request.url))
        return draftAccount({
          ...request,
          url: request.url.replace(/MsgD\d+/, 'MsgR01')
        })
      return sentAccount(request)
    }
    const rows = [1, 2, 3, 4].flatMap((w) => [
      sent({ tenant_id: `t${w}`, build_id: `b${w}-0` }),
      ...Array.from({ length: 9 }, (_, n) =>
        row({
          tenant_id: `t${w}`,
          build_id: `b${w}-${n + 1}`,
          message_id: `MsgD${n + 1}`
        })
      )
    ])
    const { db, saved } = database([rows])
    const result = await runEmailResults(db, {
      sourceFor: live(transport),
      now: () => t,
      deadline: now + 35_000,
      callMs: 6_000,
      wait: async () => {}
    })
    // Every due read is read; few statuses wait for the next run (each due
    // read also asks for its two designs' templates, LRN-001b: one
    // workspace's drafts at most).
    expect(saved.filter((s) => s.patch.pulls === 1)).toHaveLength(4)
    expect(result.deferred).toBeLessThanOrEqual(9)
    expect(result.checked + result.deferred).toBe(40)
  })

  it('stops claiming once a batch was not finished in time, leaving its unread checks unsaved', async () => {
    let t = now
    const sentAt = iso(now - dayMs - hourMs)
    const transport: KlaviyoTransport = async (request) => {
      if (request.url.includes('/api/metrics'))
        return {
          status: 429,
          headers: { 'retry-after': '30' },
          body: '{"errors":[{"code":"throttled"}]}'
        }
      t += 1_000
      return account('Sent', sentAt).transport(request)
    }
    const { db, saved, claims } = database([
      [sent(), row({ build_id: 'b2', status: 'scheduled' })],
      [row({ build_id: 'b3' })]
    ])
    const result = await run(db, live(transport), {
      now: () => t,
      deadline: now + 3_500,
      limit: 2
    })
    // b2's status was not read (no time kept for it): left for the next run,
    // never paused by the account's rate limit that came after.
    expect(saved.map((s) => [s.build, s.patch.paused])).toEqual([
      ['b1', 'rate_limited']
    ])
    expect(result.deferred).toBe(1)
    // Time was left for a claim, but the batch was not finished.
    expect(claims).toEqual([2])
  })

  it('keeps what the status reads said when no time is left for the results', async () => {
    let t = now
    const slow: KlaviyoTransport = async (request) => {
      t += 1_000
      return recordedResultsTransport({
        rest: account('Sent', iso(now - dayMs - hourMs)).transport
      })(request)
    }
    const { db, saved } = database([[row({ status: 'scheduled' })]])
    const result = await run(db, live(slow), {
      now: () => t,
      deadline: now + 1_500
    })
    expect(saved[0]!.patch).toMatchObject({
      status: 'sent',
      sent_at: iso(now - dayMs - hourMs),
      next_check_at: iso(now + 1_000)
    })
    // Its read waits for the next run.
    expect(result.deferred).toBe(1)
    expect(saved[0]!.patch).not.toHaveProperty('pulls')
  })

  it('starts nothing past its time', async () => {
    const transport = vi.fn(account().transport)
    const past = database([[row()]])
    expect(
      (await run(past.db, live(transport), { deadline: now - 1 })).deferred
    ).toBe(0)
    expect(past.claims).toEqual([])
    expect(transport).not.toHaveBeenCalled()
  })

  it('claims again while full batches come back and time is left', async () => {
    const a = account('Draft')
    const { db, saved, claims } = database([
      [row()],
      [row({ build_id: 'b2' })],
      []
    ])
    await run(db, live(recordedResultsTransport({ rest: a.transport })), {
      limit: 1
    })
    expect(claims).toEqual([1, 1, 1])
    expect(saved.map((s) => s.build)).toEqual(['b1', 'b2'])
  })

  it('goes on when one check cannot be saved, whatever the reason', async () => {
    const a = account('Draft')
    const { db, saved } = database(
      [[row(), row({ build_id: 'b2' }), row({ build_id: 'b3' })]],
      { refuse: { b1: 'PT409', b2: '23514' } }
    )
    const result = await run(
      db,
      live(recordedResultsTransport({ rest: a.transport }))
    )
    expect(saved.map((s) => s.build)).toEqual(['b3'])
    expect(result).toMatchObject({ checked: 1, failed: 2 })
  })

  it('leaves space between click questions', async () => {
    const sentAt = iso(now - dayMs - hourMs)
    const a = account('Sent', sentAt)
    a.campaigns.set('CmpR02', {
      ...a.campaigns.get('CmpR01')!,
      messageIds: ['MsgR02']
    })
    a.variations.set('VarA02', {
      ...a.variations.get('VarA01')!,
      messageId: 'MsgR02'
    })
    a.messages.set('MsgR02', {
      ...a.messages.get('MsgR01')!,
      campaignId: 'CmpR02',
      variationIds: ['VarA02']
    })
    const waits: number[] = []
    const { db, saved } = database([
      [
        row(),
        row({ build_id: 'b2', campaign_id: 'CmpR02', message_id: 'MsgR02' })
      ]
    ])
    await run(
      db,
      live(
        recordedResultsTransport({
          rest: a.transport,
          variations: [
            ...variations,
            {
              ...variations[0]!,
              campaignId: 'CmpR02',
              messageId: 'MsgR02',
              variationId: 'VarA02'
            }
          ],
          clicks
        })
      ),
      { wait: async (ms) => void waits.push(ms) }
    )
    // Each click question after the first waits its turn (the second
    // email asks again by its campaign: none came by its message).
    expect(saved).toHaveLength(2)
    expect(waits).toEqual([350, 350])
  })
})

describe('each design’s clicks under its own HTML (LRN-001b)', () => {
  // The same product in both designs, in another section of each.
  const htmlB =
    '<table><tr data-block="text_block"><td><a href="https://cedar.example/p/2">B</a></td></tr>' +
    '<tr data-block="product_grid"><td><a href="https://cedar.example/p/1">A</a></td></tr></table>'
  const edited =
    '<table><tr data-block="hero_product"><td><a href="https://cedar.example/p/1">New</a></td></tr></table>'
  const designs = { b1: { html: htmlB, designA: html } }
  const both: RecordedClick[] = [
    { ...clicks[0]!, url: 'https://cedar.example/p/1' },
    {
      ...clicks[0]!,
      variationId: 'VarB01',
      url: 'https://cedar.example/p/1',
      count: [3],
      unique: [3]
    }
  ]
  const sentRead = (
    a: ReturnType<typeof account>,
    over: Parameters<typeof database>[1] = {},
    r: ResultRow = row()
  ) => {
    const { db, saved } = database([[r]], { designs, ...over })
    return run(
      db,
      live(
        recordedResultsTransport({
          rest: a.transport,
          variations,
          clicks: both
        })
      )
    ).then(() => saved)
  }
  const blocks = (patch: ResultPatch) =>
    patch.clicks!.map((c) => [c.variation, c.section, c.block])

  it('maps design A’s clicks with A’s HTML and design B’s with B’s, never the other’s', async () => {
    const a = account('Sent', iso(now - dayMs - hourMs))
    const saved = await sentRead(a)
    expect(blocks(saved[0]!.patch)).toEqual([
      ['VarA01', 0, 'hero_product'],
      ['VarB01', 1, 'product_grid']
    ])
    expect(saved[0]!.patch.context!.sections).toEqual([
      { variation: 'VarA01', design: 'A', from: 'build', changed: false },
      { variation: 'VarB01', design: 'B', from: 'build', changed: false }
    ])
    // Each design's template is read (a GET), to see it unchanged.
    expect(a.calls).toContain('GET /api/templates/T2')
    expect(saved[0]!.patch).not.toHaveProperty('changed')
  })

  it('reads design B’s template from Klaviyo when its own HTML is not kept', async () => {
    const a = account('Sent', iso(now - dayMs - hourMs))
    a.templates.set('T2', { name: 'B', html: htmlB, created: iso(now) })
    const saved = await sentRead(a, { hashes: { b1: { B: 'f'.repeat(64) } } })
    expect(blocks(saved[0]!.patch)[1]).toEqual(['VarB01', 1, 'product_grid'])
    expect(saved[0]!.patch.context!.sections![1]).toMatchObject({
      from: 'klaviyo',
      changed: false
    })
  })

  it('keeps design B’s clicks with no section when neither is there, and says so', async () => {
    const a = account('Sent', iso(now - dayMs - hourMs))
    const saved = await sentRead(a, { hashes: { b1: { B: 'f'.repeat(64) } } })
    const patch = saved[0]!.patch
    expect(blocks(patch)).toEqual([
      ['VarA01', 0, 'hero_product'],
      ['VarB01', null, null]
    ])
    expect(patch.clicks![1]).toMatchObject({ clicks: 3, design: 'B' })
    expect(patch.results!.map((r) => r.design)).toEqual(['A', 'B'])
    expect(patch.context!.sections![1]).toEqual({
      variation: 'VarB01',
      design: 'B',
      from: null,
      changed: false
    })
  })

  it('sees a template changed in Klaviyo, marks the email changed, and maps with the HTML it has now', async () => {
    const a = account('Sent', iso(now - dayMs - hourMs))
    a.templates.set('T1', { name: 'A', html, created: iso(now) })
    a.templates.set('T2', { name: 'B', html: edited, created: iso(now) })
    const shown = `VarA01:T1:${htmlHash(html).slice(0, 16)},VarB01:T2:${htmlHash(htmlB).slice(0, 16)}`
    const saved = await sentRead(a, { shown: { b1: shown } })
    const patch = saved[0]!.patch
    expect(patch.changed).toBe(true)
    expect(blocks(patch)).toEqual([
      ['VarA01', 0, 'hero_product'],
      ['VarB01', 0, 'hero_product']
    ])
    expect(patch.context!.sections).toEqual([
      { variation: 'VarA01', design: 'A', from: 'build', changed: false },
      { variation: 'VarB01', design: 'B', from: 'klaviyo', changed: true }
    ])
    // From then on: its template unreadable at the next read, its sections
    // are unknown, never our old HTML.
    const next = account('Sent', iso(now - 2 * dayMs - 13 * hourMs))
    const later = await sentRead(
      next,
      { shown: { b1: shown } },
      sent({
        sent_at: iso(now - 2 * dayMs - 13 * hourMs),
        pulls: 1,
        results_at: iso(now - dayMs - 13 * hourMs),
        changed: true,
        context: patch.context as ResultRow['context']
      })
    )
    expect(blocks(later[0]!.patch)[1]).toEqual(['VarB01', null, null])
    expect(later[0]!.patch.context!.sections![1]).toMatchObject({
      from: null,
      changed: true
    })
  })

  it('pauses like the other reads when a template read is refused or rate-limited, keeping the earlier results', async () => {
    const sentAt = iso(now - dayMs - hourMs)
    const limited = account('Sent', sentAt)
    limited.faults.rateLimit = '/api/templates'
    limited.faults.retryAfter = 120
    expect((await sentRead(limited))[0]!.patch).toEqual({
      status: 'sent',
      sent_at: sentAt,
      paused: 'rate_limited',
      next_check_at: iso(now + 120_000)
    })
    const a = account('Sent', sentAt)
    const scope: KlaviyoTransport = async (request) =>
      request.url.includes('/api/templates/')
        ? {
            status: 403,
            headers: {},
            body: JSON.stringify({ errors: [{ code: 'permission_denied' }] })
          }
        : a.transport(request)
    const { db, saved } = database([[row()]], { designs })
    await run(
      db,
      live(recordedResultsTransport({ rest: scope, variations, clicks: both }))
    )
    expect(saved[0]!.patch).toMatchObject({
      status: 'sent',
      paused: 'klaviyo_scope_missing'
    })
    expect(saved[0]!.patch).not.toHaveProperty('pulls')
  })

  it('keeps the earlier clicks when no time is left for the templates, the results standing', async () => {
    let t = now
    const a = account('Sent', iso(now - dayMs - hourMs))
    const answers = recordedResultsTransport({
      rest: a.transport,
      variations,
      clicks: both
    })
    const transport: KlaviyoTransport = async (request) => {
      const answer = await answers(request)
      // The report takes almost all the time left.
      if (request.url.includes('/api/campaign-values-reports')) t = now + 29_500
      return answer
    }
    const { db, saved } = database([[row()]], { designs })
    await run(db, live(transport), { now: () => t })
    expect(saved[0]!.patch).toMatchObject({
      pulls: 1,
      results: [{ design: 'A' }, { design: 'B' }],
      clicks: [],
      complete: false,
      context: { clicksKept: true }
    })
    expect(a.calls.some((c) => c.includes('/api/templates/'))).toBe(false)
  })
})
