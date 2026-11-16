import { describe, expect, it, vi } from 'vitest'
import type { Correction } from '@/features/onboarding/brand-book-corrections'
import type { CatalogEntry } from '@/features/onboarding/catalog/read'
import { claimsSafetyPhrases } from '@/features/onboarding/claims-safety'
import type { Finding } from '@/features/onboarding/findings'
import { sampleStoreFrom } from '@/features/email-build/ports'

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

const {
  correctedIndustry,
  ownStoreSource,
  planStore,
  storeForPlan,
  storeFrom
} = await import('./store-source')

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
const sells = (statement: string, over: Record<string, unknown> = {}) =>
  found('offering', {}, { statement, ...over })
const said = (quote: string) =>
  ({
    topic: 'customer_words',
    source: 'reviews',
    statement: 'Customers say the fabric feels soft.',
    value: {},
    evidence: { url: 'https://shop.example/p/1', quote },
    confidence: 0.8,
    pass: 'model'
  }) as unknown as Finding
const band = (min: number, max: number, pass = 'model') =>
  found('price_band', { min, max, currency: 'USD' }, { pass })
let c = 0
const correction = (over: Partial<Correction>): Correction => ({
  id: `c${++c}`,
  section: 'facts.returnDays',
  original: null,
  action: 'replace',
  value: '60',
  createdAt: '2026-11-15T10:00:00Z',
  ...over
})
type Parts = Parameters<typeof storeFrom>[0]
const parts = (over: Partial<Parts> = {}): Parts => ({
  brandName: 'Cedar Lane',
  domain: 'Shop.Example',
  kit: { colors: ['#ffffff', '#111111', '#2a6f4e'], fonts: ['Inter'] },
  timezone: 'Australia/Sydney',
  status: { live: true, currency: 'USD' },
  catalog: [60, 75, 89, 95].map((a) => entry(a)),
  findings: [
    sells('Vitamin supplements for runners'),
    found('returns', { days: 30 }, {}, 'returns'),
    found(
      'free_shipping',
      { kind: 'over', amount: 75, currency: 'USD' },
      {},
      'shipping'
    ),
    said('the fabric is so soft')
  ],
  corrections: [],
  ...over
})

describe('the same store read again (REL-STO)', () => {
  it('gives the same store, and so the same fingerprint, when its findings and catalog come back in another order', async () => {
    const { storeFingerprint } = await import('@/features/email-build/steps')
    // Two equally sure lines of what the brand sells: the read order must
    // not pick the industry (nor its claims list).
    const tied = [
      sells('Hand-poured soy candles and home fragrance'),
      sells('Organic skincare serums and face creams')
    ]
    const first = parts({ findings: [...tied, ...parts().findings] })
    const again = parts({
      findings: [...first.findings].reverse(),
      catalog: [...first.catalog].reverse()
    })
    const a = storeFrom(first)
    const b = storeFrom(again)
    expect(b.industry).toBe(a.industry)
    expect(b.facts).toEqual(a.facts)
    expect(storeFingerprint(b)).toBe(storeFingerprint(a))
  })
})

describe('storeFrom (ONB-057b part 2)', () => {
  it('builds from the store’s own products, brand, facts, industry and customer words', () => {
    const given = parts()
    const store = storeFrom(given)
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
    expect(store.products.map((p) => p.title)).toEqual(
      given.catalog.map((e) => e.title)
    )
    expect(store.products[0]).toMatchObject({
      price: '$60.00',
      image: given.catalog[0]!.image,
      url: given.catalog[0]!.url,
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
    expect(store.customerWords).toEqual(['the fabric is so soft'])
  })

  it('lets the owner’s correction win over what the readers found', () => {
    const store = storeFrom(
      parts({
        corrections: [
          correction({}),
          correction({
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

  it('takes the industry from what the brand sells as the owner corrected it', () => {
    const findings = [
      sells('Vitamin supplements for runners'),
      sells('Linen clothing for travel', { confidence: 0.7 })
    ]
    const store = storeFrom(
      parts({
        findings,
        corrections: [
          correction({
            section: 'offering',
            original: 'vitamin  supplements for runners',
            action: 'replace',
            value: 'Linen dresses for summer'
          })
        ]
      })
    )
    expect(correctedIndustry(findings, [])).toBe('supplements')
    expect(store.industry).toBe('apparel')
    // His own added line comes first; a removed line gives way to the next.
    expect(
      correctedIndustry(findings, [
        correction({
          section: 'offering',
          action: 'add',
          value: 'Linen clothing for travel and home.'
        })
      ])
    ).toBe('apparel')
    expect(
      correctedIndustry(findings, [
        correction({
          section: 'offering',
          original: 'Vitamin supplements for runners',
          action: 'remove',
          value: null
        })
      ])
    ).toBe('apparel')
    expect(correctedIndustry([], [])).toBe('other')
  })

  it('leaves out products without a photo, or with a price the check doubts', () => {
    const catalog = [
      ...[60, 75, 89, 95, 99].map((a) => entry(a)),
      entry(89, { image: null }),
      // A hundred times the usual price: a typo, never shown.
      entry(8900)
    ]
    const store = storeFrom(parts({ catalog }))
    expect(store.products).toHaveLength(5)
    expect(store.products.some((p) => p.price === '$8900.00')).toBe(false)
    expect(store.products.every((p) => p.image)).toBe(true)
  })

  it('shows no prices at all when the catalog is on another scale from the website', () => {
    const store = storeFrom(
      parts({
        // The website sells at about a hundredth of the catalog's prices.
        catalog: [6000, 7500, 8900, 9500, 9900].map((a) => entry(a)),
        findings: [band(50, 90), band(60, 100)]
      })
    )
    expect(store.products).toEqual([])
  })

  it('never counts the sample rules’ findings for a live store, its prices included', () => {
    const store = storeFrom(
      parts({
        catalog: [6000, 7500, 8900, 9500, 9900].map((a) => entry(a)),
        findings: [
          sells('Linen clothing for travel', { pass: 'sample' }),
          found('returns', { days: 30 }, { pass: 'sample' }, 'returns'),
          // The sample's price levels would make this catalog look 100x off.
          band(50, 90, 'sample'),
          band(60, 100, 'sample')
        ]
      })
    )
    expect(store.industry).toBe('other')
    expect(store.facts.returnDays).toBeNull()
    expect(store.products).toHaveLength(5)
  })

  it('says it is the sample while the catalog came from the fake Klaviyo', () => {
    const fake = { live: false, currency: 'USD' }
    const sampleOnly = storeFrom(
      parts({
        status: fake,
        findings: [sells('Linen clothing for travel', { pass: 'sample' })]
      })
    )
    expect(sampleOnly.sample).toBe(true)
    // The sample rules' own finding counts while nothing was read live.
    expect(sampleOnly.industry).toBe('apparel')
    // A model's finding means a live read: the sample rules' no longer count.
    const mixed = storeFrom(
      parts({
        status: fake,
        findings: [
          sells('Linen clothing for travel', { pass: 'sample' }),
          sells('Vitamin supplements for runners', { confidence: 0.5 })
        ]
      })
    )
    expect(mixed.sample).toBe(true)
    expect(mixed.industry).toBe('supplements')
  })

  it('uses no free-shipping amount when the store’s currency is not known', () => {
    const store = storeFrom(parts({ status: { live: true, currency: null } }))
    expect(store.facts.freeShipping).toBeNull()
    expect(store.facts.returnDays).toBe(30)
  })

  it('shows the logos the Site reader kept from this same website (ONB-060b)', () => {
    const logos = {
      domain: 'shop.example',
      onLight: 'https://cdn.example/logo-dark.png',
      onDark: 'https://cdn.example/logo-white.png'
    }
    expect(storeFrom(parts({ logos })).brand).toMatchObject({
      logo: 'https://cdn.example/logo-dark.png',
      logoOnDark: 'https://cdn.example/logo-white.png'
    })
    // Its www. address is the same website.
    expect(
      storeFrom(parts({ domain: 'www.shop.example', logos })).brand.logo
    ).toBe('https://cdn.example/logo-dark.png')
    // Only one found: the other stays unset (the name is shown there).
    const light = storeFrom(parts({ logos: { ...logos, onDark: null } }))
    expect(light.brand.logoOnDark).toBeUndefined()
    // A picture Klaviyo cannot import is never shown.
    expect(
      storeFrom(
        parts({
          logos: { ...logos, onLight: 'https://cdn.example/logo-dark.svg' }
        })
      ).brand.logo
    ).toBeUndefined()
    // Read from the website before the owner changed it: none.
    for (const brand of [
      storeFrom(parts({ domain: 'new-shop.example', logos })).brand,
      storeFrom(parts({ domain: 'not a domain', logos })).brand,
      storeFrom(parts({ logos: null })).brand
    ]) {
      expect(brand.logo).toBeUndefined()
      expect(brand.logoOnDark).toBeUndefined()
    }
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

  it('gives "Create email" the store’s own reviews, from this website only, and nothing the sample store has (REL-ONB2)', async () => {
    const cosy = 'So cosy on cold mornings, and it washes well.'
    const started = 'We started Cedar Lane in a small workshop in 2016.'
    const page = 'https://shop.example/p/1'
    const material = [
      found(
        'review_platform',
        { name: 'Judge.me', verified: true },
        {
          source: 'reviews'
        }
      ),
      found(
        'quotable_review',
        { author: 'Priya Shah', url: page, rating: 5 },
        {
          source: 'reviews',
          evidence: { url: page, quote: cosy }
        }
      ),
      found(
        'offering',
        {},
        {
          evidence: {
            url: 'https://www.shop.example/pages/about',
            quote: started,
            page: 'about'
          }
        }
      )
    ]
    const own = (over: Partial<Parts> = {}) =>
      storeFrom(
        parts({ findings: [...parts().findings, ...material], ...over })
      )
    // The about page's words are no founder's note (part a has none).
    expect(own().confirmed).toEqual({
      reviews: [{ quote: cosy, author: 'Priya S.', rating: 5 }]
    })
    // Read before the owner changed his website, or none: no material.
    for (const domain of ['new-shop.example', 'not a domain'])
      expect(own({ domain })).not.toHaveProperty('confirmed')
    expect(storeFrom(parts())).not.toHaveProperty('confirmed')
    // The sample store keeps none.
    expect(
      await sampleStoreFrom('2026-11-16').read(tenantId)
    ).not.toHaveProperty('confirmed')
  })
})

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
const failed = { data: null, error: { code: 'PGRST000' } }

describe('ownStoreSource (ONB-057b part 2)', () => {
  const status = (over: Record<string, unknown> = {}): Answer => ({
    data: { live: true, currency: 'USD', ...over },
    error: null
  })
  const own = {
    brand_profiles: {
      data: { brand_name: 'Cedar Lane', domain: 'shop.example' },
      error: null
    },
    brand_kits: { data: parts().kit, error: null },
    brand_logos: {
      data: {
        domain: 'shop.example',
        on_light: 'https://cdn.example/logo.png',
        on_dark: null
      },
      error: null
    }
  }

  it('reads the workspace’s own store, only its own rows', async () => {
    reads.catalog.mockResolvedValueOnce([...parts().catalog])
    reads.findings.mockResolvedValueOnce([...parts().findings])
    reads.corrections.mockResolvedValueOnce([correction({})])
    const { db, asked } = fakeDb({ catalog_status: status(), ...own })
    const store = await ownStoreSource(db).read(tenantId)
    expect(store).toMatchObject({
      sample: false,
      industry: 'supplements',
      brand: {
        name: 'Cedar Lane',
        site: 'https://shop.example',
        logo: 'https://cdn.example/logo.png'
      }
    })
    expect(store.brand.logoOnDark).toBeUndefined()
    expect(store.facts.returnDays).toBe(60)
    expect(store.products).toHaveLength(4)
    // A live store never shows the fake Klaviyo's products.
    expect(reads.catalog).toHaveBeenLastCalledWith(db, tenantId, {
      featurableOnly: true,
      synthetic: false
    })
    expect(reads.findings).toHaveBeenCalledWith(db, tenantId)
    expect(reads.corrections).toHaveBeenCalledWith(db, tenantId)
    expect(asked.filter((a) => a[1] === 'eq')).toEqual([
      ['catalog_status', 'eq', 'tenant_id', tenantId],
      ['brand_profiles', 'eq', 'tenant_id', tenantId],
      ['brand_kits', 'eq', 'tenant_id', tenantId],
      ['brand_logos', 'eq', 'tenant_id', tenantId],
      ['klaviyo_history', 'eq', 'tenant_id', tenantId]
    ])
  })

  it('gives the subject line lab the store’s past subjects, from the same account as its catalog (PIC-26 part 2)', async () => {
    const sentEmail = {
      id: 'MsgA01',
      campaignId: 'CmpA01',
      name: null,
      subject: 'Ready for the weekend?',
      preview: null,
      sentAt: '2026-10-01T10:00:00.000Z',
      offer: false,
      collecting: false,
      abTest: false,
      strategy: 'static',
      recipients: 900,
      opens: 300,
      clicks: 20,
      orders: 1,
      revenue: 50,
      revenuePerRecipient: 0.05,
      openRate: 0.33,
      clickRate: 0.02,
      unsubscribeRate: 0
    }
    const snapshot = {
      currency: 'USD',
      timezone: 'UTC',
      sendsPerWeek: 1,
      usualSendTime: '10:00',
      sent: [sentEmail],
      scheduled: [],
      flows: [],
      audiences: [],
      flowsRead: true,
      window: { sentDays: 365, sentCap: 300, flowDays: 90 },
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
    }
    const history = (live: boolean) => ({
      data: { live, sent: snapshot.sent },
      error: null
    })
    const live = fakeDb({
      catalog_status: status(),
      ...own,
      klaviyo_history: history(true)
    })
    expect((await ownStoreSource(live.db).read(tenantId)).pastSubjects).toEqual(
      [{ subject: 'Ready for the weekend?', recipients: 900, openRate: 0.33 }]
    )
    // Only the sent emails of the history are read, never the whole snapshot.
    expect(live.asked).toContainEqual([
      'klaviyo_history',
      'live,sent:snapshot->sent'
    ])
    // A live store never learns from the sample account's emails.
    const sampled = fakeDb({
      catalog_status: status(),
      ...own,
      klaviyo_history: history(false)
    })
    expect(
      (await ownStoreSource(sampled.db).read(tenantId)).pastSubjects
    ).toBeUndefined()
    // An unreadable history leaves the lab to its rules of thumb.
    const broken = fakeDb({
      catalog_status: status(),
      ...own,
      klaviyo_history: failed
    })
    expect(
      (await ownStoreSource(broken.db).read(tenantId)).pastSubjects
    ).toBeUndefined()
  })

  it('reads only the fake Klaviyo’s products while the catalog was read fake', async () => {
    const { db } = fakeDb({ catalog_status: status({ live: false }) })
    const store = await ownStoreSource(db).read(tenantId)
    expect(store.sample).toBe(true)
    expect(reads.catalog).toHaveBeenLastCalledWith(db, tenantId, {
      featurableOnly: true,
      synthetic: true
    })
    // No brand rows yet: calm defaults.
    expect(store.brand).toMatchObject({ name: 'Your brand', site: '' })
  })

  it('has no store for a workspace whose catalog was never read, reading nothing else', async () => {
    reads.catalog.mockClear()
    const { db, asked } = fakeDb({})
    await expect(ownStoreSource(db).read(tenantId)).rejects.toMatchObject({
      code: 'plan_store_changed'
    })
    expect(asked.every(([table]) => table === 'catalog_status')).toBe(true)
    expect(reads.catalog).not.toHaveBeenCalled()
  })

  it('shows the name when the logos cannot be read, never failing "Create email"', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    reads.catalog.mockResolvedValueOnce([...parts().catalog])
    reads.findings.mockResolvedValueOnce([...parts().findings])
    reads.corrections.mockResolvedValueOnce([])
    const { db } = fakeDb({
      catalog_status: status(),
      ...own,
      brand_logos: failed
    })
    const store = await ownStoreSource(db).read(tenantId)
    expect(store.brand.logo).toBeUndefined()
    expect(store.brand.name).toBe('Cedar Lane')
    expect(JSON.stringify(warn.mock.calls)).toContain('Brand logos unreadable')
  })

  it('throws a read that fails', async () => {
    for (const answers of [
      { catalog_status: failed } as Record<string, Answer>,
      { catalog_status: status(), brand_profiles: failed },
      { catalog_status: status(), brand_kits: failed }
    ])
      await expect(
        ownStoreSource(fakeDb(answers).db).read(tenantId)
      ).rejects.toMatchObject({ code: 'PGRST000' })
    reads.corrections.mockRejectedValueOnce({ code: 'too_many_corrections' })
    await expect(
      ownStoreSource(fakeDb({ catalog_status: status() }).db).read(tenantId)
    ).rejects.toMatchObject({ code: 'too_many_corrections' })
  })
})

describe('storeForPlan (ONB-057b part 2)', () => {
  it('builds a plan made from the sample on the sample store, whatever the catalog', async () => {
    const { db, asked } = fakeDb({
      catalog_status: { data: { live: true, currency: 'USD' }, error: null }
    })
    const store = await storeForPlan(
      db,
      { own: false, sample: true },
      '2026-11-16'
    ).read(tenantId)
    expect(store.sample).toBe(true)
    expect(store.products.length).toBeGreaterThan(0)
    expect(asked).toEqual([])
  })

  it('builds a plan made from the workspace’s own data on its own store', async () => {
    const { db, asked } = fakeDb({
      catalog_status: { data: { live: true, currency: 'USD' }, error: null }
    })
    const store = await storeForPlan(
      db,
      { own: true, sample: false },
      '2026-11-16'
    ).read(tenantId)
    expect(store.sample).toBe(false)
    expect(asked[0]).toEqual(['catalog_status', 'live,currency'])
  })
})

describe('planStore (ONB-057b part 2)', () => {
  const job = { tenant_id: tenantId, run_id: 'run-1' }
  it('reads this workspace’s plan, and counts a plan without the flags as the sample store’s', async () => {
    const plan = (data: unknown) =>
      fakeDb({ strategy_runs: { data, error: null } }).db
    expect(await planStore(plan({ own: true, sample: false }), job)).toEqual({
      own: true,
      sample: false
    })
    expect(await planStore(plan({ own: true, sample: true }), job)).toEqual({
      own: true,
      sample: true
    })
    expect(await planStore(plan({ own: null, sample: null }), job)).toEqual({
      own: false,
      sample: true
    })
    const missing = fakeDb({})
    expect(await planStore(missing.db, job)).toEqual({
      own: false,
      sample: true
    })
    expect(missing.asked).toEqual([
      ['strategy_runs', 'own:plan->own,sample:plan->sample'],
      ['strategy_runs', 'eq', 'tenant_id', tenantId],
      ['strategy_runs', 'eq', 'id', 'run-1']
    ])
    await expect(
      planStore(fakeDb({ strategy_runs: failed }).db, job)
    ).rejects.toMatchObject({ code: 'PGRST000' })
  })
})
