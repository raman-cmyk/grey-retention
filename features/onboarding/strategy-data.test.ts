// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CatalogEntry } from '@/features/onboarding/catalog/read'
import type { Finding } from '@/features/onboarding/findings'
import {
  historySnapshot,
  windowRead
} from '@/features/onboarding/history/facts'
import type { StoredHistory } from '@/features/onboarding/history/read'
import { readMapperInput } from '@/features/strategy/competitors'
import { readPulseInput } from '@/features/strategy/pulse'

const reads = vi.hoisted(() => ({
  catalog: vi.fn(),
  history: vi.fn(),
  findings: vi.fn(),
  keyDates: vi.fn(),
  timezone: vi.fn()
}))
vi.mock('@/features/onboarding/catalog/read', () => ({
  listCatalog: reads.catalog
}))
vi.mock('@/features/onboarding/findings', () => ({
  listFindings: reads.findings
}))
vi.mock('@/features/onboarding/history/read', async (original) => ({
  ...(await original<typeof import('@/features/onboarding/history/read')>()),
  readKlaviyoHistory: reads.history
}))
vi.mock('@/features/holidays/key-dates', async (original) => ({
  ...(await original<typeof import('@/features/holidays/key-dates')>()),
  planningKeyDates: reads.keyDates
}))
vi.mock('@/features/strategy/offers', () => ({
  workspaceTimezone: reads.timezone
}))

const { industryFrom, onboardedStrategyData, strategyFrom } =
  await import('./strategy-data')

const start = '2026-11-16'
const tenantId = '00000000-0000-4000-8000-000000000101'
const product = (over: Partial<CatalogEntry> = {}): CatalogEntry => ({
  id: 'p1',
  externalId: 'k1',
  title: 'Linen shirt',
  url: 'https://shop.example/p/1',
  price: '$89.00',
  amount: 89,
  currency: 'USD',
  compareAt: null,
  image: 'https://shop.example/p1.jpg',
  featurable: true,
  hiddenReason: null,
  unitsSold30d: 12,
  unitsSold90d: 30,
  bestsellerRank: 2,
  launchedAt: '2026-11-20T00:00:00Z',
  newArrival: true,
  stock: 0,
  ...over
})
const stored = (
  over: Partial<StoredHistory> = {},
  audiences = true
): StoredHistory => ({
  history: historySnapshot.parse({
    currency: 'USD',
    timezone: 'America/New_York',
    sendsPerWeek: 3.2,
    usualSendTime: '09:00',
    sent: [],
    scheduled: [
      {
        id: 'S1',
        campaignId: 'C1',
        subject: 'x',
        sendAt: '2026-11-18T14:00:00.000Z',
        date: '2026-11-18',
        audienceIds: ['SegA'],
        offer: true
      }
    ],
    flows: [],
    audiences: audiences
      ? [
          {
            id: 'SegA',
            kind: 'segment',
            name: 'Engaged',
            active: true,
            starred: true,
            excludedOnly: false
          }
        ]
      : [],
    flowsRead: true,
    window: windowRead,
    parts: {
      sent: true,
      scheduled: true,
      audiences: true,
      campaignReport: true,
      flows: true,
      flowReport: true,
      lists: true,
      segments: true
    }
  }),
  state: 'ready',
  reason: null,
  readAt: '2026-11-15T00:00:00Z',
  complete: true,
  live: true,
  ...over
})
const offering = (statement: string, confidence = 0.9) =>
  ({ topic: 'offering', statement, confidence }) as unknown as Finding
const parts = (over = {}) => ({
  brandName: 'Linen & Co',
  timezone: 'America/New_York',
  catalog: [
    product(),
    product({
      id: 'p2',
      title: 'Wool scarf',
      bestsellerRank: 1,
      launchedAt: '2025-01-01T00:00:00Z',
      stock: 4
    })
  ],
  history: stored(),
  findings: [offering('Linen clothing for warm weather')],
  keyDates: [
    {
      date: '2026-11-27',
      name: 'Black Friday',
      kind: 'sale' as const,
      source: 'calendar' as const,
      leadDays: 7,
      emailsFrom: '2026-11-20'
    }
  ],
  ...over
})

describe('strategyFrom (ONB-057a)', () => {
  it('plans from the workspace’s own catalog, history and key dates', () => {
    const own = strategyFrom(parts(), start)!
    expect(own.sample).toBe(false)
    // The planner's own checks take it as it is.
    const pulse = readPulseInput(own.pulse)
    expect(pulse.input.brand).toEqual({
      name: 'Linen & Co',
      industry: 'Linen clothing for warm weather',
      timezone: 'America/New_York',
      currency: 'USD',
      maxDiscountPercent: 0
    })
    expect(pulse.input.products.map((p) => p.id)).toEqual(['p2', 'p1'])
    expect(pulse.input.products[1]).toMatchObject({
      price: 89,
      launchedOn: '2026-11-20',
      stock: 0
    })
    expect(pulse.input.dates).toEqual([
      { date: '2026-11-27', name: 'Black Friday', kind: 'event' }
    ])
    const mapper = readMapperInput(own.mapper)
    expect(mapper.ourDates).toEqual([
      { date: '2026-11-27', name: 'Black Friday', kind: 'sale' }
    ])
    expect(own.plan).toMatchObject({
      industry: 'Linen clothing for warm weather',
      sendsPerWeek: 3,
      sendTime: '09:00',
      audiences: [{ id: 'SegA', label: 'Engaged' }],
      existing: [{ date: '2026-11-18', audienceId: 'SegA', offer: true }],
      blackouts: []
    })
    expect(own.plan.products).toEqual([
      { id: 'p2', title: 'Wool scarf', inStock: true, availableFrom: null },
      {
        id: 'p1',
        title: 'Linen shirt',
        inStock: false,
        availableFrom: '2026-11-20'
      }
    ])
  })

  it('says sample when the history was not read live, and fills gaps safely', () => {
    const own = strategyFrom(
      parts({
        brandName: null,
        findings: [],
        history: stored({ live: false }),
        keyDates: []
      }),
      start
    )!
    expect(own.sample).toBe(true)
    expect(readPulseInput(own.pulse).input.brand).toMatchObject({
      name: 'Your store',
      industry: 'other'
    })
  })

  it('is null until there is a catalog, a history and an audience', () => {
    expect(strategyFrom(parts({ catalog: [] }), start)).toBeNull()
    expect(strategyFrom(parts({ history: null }), start)).toBeNull()
    expect(
      strategyFrom(parts({ history: stored({ state: 'empty' }) }), start)
    ).toBeNull()
    expect(
      strategyFrom(parts({ history: stored({}, false) }), start)
    ).toBeNull()
  })

  it('names the industry from the surest offering finding', () => {
    expect(
      industryFrom([offering('Candles', 0.4), offering('Home fragrance', 0.8)])
    ).toBe('Home fragrance')
    expect(industryFrom([])).toBe('other')
    expect(industryFrom([offering('x'.repeat(90))])).toHaveLength(60)
  })
})

describe('onboardedStrategyData (ONB-057a)', () => {
  const sample = {
    load: vi.fn(
      async () =>
        ({ sample: true, pulse: 'S', mapper: 'S', plan: 'S' }) as never
    )
  }
  const db = (profile: { data: unknown; error: unknown }) =>
    ({
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => profile }) })
      })
    }) as never
  beforeEach(() => {
    reads.timezone.mockResolvedValue('America/New_York')
    reads.catalog.mockResolvedValue(parts().catalog)
    reads.history.mockResolvedValue(stored())
    reads.findings.mockResolvedValue(parts().findings)
    reads.keyDates.mockResolvedValue({
      country: 'US',
      countrySource: 'saved',
      dates: parts().keyDates
    })
    sample.load.mockClear()
  })

  it('reads the workspace and plans from it', async () => {
    const own = await onboardedStrategyData(
      db({ data: { brand_name: 'Linen & Co' }, error: null }),
      { fallback: sample }
    ).load({ tenantId, start })
    expect(own.sample).toBe(false)
    expect(sample.load).not.toHaveBeenCalled()
    expect(reads.keyDates).toHaveBeenCalledWith(expect.anything(), {
      tenantId,
      timezone: 'America/New_York',
      from: start,
      days: 15,
      industry: 'Linen clothing for warm weather'
    })
  })

  it('uses the sample store until there is enough, and plans without key dates if they fail', async () => {
    reads.history.mockResolvedValue(null)
    await onboardedStrategyData(db({ data: null, error: null }), {
      fallback: sample
    }).load({
      tenantId,
      start
    })
    expect(sample.load).toHaveBeenCalledWith({ tenantId, start })
    reads.history.mockResolvedValue(stored())
    reads.keyDates.mockResolvedValue(null)
    const own = await onboardedStrategyData(db({ data: null, error: null }), {
      fallback: sample
    }).load({ tenantId, start })
    expect(readPulseInput(own.pulse).input.dates).toEqual([])
  })

  it('throws when a read fails, so the step is tried again', async () => {
    reads.catalog.mockRejectedValue(new Error('down'))
    await expect(
      onboardedStrategyData(db({ data: null, error: null }), {
        fallback: sample
      }).load({
        tenantId,
        start
      })
    ).rejects.toThrow('down')
    reads.catalog.mockResolvedValue(parts().catalog)
    await expect(
      onboardedStrategyData(db({ data: null, error: { code: '42501' } }), {
        fallback: sample
      }).load({ tenantId, start })
    ).rejects.toMatchObject({ code: '42501' })
  })
})
