// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { InMemoryMemoryStore } from '@/features/agents/memory'
import { InMemoryRunLog, type AiCall } from '@/features/agents/runtime'
import {
  brandBookAuthor,
  brandBookFrom,
  type BrandBookContent
} from './brand-book'
import type { CatalogEntry } from './catalog/read'
import type { Finding } from './findings'
import { checkStrategy, strategistAuthor, withStrategy } from './strategist'
import {
  attemptKey,
  booksNeedingStrategy,
  maxAttempts,
  runBrandStrategist,
  strategistReady
} from './strategist-run'

const tenantId = '00000000-0000-4000-8000-000000000101'
const book = (owner: BrandBookContent['owner'] = null): BrandBookContent =>
  brandBookFrom({
    brandName: 'Linen & Co',
    domain: 'linen.example',
    timezone: 'America/New_York',
    currency: 'USD',
    findings: [
      {
        topic: 'offering',
        statement: 'Sells linen clothing for warm weather.',
        value: {},
        source: 'site',
        evidence: { url: 'https://shop.example/p', quote: 'x' },
        confidence: 0.9,
        pass: 'model'
      } as unknown as Finding
    ],
    catalog: [
      {
        id: 'p1',
        title: 'Linen shirt',
        featurable: true,
        bestsellerRank: 1,
        newArrival: false,
        launchedAt: null
      } as CatalogEntry
    ],
    history: null,
    catalogStatus: { featurable: 1, live: true },
    owner
  })
const answer = {
  positioning: 'Light linen clothing for people in warm places.',
  customers: ['People who want cool clothes on hot days.'],
  heroProducts: ['Linen shirt'],
  angles: ['Lead with how the fabric feels in the heat.'],
  care: [] as string[],
  voice: { tone: ['calm'], use: ['linen'], avoid: ['hype'], style: '' }
}
const ok =
  (content: unknown): AiCall =>
  async () => ({
    ok: true,
    content,
    provider: 'gemini',
    model: 'gemini-3.8-flash',
    costMicro: 120,
    inputTokens: 900,
    outputTokens: 200,
    settled: true
  })

type Filter = { op: string; column: string; value: unknown }
type Query = { table: string; select: string; filters: Filter[] }
/**
 * A database whose every read is answered by `answer(query)`, and whose
 * `save_brand_book` returns the next of `saves`.
 */
function database(
  answer: (q: Query) => unknown[] | { error: unknown },
  saves: number[] = [9]
) {
  const queries: Query[] = []
  const rpc = vi.fn(async () => ({ data: saves.shift() ?? 99, error: null }))
  const from = (table: string) => {
    const q: Query = { table, select: '', filters: [] }
    const chain = {
      select: (s: string) => ((q.select = s), chain),
      eq: (column: string, value: unknown) => (
        q.filters.push({ op: 'eq', column, value }),
        chain
      ),
      in: (column: string, value: unknown) => (
        q.filters.push({ op: 'in', column, value }),
        chain
      ),
      gt: (column: string, value: unknown) => (
        q.filters.push({ op: 'gt', column, value }),
        chain
      ),
      lt: (column: string, value: unknown) => (
        q.filters.push({ op: 'lt', column, value }),
        chain
      ),
      like: (column: string, value: unknown) => (
        q.filters.push({ op: 'like', column, value }),
        chain
      ),
      order: () => chain,
      limit: async () => {
        queries.push(q)
        const a = answer(q)
        return Array.isArray(a)
          ? { data: a, error: null }
          : { data: null, error: a.error }
      }
    }
    return chain
  }
  return { db: { from, rpc } as never, rpc, queries }
}
const live = { GEMINI_API_KEY: 'test-key' } as unknown as NodeJS.ProcessEnv
const deps = (ai: AiCall) => ({
  env: live,
  ai,
  memory: new InMemoryMemoryStore(),
  log: new InMemoryRunLog()
})
/**
 * The newest book (or, by read, the books in order), `tries` earlier
 * strategist calls in the run log, `reserved` in the allowance, and the
 * books between two versions.
 */
const one = (
  newest:
    | { version: number; content: unknown; written_by?: string }
    | null
    | ((read: number) => {
        version: number
        content: unknown
        written_by?: string
      }),
  tries = 0,
  later: Record<string, unknown>[] = [],
  reserved = 0
) => {
  let reads = 0
  return (q: Query) => {
    if (q.table === 'agent_runs')
      return Array.from({ length: tries }, (_, i) => ({ id: `r${i}` }))
    if (q.table === 'usage_reservations')
      return Array.from({ length: reserved }, (_, i) => ({ id: `u${i}` }))
    if (q.filters.some((f) => f.op === 'gt')) return later
    const row = typeof newest === 'function' ? newest(++reads) : newest
    return row ? [{ written_by: brandBookAuthor, ...row }] : []
  }
}

describe('runBrandStrategist (ONB-106c)', () => {
  it('writes the checked strategy into a new version of the newest book', async () => {
    const b = book()
    const { db, rpc } = database(one({ version: 4, content: b }), [5])
    const ai = vi.fn(ok(answer))
    expect(await runBrandStrategist(db, tenantId, deps(ai))).toBe('saved')
    expect(ai).toHaveBeenCalledTimes(1)
    expect(ai.mock.calls[0]![0]).toMatchObject({
      tenantId,
      purpose: 'plan',
      callerKey: 'brand-strategist:brand-book:4'
    })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('save_brand_book', {
      t: tenantId,
      content: withStrategy(b, checkStrategy(answer, b)!),
      written_by: strategistAuthor
    })
  })

  it('never asks a model for no book, a sample book, a strategist’s own version, or a book with no room left', async () => {
    const b = book()
    const long = book({
      positioning: 'Linen for warm days. '.repeat(340),
      voice: 'Calm.',
      prohibitions: ''
    })
    for (const [newest, outcome] of [
      [null, 'no_book'],
      [{ version: 1, content: { ...b, sample: true } }, 'sample'],
      [
        {
          version: 2,
          content: withStrategy(b, checkStrategy(answer, b)!),
          written_by: strategistAuthor
        },
        'current'
      ],
      [{ version: 3, content: long }, 'no_room']
    ] as const) {
      const { db, rpc } = database(one(newest))
      const ai = vi.fn(ok(answer))
      expect(await runBrandStrategist(db, tenantId, deps(ai))).toBe(outcome)
      expect(ai).not.toHaveBeenCalled()
      expect(rpc).not.toHaveBeenCalled()
    }
  })

  it('never runs on the fake AI: no strategy is better than a made-up one', async () => {
    for (const env of [
      {},
      { AI_DEFAULT_PROVIDER: 'fake', GEMINI_API_KEY: 'k' }
    ]) {
      expect(strategistReady(env as unknown as NodeJS.ProcessEnv)).toBe(false)
      const { db, rpc } = database(one({ version: 1, content: book() }))
      expect(
        await runBrandStrategist(db, tenantId, {
          env: env as unknown as NodeJS.ProcessEnv
        })
      ).toBe('no_model')
      expect(rpc).not.toHaveBeenCalled()
    }
    expect(strategistReady(live)).toBe(true)
  })

  it('asks at most twice per book version, counted by the allowance too when the run log missed a call', async () => {
    const reservedOnly = database(
      one({ version: 7, content: book() }, 0, [], maxAttempts)
    )
    const notAsked = vi.fn(ok(answer))
    expect(
      await runBrandStrategist(reservedOnly.db, tenantId, deps(notAsked))
    ).toBe('tried')
    expect(notAsked).not.toHaveBeenCalled()
    expect(
      reservedOnly.queries.find((q) => q.table === 'usage_reservations')
        ?.filters
    ).toEqual([
      { op: 'eq', column: 'tenant_id', value: tenantId },
      {
        op: 'like',
        column: 'operation_id',
        value: 'ai:%:brand-strategist:brand-book:7:%'
      }
    ])
  })

  it('asks at most twice per book version, whatever the outcome, by the run log', async () => {
    const { db, rpc, queries } = database(
      one({ version: 7, content: book() }, maxAttempts)
    )
    const ai = vi.fn(ok(answer))
    expect(await runBrandStrategist(db, tenantId, deps(ai))).toBe('tried')
    expect(ai).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
    expect(queries.find((q) => q.table === 'agent_runs')?.filters).toEqual([
      { op: 'eq', column: 'agent', value: 'brand-strategist' },
      { op: 'eq', column: 'tenant_id', value: tenantId },
      { op: 'eq', column: 'caller_key', value: attemptKey(7) }
    ])
  })

  it('saves nothing when the model fails, says nothing usable, or the readers wrote a newer book meanwhile', async () => {
    const b = book()
    const failed = database(one({ version: 1, content: b }))
    expect(
      await runBrandStrategist(
        failed.db,
        tenantId,
        deps(async () => ({ ok: false, code: 'timeout' }))
      )
    ).toBe('failed')
    const unusable = database(one({ version: 1, content: b }))
    expect(
      await runBrandStrategist(
        unusable.db,
        tenantId,
        deps(ok({ ...answer, positioning: 'Free gifts with every order.' }))
      )
    ).toBe('nothing_usable')
    const moved = database(
      one((read) => ({ version: read === 1 ? 1 : 2, content: b }))
    )
    expect(await runBrandStrategist(moved.db, tenantId, deps(ok(answer)))).toBe(
      'moved'
    )
    for (const r of [failed, unusable, moved])
      expect(r.rpc).not.toHaveBeenCalled()
  })

  it('puts a book the readers saved during its save back on top, only while its own save is newest', async () => {
    const b = book()
    const newer = { ...b, products: { ...b.products, bestsellers: [] } }
    const between = [
      { version: 5, content: newer, written_by: brandBookAuthor }
    ]
    // Read at 4; a code write took 5; the strategist's save became 6.
    const { db, rpc } = database(
      one((read) => ({ version: read <= 2 ? 4 : 6, content: b }), 0, between),
      [6, 7]
    )
    expect(await runBrandStrategist(db, tenantId, deps(ok(answer)))).toBe(
      'moved'
    )
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc).toHaveBeenLastCalledWith('save_brand_book', {
      t: tenantId,
      content: newer,
      written_by: brandBookAuthor
    })
    // A book written after the save (7) is on top already: left alone.
    const after = database(
      one((read) => ({ version: read <= 2 ? 4 : 7, content: b }), 0, between),
      [6]
    )
    expect(await runBrandStrategist(after.db, tenantId, deps(ok(answer)))).toBe(
      'saved'
    )
    expect(after.rpc).toHaveBeenCalledTimes(1)
  })
})

describe('booksNeedingStrategy (ONB-106c)', () => {
  const b = book()
  const current = withStrategy(b, checkStrategy(answer, b)!)
  const noRoom = book({
    positioning: 'Linen for warm days. '.repeat(340),
    voice: 'Calm.',
    prohibitions: ''
  })
  type Row = {
    tenant_id: string
    version: number
    written_by: string
    content: BrandBookContent
  }
  const row = (
    tenant_id: string,
    version: number,
    content: BrandBookContent = b,
    written_by = brandBookAuthor
  ): Row => ({ tenant_id, version, written_by, content })
  // Newest first: one row per version.
  const books: Row[] = [
    row('a', 3),
    row('b', 2, current, strategistAuthor),
    row('a', 2, current, strategistAuthor),
    row('c', 1, { ...b, sample: true }),
    row('d', 5),
    row('e', 1),
    row('f', 4)
  ]
  const eq = (q: Query, column: string) =>
    q.filters.find((f) => f.op === 'eq' && f.column === column)?.value
  const answerFor =
    (
      over: {
        rows?: Row[]
        reading?: string[]
        tried?: [string, number][]
      } = {}
    ) =>
    (q: Query) => {
      const rows = over.rows ?? books
      if (q.table === 'job_runs')
        return (over.reading ?? []).map((tenant_id) => ({ tenant_id }))
      if (q.table === 'usage_reservations') return []
      if (q.table === 'agent_runs')
        return (over.tried ?? []).some(
          ([t, v]) =>
            eq(q, 'tenant_id') === t && eq(q, 'caller_key') === attemptKey(v)
        )
          ? Array.from({ length: maxAttempts }, (_, i) => ({ id: `r${i}` }))
          : []
      if (q.select === 'content')
        return rows
          .filter(
            (r) =>
              r.tenant_id === eq(q, 'tenant_id') &&
              r.version === eq(q, 'version')
          )
          .map((r) => ({ content: r.content }))
      return rows.map((r) => ({
        tenant_id: r.tenant_id,
        version: r.version,
        written_by: r.written_by,
        sample: r.content.sample
      }))
    }

  it('takes each workspace’s newest code-written real book, newest first, reading content only for candidates', async () => {
    const { db, queries } = database(answerFor())
    expect(await booksNeedingStrategy(db, { limit: 5 })).toEqual([
      'a',
      'd',
      'e',
      'f'
    ])
    expect(queries[0]!.select).toBe(
      'tenant_id,version,written_by,sample:content->sample'
    )
    // One exact book version per candidate; never the sample one.
    expect(
      queries
        .filter((q) => q.select === 'content')
        .map((q) => [eq(q, 'tenant_id'), eq(q, 'version')])
    ).toEqual([
      ['a', 3],
      ['d', 5],
      ['e', 1],
      ['f', 4]
    ])
  })

  it('leaves out a workspace still reading, or one whose book was tried twice', async () => {
    const { db, queries } = database(
      answerFor({
        reading: ['a'],
        tried: [
          ['d', 5],
          ['e', 99]
        ]
      })
    )
    expect(await booksNeedingStrategy(db, { limit: 5 })).toEqual(['e', 'f'])
    expect(queries.find((q) => q.table === 'job_runs')!.filters).toContainEqual(
      {
        op: 'in',
        column: 'status',
        value: ['queued', 'retry_wait', 'leased', 'running']
      }
    )
    expect(await booksNeedingStrategy(db, { limit: 1 })).toEqual(['e'])
  })

  it('never lets a workspace it leaves out hide an older one', async () => {
    const rows = [
      row('x', 9, noRoom),
      ...Array.from({ length: 12 }, (_, i) =>
        row('s', 12 - i, { ...b, sample: true })
      ),
      row('y', 2)
    ]
    const { db } = database(answerFor({ rows, tried: [] }))
    expect(await booksNeedingStrategy(db, { limit: 1 })).toEqual(['y'])
  })

  it('throws a failed read', async () => {
    const { db } = database(() => ({ error: { code: 'XX000' } }))
    await expect(booksNeedingStrategy(db)).rejects.toMatchObject({
      code: 'XX000'
    })
  })
})
