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
  care: []
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
/** The newest book, `tries` earlier strategist calls for it, nothing else. */
const one =
  (
    newest: { version: number; content: unknown; written_by?: string } | null,
    tries = 0,
    later: Record<string, unknown>[] = []
  ) =>
  (q: Query) => {
    if (q.table === 'agent_runs')
      return Array.from({ length: tries }, (_, i) => ({ id: `r${i}` }))
    if (q.filters.some((f) => f.op === 'gt')) return later
    return newest ? [{ written_by: brandBookAuthor, ...newest }] : []
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
    let reads = 0
    const moved = database((q) =>
      q.table === 'agent_runs'
        ? []
        : [
            {
              version: ++reads === 1 ? 1 : 2,
              content: b,
              written_by: brandBookAuthor
            }
          ]
    )
    expect(await runBrandStrategist(moved.db, tenantId, deps(ok(answer)))).toBe(
      'moved'
    )
    for (const r of [failed, unusable, moved])
      expect(r.rpc).not.toHaveBeenCalled()
  })

  it('puts a book the readers saved during its save back on top', async () => {
    const b = book()
    const newer = { ...b, products: { ...b.products, bestsellers: [] } }
    // Read at 4; a code write took 5; the strategist's save became 6.
    const { db, rpc } = database(
      one({ version: 4, content: b }, 0, [
        { version: 5, content: newer, written_by: brandBookAuthor }
      ]),
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
  })
})

describe('booksNeedingStrategy (ONB-106c)', () => {
  const b = book()
  const current = withStrategy(b, checkStrategy(answer, b)!)
  const books = [
    // Newest first: one row per version.
    { tenant_id: 'a', version: 3, written_by: brandBookAuthor, content: b },
    {
      tenant_id: 'b',
      version: 2,
      written_by: strategistAuthor,
      content: current
    },
    {
      tenant_id: 'a',
      version: 2,
      written_by: strategistAuthor,
      content: current
    },
    {
      tenant_id: 'c',
      version: 1,
      written_by: brandBookAuthor,
      content: { ...b, sample: true }
    },
    { tenant_id: 'd', version: 5, written_by: brandBookAuthor, content: b },
    { tenant_id: 'e', version: 1, written_by: brandBookAuthor, content: b },
    { tenant_id: 'f', version: 4, written_by: brandBookAuthor, content: b }
  ]
  const answerFor =
    (over: { reading?: string[]; tried?: [string, number][] } = {}) =>
    (q: Query) => {
      if (q.table === 'job_runs')
        return (over.reading ?? []).map((tenant_id) => ({ tenant_id }))
      if (q.table === 'agent_runs')
        return (over.tried ?? []).flatMap(([t, v]) =>
          Array.from({ length: maxAttempts }, () => ({
            tenant_id: t,
            caller_key: attemptKey(v)
          }))
        )
      const ids = q.filters.find((f) => f.column === 'tenant_id')?.value as
        string[] | undefined
      return books.filter((r) => !ids || ids.includes(r.tenant_id))
    }

  it('takes each workspace’s newest code-written real book, newest first', async () => {
    const { db, queries } = database(answerFor())
    expect(await booksNeedingStrategy(db, { limit: 5 })).toEqual([
      'a',
      'd',
      'e',
      'f'
    ])
    // Content is read only for the code-written candidates (the sample
    // book is left out once read), never for all books.
    const first = queries[0]!
    expect(first.select).toBe('tenant_id,version,written_by')
    const content = queries.find((q) => q.select.includes('content'))!
    expect(content.filters[0]!.value).toEqual(['a', 'c', 'd', 'e', 'f'])
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
    const jobs = queries.find((q) => q.table === 'job_runs')!
    expect(jobs.filters).toContainEqual({
      op: 'in',
      column: 'status',
      value: ['queued', 'retry_wait', 'leased', 'running']
    })
    expect(await booksNeedingStrategy(db, { limit: 1 })).toEqual(['e'])
  })

  it('throws a failed read', async () => {
    const { db } = database(() => ({ error: { code: 'XX000' } }))
    await expect(booksNeedingStrategy(db)).rejects.toMatchObject({
      code: 'XX000'
    })
  })
})
