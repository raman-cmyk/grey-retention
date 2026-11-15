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

vi.mock('server-only', () => ({}))
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

const {
  historyFreshDays,
  historyUsable,
  industryFrom,
  onboardedStrategyData,
  strategyFrom
} = await import('./strategy-data')

const start = '2026-11-16'
const now = new Date('2026-11-15T12:00:00Z')
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
  // 02:00 UTC on the 21st is still the 20th in New York.
  launchedAt: '2026-11-21T02:00:00Z',
  newArrival: true,
  stock: 0,
  ...over
})
type Parts = StoredHistory['history']['parts']
const stored = (
  over: Partial<StoredHistory> = {},
  {
    audiences = true,
    parts = {}
  }: { audiences?: boolean; parts?: Partial<Parts> } = {}
): StoredHistory => ({
  history: historySnapshot.parse({
    currency: 'EUR',
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
      segments: true,
      ...parts
    }
  }),
  state: 'ready',
  reason: null,
  readAt: '2026-11-15T00:00:00Z',
  complete: true,
  live: true,
  ...over
})
const offering = (
  statement: string,
  confidence = 0.9,
  pass: Finding['pass'] = 'model'
) => ({ topic: 'offering', statement, confidence, pass }) as unknown as Finding
const keyDate = (date: string, name: string, emailsFrom: string) => ({
  date,
  name,
  kind: 'sale' as const,
  source: 'calendar' as const,
  leadDays: 7,
  emailsFrom
})
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
    }),
    product({
      id: 'p3',
      title: 'Draft hat',
      featurable: false,
      hiddenReason: 'unpublished'
    })
  ],
  history: stored(),
  findings: [offering('Linen clothing for warm weather')],
  keyDates: [
    keyDate('2026-11-27', 'Black Friday', '2026-11-20'),
    // Emails start inside the 15 days; the day itself is after them.
    keyDate('2026-12-05', 'Winter sale', '2026-11-28')
  ],
  ...over
})

describe('strategyFrom (ONB-057a)', () => {
  it('plans from the workspace’s own catalog, history and key dates', () => {
    const own = strategyFrom(parts(), start, now)!
    expect(own.sample).toBe(false)
    // The planner's own checks take it as it is.
    const pulse = readPulseInput(own.pulse)
    expect(pulse.input.brand).toEqual({
      name: 'Linen & Co',
      industry: 'apparel',
      timezone: 'America/New_York',
      currency: 'USD',
      maxDiscountPercent: 0
    })
    // Best sellers first; a product emails may not feature is left out.
    expect(pulse.input.products.map((p) => p.id)).toEqual(['p2', 'p1'])
    expect(pulse.input.products[1]).toMatchObject({
      price: 89,
      launchedOn: '2026-11-20',
      stock: 0
    })
    expect(pulse.input.dates.map((d) => d.name)).toEqual([
      'Black Friday',
      'Winter sale'
    ])
    const mapper = readMapperInput(own.mapper)
    expect(mapper.industry).toBe('apparel')
    expect(mapper.ourDates).toEqual([
      { date: '2026-11-27', name: 'Black Friday', kind: 'sale' }
    ])
    expect(own.plan).toMatchObject({
      industry: 'apparel',
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
        catalog: [product({ currency: '' })],
        keyDates: []
      }),
      start,
      now
    )!
    expect(own.sample).toBe(true)
    expect(readPulseInput(own.pulse).input.brand).toMatchObject({
      name: 'Your store',
      industry: 'other',
      currency: 'EUR'
    })
  })

  it('is null until there is a featurable catalog, a usable history and an audience', () => {
    expect(strategyFrom(parts({ catalog: [] }), start, now)).toBeNull()
    expect(
      strategyFrom(
        parts({
          catalog: [product({ featurable: false, hiddenReason: 'no_image' })]
        }),
        start,
        now
      )
    ).toBeNull()
    expect(strategyFrom(parts({ history: null }), start, now)).toBeNull()
    expect(
      strategyFrom(parts({ history: stored({ state: 'empty' }) }), start, now)
    ).toBeNull()
    expect(
      strategyFrom(
        parts({ history: stored({}, { audiences: false }) }),
        start,
        now
      )
    ).toBeNull()
  })
})

describe('historyUsable (ONB-057a)', () => {
  it('takes a ready history read in full in the last few days', () => {
    expect(historyFreshDays).toBe(3)
    expect(historyUsable(stored(), now)).toBe(true)
    expect(historyUsable(stored({ readAt: '2026-11-12T13:00:00Z' }), now)).toBe(
      true
    )
  })

  it('refuses one that is stale, stopped, cut short or missing a part the plan needs', () => {
    expect(historyUsable(null, now)).toBe(false)
    expect(historyUsable(stored({ readAt: '2026-11-12T11:00:00Z' }), now)).toBe(
      false
    )
    expect(historyUsable(stored({ readAt: '2026-11-16T00:00:00Z' }), now)).toBe(
      false
    )
    expect(historyUsable(stored({ readAt: 'not a date' }), now)).toBe(false)
    expect(historyUsable(stored({ state: 'paused' }), now)).toBe(false)
    expect(historyUsable(stored({ complete: false }), now)).toBe(false)
    for (const part of ['sent', 'scheduled', 'audiences'] as const)
      expect(historyUsable(stored({}, { parts: { [part]: false } }), now)).toBe(
        false
      )
  })
})

describe('industryFrom (ONB-057a)', () => {
  it('names the industry on the fixed list, from the surest offering finding', () => {
    expect(
      industryFrom([
        offering('Scented candles', 0.4),
        offering('Vitamin C serums for dull skin', 0.8)
      ])
    ).toEqual({ key: 'skincare', words: 'Vitamin C serums for dull skin' })
    expect(industryFrom([])).toEqual({ key: 'other', words: '' })
    expect(industryFrom([offering('Mystery boxes')]).key).toBe('other')
  })

  it('never takes the sample rules’ finding for a live history', () => {
    const findings = [
      offering('Dog treats', 0.9, 'sample'),
      offering('Scented candles', 0.5)
    ]
    expect(industryFrom(findings).key).toBe('pet')
    expect(industryFrom(findings, { live: true }).key).toBe('home')
  })
})

describe('onboardedStrategyData (ONB-057a)', () => {
  const sampleAnswer = {
    sample: true,
    pulse: 'S',
    mapper: 'S',
    plan: 'S'
  } as never
  const sample = { load: vi.fn(async () => sampleAnswer) }
  const profileEq = vi.fn()
  const db = (profile: { data: unknown; error: unknown }) =>
    ({
      from: (table: string) => {
        expect(table).toBe('brand_profiles')
        return {
          select: () => ({
            eq: (column: string, value: string) => {
              profileEq(column, value)
              return { maybeSingle: async () => profile }
            }
          })
        }
      }
    }) as never
  const load = (
    profile: { data: { brand_name: string } | null; error: unknown } = {
      data: { brand_name: 'Linen & Co' },
      error: null
    }
  ) =>
    onboardedStrategyData(db(profile), {
      fallback: sample,
      now: () => now
    }).load({
      tenantId,
      start
    })
  beforeEach(() => {
    vi.clearAllMocks()
    reads.timezone.mockResolvedValue('America/New_York')
    reads.catalog.mockResolvedValue(parts().catalog)
    reads.history.mockResolvedValue(stored())
    reads.findings.mockResolvedValue(parts().findings)
    reads.keyDates.mockResolvedValue({
      country: 'US',
      countrySource: 'saved',
      dates: parts().keyDates
    })
  })

  it('reads only this workspace and plans from it', async () => {
    const own = await load()
    expect(own.sample).toBe(false)
    expect(sample.load).not.toHaveBeenCalled()
    expect(reads.timezone).toHaveBeenCalledWith(expect.anything(), tenantId)
    expect(reads.catalog).toHaveBeenCalledWith(expect.anything(), tenantId, {
      featurableOnly: true
    })
    expect(reads.history).toHaveBeenCalledWith(expect.anything(), tenantId)
    expect(reads.findings).toHaveBeenCalledWith(expect.anything(), tenantId, {
      topic: 'offering'
    })
    expect(profileEq).toHaveBeenCalledWith('tenant_id', tenantId)
    expect(reads.keyDates).toHaveBeenCalledWith(expect.anything(), {
      tenantId,
      timezone: 'America/New_York',
      from: start,
      days: 15,
      // Key dates match the brand's own words.
      industry: 'Linen clothing for warm weather'
    })
  })

  it('hands back the sample store until there is enough', async () => {
    reads.history.mockResolvedValue(null)
    await expect(load({ data: null, error: null })).resolves.toBe(sampleAnswer)
    expect(sample.load).toHaveBeenCalledWith({ tenantId, start })
    reads.history.mockResolvedValue(stored({ readAt: '2026-10-01T00:00:00Z' }))
    await expect(load()).resolves.toBe(sampleAnswer)
  })

  it('throws when any read fails, so the step is tried again', async () => {
    for (const read of [
      'timezone',
      'catalog',
      'history',
      'findings'
    ] as const) {
      reads[read].mockRejectedValueOnce(new Error(`${read} down`))
      await expect(load()).rejects.toThrow(`${read} down`)
    }
    await expect(
      load({ data: null, error: { code: '42501' } as never })
    ).rejects.toMatchObject({
      code: '42501'
    })
    // Never a plan without the key dates (Black Friday, the owner's own days).
    reads.keyDates.mockResolvedValueOnce(null)
    await expect(load()).rejects.toMatchObject({ code: 'key_dates_unreadable' })
    expect(sample.load).not.toHaveBeenCalled()
  })
})
