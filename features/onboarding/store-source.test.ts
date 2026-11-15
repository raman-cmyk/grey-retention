import { describe, expect, it, vi } from 'vitest'
import type { StoreSource } from '@/features/email-build/ports'
import type { Correction } from '@/features/onboarding/brand-book-corrections'
import type { CatalogEntry } from '@/features/onboarding/catalog/read'
import { claimsSafetyPhrases } from '@/features/onboarding/claims-safety'
import type { Finding } from '@/features/onboarding/findings'

vi.mock('server-only', () => ({}))
const reads = vi.hoisted(() => ({
  timezone: vi.fn(async () => 'Australia/Sydney'),
  catalog: vi.fn(async () => [] as CatalogEntry[]),
  findings: vi.fn(async () => [] as Finding[]),
  corrections: vi.fn(async () => [] as Correction[])
}))
vi.mock('@/features/strategy/offers', () => ({
  workspaceTimezone: reads.timezone
}))
vi.mock('@/features/onboarding/catalog/read', async (real) => ({
  ...(await real<object>()),
  listCatalog: reads.catalog
}))
vi.mock('@/features/onboarding/findings', async (real) => ({
  ...(await real<object>()),
  listFindings: reads.findings
}))
vi.mock('@/features/onboarding/brand-book-corrections', async (real) => ({
  ...(await real<object>()),
  listCorrections: reads.corrections
}))

const { catalogReady, onboardedStoreSource, storeFrom } =
  await import('./store-source')

const tenantId = '00000000-0000-4000-8000-000000000101'
let n = 0
const entry = (amount: number, over: Partial<CatalogEntry> = {}) => {
  n++
  return {
    id: `p${n}`,
    externalId: `k${n}`,
    title: `Shirt ${n}`,
    url: `https://shop.example/p/${n}`,
    price: `$${amount.toFixed(2)}`,
    amount,
    currency: 'USD',
    compareAt: null,
    image: `https://shop.example/i/${n}.jpg`,
    featurable: true,
    hiddenReason: null,
    unitsSold30d: 0,
    unitsSold90d: 0,
    bestsellerRank: null,
    launchedAt: null,
    newArrival: false,
    stock: null,
    ...over
  } satisfies CatalogEntry
}
const found = (
  topic: string,
  value: Record<string, unknown>,
  over: Record<string, unknown> = {},
  page: string | null = null
) =>
  ({
    topic,
    value,
    source: 'site',
    statement: `${topic} statement`,
    evidence: {
      url: 'https://shop.example/page',
      quote: `${topic} quote`,
      ...(page ? { page } : {})
    },
    confidence: 0.9,
    pass: 'model',
    ...over
  }) as unknown as Finding
const correction = (over: Partial<Correction>): Correction => ({
  id: 'c1',
  section: 'facts.returnDays',
  original: null,
  action: 'replace',
  value: '60',
  createdAt: '2026-11-15T10:00:00Z',
  ...over
})
const parts = (over: Partial<Parameters<typeof storeFrom>[0]> = {}) => ({
  brandName: 'Cedar Lane',
  domain: 'Shop.Example',
  kit: { colors: ['#ffffff', '#111111', '#2a6f4e'], fonts: ['Inter'] },
  timezone: 'Australia/Sydney',
  status: { live: true, currency: 'USD' },
  catalog: [60, 75, 89, 95].map((a) => entry(a)),
  findings: [
    found('offering', {}, { statement: 'Vitamin supplements for runners' }),
    found('returns', { days: 30 }, {}, 'returns'),
    found(
      'free_shipping',
      { kind: 'over', amount: 75, currency: 'USD' },
      {},
      'shipping'
    )
  ],
  corrections: [],
  ...over
})

describe('storeFrom (ONB-057b part 2)', () => {
  it('builds from the store’s own products, brand, facts and industry', () => {
    const store = storeFrom(parts())
    expect(store.sample).toBe(false)
    expect(store.industry).toBe('supplements')
    expect(store.timezone).toBe('Australia/Sydney')
    expect(store.brand).toMatchObject({
      name: 'Cedar Lane',
      site: 'https://shop.example',
      font: 'Inter',
      background: '#ffffff',
      ink: '#111111',
      accent: '#2a6f4e'
    })
    expect(store.products.map((p) => p.title)).toEqual([
      'Shirt 1',
      'Shirt 2',
      'Shirt 3',
      'Shirt 4'
    ])
    expect(store.products[0]).toMatchObject({
      price: '$60.00',
      image: 'https://shop.example/i/1.jpg',
      url: 'https://shop.example/p/1',
      featurable: true
    })
    expect(store.facts).toMatchObject({
      returnDays: 30,
      freeShipping: { over: 75 },
      deliveryDays: null,
      guaranteeDays: null
    })
    // The industry's risky claims are banned for the writer.
    expect(store.facts.bannedPhrases).toEqual(
      expect.arrayContaining(claimsSafetyPhrases('supplements'))
    )
  })

  it('lets the owner’s correction win over what the readers found', () => {
    const store = storeFrom(
      parts({
        corrections: [
          correction({}),
          correction({
            id: 'c2',
            section: 'facts.freeShipping',
            action: 'remove',
            value: null
          })
        ]
      })
    )
    expect(store.facts.returnDays).toBe(60)
    expect(store.facts.freeShipping).toBeNull()
  })

  it('leaves out products without a photo, or with a price the check doubts', () => {
    const catalog = [
      ...[60, 75, 89, 95, 99].map((a) => entry(a)),
      entry(89, { image: null }),
      // Thirty times the usual price: a typo, never shown.
      entry(8900)
    ]
    const store = storeFrom(parts({ catalog }))
    expect(store.products).toHaveLength(5)
    expect(store.products.some((p) => p.price === '$8900.00')).toBe(false)
    expect(store.products.every((p) => p.image)).toBe(true)
  })

  it('shows no prices at all when the catalog is on another scale from the website', () => {
    const band = (min: number, max: number) =>
      found('price_band', { min, max, currency: 'USD' })
    const store = storeFrom(
      parts({
        // The website sells at about a hundredth of the catalog's prices.
        catalog: [6000, 7500, 8900, 9500, 9900].map((a) => entry(a)),
        findings: [band(50, 90), band(60, 100)]
      })
    )
    expect(store.products).toEqual([])
  })

  it('says it is the sample while the catalog came from the fake Klaviyo', () => {
    const store = storeFrom(
      parts({
        status: { live: false, currency: 'USD' },
        findings: [
          found(
            'offering',
            {},
            { statement: 'Linen clothing for travel', pass: 'sample' }
          )
        ]
      })
    )
    expect(store.sample).toBe(true)
    // The sample rules' own finding counts while nothing was read live.
    expect(store.industry).toBe('apparel')
  })

  it('never counts the sample rules’ findings for a live store', () => {
    const store = storeFrom(
      parts({
        findings: [
          found(
            'offering',
            {},
            { statement: 'Linen clothing for travel', pass: 'sample' }
          ),
          found('returns', { days: 30 }, { pass: 'sample' }, 'returns')
        ]
      })
    )
    expect(store.industry).toBe('other')
    expect(store.facts.returnDays).toBeNull()
  })

  it('has calm defaults for a brand with no kit, name or valid site', () => {
    const store = storeFrom(
      parts({ brandName: '  ', domain: 'not a domain', kit: null })
    )
    expect(store.brand).toMatchObject({
      name: 'Your brand',
      site: '',
      font: '',
      background: '#fafafa',
      ink: '#121212'
    })
  })
})

describe('catalogReady (ONB-057b part 2)', () => {
  it('is ready only for a finished read with products to feature', () => {
    expect(catalogReady({ state: 'ready', featurable: 3 })).toBe(true)
    expect(catalogReady({ state: 'ready', featurable: 0 })).toBe(false)
    expect(catalogReady({ state: 'reading', featurable: 3 })).toBe(false)
    expect(catalogReady(null)).toBe(false)
  })
})

describe('onboardedStoreSource (ONB-057b part 2)', () => {
  type Answer = { data: unknown; error: unknown }
  function fakeDb(answers: Record<string, Answer>) {
    const asked: [string, ...unknown[]][] = []
    const from = (table: string) => {
      const chain = {
        select: (cols: string) => (asked.push([table, cols]), chain),
        eq: (...a: unknown[]) => (asked.push([table, 'eq', ...a]), chain),
        maybeSingle: async () => answers[table] ?? { data: null, error: null }
      }
      return chain
    }
    return { db: { from } as never, asked }
  }
  const fallback = () => {
    const read = vi.fn(async () => ({ sample: true }) as never)
    return { source: { read } satisfies StoreSource, read }
  }
  const ready = {
    data: { state: 'ready', featurable: 4, live: true, currency: 'USD' },
    error: null
  }

  it('uses the sample until the catalog has been read, reading nothing else', async () => {
    for (const status of [
      { data: null, error: null },
      { data: { ...ready.data, state: 'reading' }, error: null },
      { data: { ...ready.data, featurable: 0 }, error: null }
    ]) {
      const { db, asked } = fakeDb({ catalog_status: status })
      const sample = fallback()
      reads.catalog.mockClear()
      await expect(
        onboardedStoreSource(db, { fallback: sample.source }).read(tenantId)
      ).resolves.toEqual({ sample: true })
      expect(sample.read).toHaveBeenCalledWith(tenantId)
      expect(asked.every(([table]) => table === 'catalog_status')).toBe(true)
      expect(reads.catalog).not.toHaveBeenCalled()
    }
  })

  it('reads the workspace’s own store once the catalog is ready', async () => {
    reads.catalog.mockResolvedValueOnce([...parts().catalog])
    reads.findings.mockResolvedValueOnce([...parts().findings])
    reads.corrections.mockResolvedValueOnce([correction({})])
    const { db, asked } = fakeDb({
      catalog_status: ready,
      brand_profiles: {
        data: { brand_name: 'Cedar Lane', domain: 'shop.example' },
        error: null
      },
      brand_kits: { data: parts().kit, error: null }
    })
    const sample = fallback()
    const store = await onboardedStoreSource(db, {
      fallback: sample.source
    }).read(tenantId)
    expect(sample.read).not.toHaveBeenCalled()
    expect(store).toMatchObject({
      sample: false,
      industry: 'supplements',
      brand: { name: 'Cedar Lane', site: 'https://shop.example' }
    })
    expect(store.facts.returnDays).toBe(60)
    expect(store.products).toHaveLength(4)
    expect(reads.catalog).toHaveBeenCalledWith(db, tenantId, {
      featurableOnly: true
    })
    expect(reads.findings).toHaveBeenCalledWith(db, tenantId)
    expect(reads.corrections).toHaveBeenCalledWith(db, tenantId)
    // Every read is this workspace's.
    expect(asked.filter((a) => a[1] === 'eq')).toEqual([
      ['catalog_status', 'eq', 'tenant_id', tenantId],
      ['brand_profiles', 'eq', 'tenant_id', tenantId],
      ['brand_kits', 'eq', 'tenant_id', tenantId]
    ])
  })

  it('throws a read that fails, never falling back to the sample', async () => {
    const failed = { data: null, error: { code: 'PGRST000' } }
    for (const answers of [
      { catalog_status: failed } as Record<string, Answer>,
      { catalog_status: ready, brand_profiles: failed },
      { catalog_status: ready, brand_kits: failed }
    ]) {
      const sample = fallback()
      await expect(
        onboardedStoreSource(fakeDb(answers).db, {
          fallback: sample.source
        }).read(tenantId)
      ).rejects.toMatchObject({ code: 'PGRST000' })
      expect(sample.read).not.toHaveBeenCalled()
    }
    reads.corrections.mockRejectedValueOnce({ code: 'too_many_corrections' })
    await expect(
      onboardedStoreSource(fakeDb({ catalog_status: ready }).db, {
        fallback: fallback().source
      }).read(tenantId)
    ).rejects.toMatchObject({ code: 'too_many_corrections' })
  })
})
