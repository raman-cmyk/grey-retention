// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { InMemoryMemoryStore } from '@/features/agents/memory'
import { InMemoryRunLog, type AiCall } from '@/features/agents/runtime'
import { brandBookFrom, type BrandBookContent } from './brand-book'
import type { CatalogEntry } from './catalog/read'
import type { Finding } from './findings'
import { checkStrategy, strategistAuthor, withStrategy } from './strategist'
import {
  booksNeedingStrategy,
  runBrandStrategist,
  strategistCallMs
} from './strategist-run'

const tenantId = '00000000-0000-4000-8000-000000000101'
const book = (): BrandBookContent =>
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
    owner: null
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

/** Brand books read newest first, one answer per read; the save's version. */
function database(reads: ({ version: number; content: unknown } | null)[]) {
  const queue = [...reads]
  const rpc = vi.fn(async () => ({ data: 9, error: null }))
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: async () => {
      const row = queue.shift()
      return { data: row ? [row] : [], error: null }
    }
  }
  return { db: { from: () => chain, rpc } as never, rpc }
}
const live = { GEMINI_API_KEY: 'test-key' } as unknown as NodeJS.ProcessEnv
const deps = (ai: AiCall) => ({
  env: live,
  ai,
  memory: new InMemoryMemoryStore(),
  log: new InMemoryRunLog()
})

describe('runBrandStrategist (ONB-106c)', () => {
  it('writes the checked strategy into a new version of the newest book', async () => {
    const b = book()
    const { db, rpc } = database([
      { version: 4, content: b },
      { version: 4, content: b }
    ])
    const ai = vi.fn(ok(answer))
    expect(await runBrandStrategist(db, tenantId, deps(ai))).toBe('saved')
    expect(ai).toHaveBeenCalledTimes(1)
    expect(ai.mock.calls[0]![0]).toMatchObject({
      tenantId,
      purpose: 'plan',
      callerKey: 'brand-strategist:brand-book:4'
    })
    expect(rpc).toHaveBeenCalledWith('save_brand_book', {
      t: tenantId,
      content: withStrategy(b, checkStrategy(answer, b)!),
      written_by: strategistAuthor
    })
  })

  it('never asks a model for no book, a sample book or a current strategy', async () => {
    const b = book()
    const current = withStrategy(b, checkStrategy(answer, b)!)
    for (const [read, outcome] of [
      [null, 'no_book'],
      [{ version: 1, content: { ...b, sample: true } }, 'sample'],
      [{ version: 2, content: current }, 'current']
    ] as const) {
      const { db, rpc } = database([read])
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
      const { db, rpc } = database([{ version: 1, content: book() }])
      expect(
        await runBrandStrategist(db, tenantId, {
          env: env as unknown as NodeJS.ProcessEnv
        })
      ).toBe('no_model')
      expect(rpc).not.toHaveBeenCalled()
    }
  })

  it('saves nothing when the model fails, says nothing usable, or the readers wrote a newer book meanwhile', async () => {
    const b = book()
    const failed = database([{ version: 1, content: b }])
    expect(
      await runBrandStrategist(
        failed.db,
        tenantId,
        deps(async () => ({ ok: false, code: 'timeout' }))
      )
    ).toBe('failed')
    const unusable = database([{ version: 1, content: b }])
    expect(
      await runBrandStrategist(
        unusable.db,
        tenantId,
        deps(ok({ ...answer, positioning: 'The best linen in the world.' }))
      )
    ).toBe('nothing_usable')
    const moved = database([
      { version: 1, content: b },
      { version: 2, content: b }
    ])
    expect(await runBrandStrategist(moved.db, tenantId, deps(ok(answer)))).toBe(
      'moved'
    )
    for (const r of [failed, unusable, moved])
      expect(r.rpc).not.toHaveBeenCalled()
  })

  it('caps the model call so the readers’ route still ends in time', () => {
    expect(strategistCallMs).toBeLessThanOrEqual(25_000)
  })
})

describe('booksNeedingStrategy (ONB-106c)', () => {
  it('takes each workspace’s newest book only, real books without a current strategy', async () => {
    const b = book()
    const current = withStrategy(b, checkStrategy(answer, b)!)
    const rows = [
      { tenant_id: 'a', version: 3, content: b },
      { tenant_id: 'b', version: 2, content: current },
      { tenant_id: 'a', version: 2, content: current },
      { tenant_id: 'c', version: 1, content: { ...b, sample: true } },
      { tenant_id: 'd', version: 5, content: b }
    ]
    const chain = {
      select: () => chain,
      order: () => chain,
      limit: async () => ({ data: rows, error: null })
    }
    const db = { from: () => chain } as never
    expect(await booksNeedingStrategy(db)).toEqual(['a', 'd'])
    expect(await booksNeedingStrategy(db, { limit: 1 })).toEqual(['a'])
    const failing = {
      from: () => ({
        select: () => ({
          order: () => ({
            limit: async () => ({ data: null, error: { code: 'XX000' } })
          })
        })
      })
    } as never
    await expect(booksNeedingStrategy(failing)).rejects.toMatchObject({
      code: 'XX000'
    })
  })
})
