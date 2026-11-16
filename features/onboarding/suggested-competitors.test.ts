import { describe, expect, it, vi } from 'vitest'
import type { Finding } from './findings'

vi.mock('server-only', () => ({}))
const reads = vi.hoisted(() => ({ findings: vi.fn(), corrections: vi.fn() }))
vi.mock('@/features/onboarding/findings', async (original) => ({
  ...(await original<typeof import('@/features/onboarding/findings')>()),
  listFindings: reads.findings
}))
vi.mock('@/features/onboarding/brand-book-corrections', async (original) => ({
  ...(await original<
    typeof import('@/features/onboarding/brand-book-corrections')
  >()),
  listCorrections: reads.corrections
}))

const {
  brandIndustry,
  hostOf,
  maxSuggestions,
  readCompetitorSuggestions,
  setBrandHidden,
  suggestCompetitors
} = await import('./suggested-competitors')
type InboxBrand = Parameters<typeof brandIndustry>[0]

let n = 0
const brand = (over: Partial<InboxBrand> = {}): InboxBrand => {
  n++
  return {
    id: `b${n}`,
    domain: `brand${n}.example`,
    name: `Brand ${n}`,
    niche: 'Dog treats',
    synthetic: false,
    subscriptionStatus: 'subscribed',
    lastReceivedAt: '2026-11-14T10:00:00Z',
    recent: 2,
    labelled: {},
    ...over
  }
}
const base = {
  industry: 'pet' as const,
  ownDomain: 'mystore.example',
  live: true
}

describe('brandIndustry (ONB-065a)', () => {
  it('takes what most of its labelled emails say, else its niche', () => {
    expect(brandIndustry(brand({ labelled: { pet: 3, home: 1 } }))).toBe('pet')
    // Labels outvote the niche once there are enough of them.
    expect(
      brandIndustry(brand({ niche: 'Dog treats', labelled: { home: 3 } }))
    ).toBe('home')
    // Too few, or no clear majority: the niche decides.
    expect(brandIndustry(brand({ labelled: { home: 1 } }))).toBe('pet')
    expect(brandIndustry(brand({ labelled: { home: 2, kitchen: 2 } }))).toBe(
      'pet'
    )
    expect(brandIndustry(brand({ labelled: { other: 5 } }))).toBe('pet')
    expect(brandIndustry(brand({ niche: null, labelled: {} }))).toBeNull()
    // Whole words, as the store's own are read: never "hair" in "chairs".
    expect(brandIndustry(brand({ niche: 'Pet accessories' }))).toBe('pet')
    expect(brandIndustry(brand({ niche: 'Chairs' }))).not.toBe('haircare')
  })
})

describe('suggestCompetitors (ONB-065a)', () => {
  it('suggests brands of the same industry, those sending most lately first, with a plain reason', () => {
    const busy = brand({ name: 'Bark Co', recent: 6 })
    const quiet = brand({ name: null, domain: 'quiet.example', recent: 0 })
    const once = brand({ recent: 1 })
    const candles = brand({ niche: 'Scented candles', recent: 9 })
    expect(
      suggestCompetitors({ ...base, brands: [quiet, candles, once, busy] })
    ).toEqual([
      {
        captureId: busy.id,
        domain: busy.domain,
        name: 'Bark Co',
        industry: 'pet',
        reason: 'Also a pet brand, and sent 6 emails in the last 30 days.'
      },
      {
        captureId: once.id,
        domain: once.domain,
        name: once.name,
        industry: 'pet',
        reason: 'Also a pet brand, and sent one email in the last 30 days.'
      },
      {
        captureId: quiet.id,
        domain: 'quiet.example',
        name: 'quiet.example',
        industry: 'pet',
        reason: 'Also a pet brand.'
      }
    ])
  })

  it('never suggests the store itself, one the inbox does not get, or the other kind', () => {
    const own = brand({ domain: 'WWW.MyStore.example' })
    const shop = brand({ domain: 'shop.mystore.example' })
    const pending = brand({ subscriptionStatus: 'pending' })
    const sample = brand({ synthetic: true })
    const good = brand()
    const got = suggestCompetitors({
      ...base,
      brands: [own, shop, pending, sample, good]
    })
    expect(got.map((s) => s.captureId)).toEqual([good.id])
    // Saved as a link, or with a shop subdomain: still its own website.
    for (const ownDomain of [
      'https://www.mystore.example/collections/all',
      'shop.mystore.example'
    ])
      expect(
        suggestCompetitors({ ...base, ownDomain, brands: [own, good] }).map(
          (s) => s.captureId
        )
      ).toEqual([good.id])
    // The sample store gets only sample brands.
    expect(
      suggestCompetitors({
        ...base,
        live: false,
        brands: [own, sample, good]
      }).map((s) => s.captureId)
    ).toEqual([sample.id])
  })

  it('keeps to ten, in a steady order, and suggests nothing for "other"', () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      brand({ recent: 3, domain: `z${String(i).padStart(2, '0')}.example` })
    )
    const got = suggestCompetitors({ ...base, brands: many })
    expect(got).toHaveLength(maxSuggestions)
    expect(got[0]!.domain).toBe('z00.example')
    expect(
      suggestCompetitors({ ...base, brands: [...many].reverse() })
    ).toEqual(got)
    expect(
      suggestCompetitors({ ...base, industry: 'other', brands: many })
    ).toEqual([])
    // Words for two-word industries.
    expect(
      suggestCompetitors({
        ...base,
        industry: 'food_drink',
        brands: [
          brand({
            niche: 'Coffee and snacks',
            labelled: { food_drink: 4 },
            recent: 0
          })
        ]
      })[0]?.reason
    ).toBe('Also a food and drink brand.')
    // "an" before a vowel.
    expect(
      suggestCompetitors({
        ...base,
        industry: 'apparel',
        brands: [
          brand({ niche: 'Activewear basics', labelled: { apparel: 3 } })
        ]
      })[0]?.reason
    ).toBe('Also an apparel brand, and sent 2 emails in the last 30 days.')
    expect(
      suggestCompetitors({
        ...base,
        industry: 'outdoor',
        brands: [brand({ niche: 'Camping gear', recent: 0 })]
      })[0]?.reason
    ).toBe('Also an outdoor brand.')
  })

  it('reads a website from a bare domain or a link', () => {
    expect(hostOf(' https://WWW.MyStore.com/shop?x=1 ')).toBe('mystore.com')
    expect(hostOf('mystore.com:443')).toBe('mystore.com')
    expect(hostOf('www.mystore.com')).toBe('mystore.com')
    expect(hostOf('')).toBe('')
  })
})

describe('readCompetitorSuggestions (ONB-065a)', () => {
  const tenantId = '00000000-0000-4000-8000-000000000101'
  type Answer = { data: unknown; error: unknown }
  function fakeDb(answers: Record<string, Answer>) {
    const asked: [string, ...unknown[]][] = []
    const from = (table: string) => {
      const chain: Record<string, unknown> = {}
      for (const op of ['select', 'eq'])
        chain[op] = (...a: unknown[]) => (asked.push([table, op, ...a]), chain)
      chain.maybeSingle = async () => answers[table]
      return chain
    }
    const rpc = async (name: string, args: unknown) => (
      asked.push([name, args]),
      answers[name]
    )
    return { db: { from, rpc } as never, asked }
  }
  const offering = {
    topic: 'offering',
    statement: 'Dog treats and toys',
    confidence: 0.9,
    pass: 'model',
    source: 'site'
  } as unknown as Finding
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'b1',
    domain: 'bark.example',
    brand_name: 'Bark Co',
    niche: 'Dog treats',
    synthetic: false,
    last_received_at: '2026-11-14T10:00:00Z',
    recent: 3,
    labels: {},
    ...over
  })
  const store = (over: Record<string, Answer> = {}) =>
    fakeDb({
      brand_profiles: {
        data: { domain: 'mystore.example', synthetic: false },
        error: null
      },
      suggestable_inbox_brands: {
        data: [
          row(),
          row({
            id: 'b2',
            domain: 'wick.example',
            brand_name: 'Wick',
            niche: 'Scented candles',
            recent: 1
          })
        ],
        error: null
      },
      ...over
    })

  it('reads the workspace’s own rows and asks the database for the inbox’s brands', async () => {
    reads.findings.mockResolvedValue([offering])
    reads.corrections.mockResolvedValue([])
    const { db, asked } = store({
      suggestable_inbox_brands: {
        data: [
          row({
            niche: 'Home goods',
            // Its emails say pet, whatever its niche says; unknown labels
            // and odd counts are ignored.
            labels: { pet: 2, unicorns: 9, home: 'x', baby: -1 }
          }),
          // A brand with no name, niche or email yet.
          row({
            id: 'b3',
            domain: 'quiet.example',
            brand_name: null,
            niche: null,
            last_received_at: null,
            recent: 0,
            labels: { pet: 2 }
          })
        ],
        error: null
      }
    })
    const got = await readCompetitorSuggestions(db, tenantId, {
      service: db,
      now: new Date('2026-11-15T12:00:00Z')
    })
    expect(got).toEqual([
      {
        captureId: 'b1',
        domain: 'bark.example',
        name: 'Bark Co',
        industry: 'pet',
        reason: 'Also a pet brand, and sent 3 emails in the last 30 days.'
      },
      {
        captureId: 'b3',
        domain: 'quiet.example',
        name: 'quiet.example',
        industry: 'pet',
        reason: 'Also a pet brand.'
      }
    ])
    expect(reads.findings).toHaveBeenCalledWith(db, tenantId, {
      topic: 'offering'
    })
    expect(reads.corrections).toHaveBeenCalledWith(db, tenantId)
    expect(asked).toContainEqual([
      'brand_profiles',
      'eq',
      'tenant_id',
      tenantId
    ])
    expect(asked).toContainEqual([
      'suggestable_inbox_brands',
      { t: tenantId, since: '2026-10-16T12:00:00.000Z' }
    ])
  })

  it('takes the store’s industry as the owner corrected it, and a real store ignores sample findings', async () => {
    // The readers say dog treats; the owner says it sells candles.
    reads.findings.mockResolvedValue([
      offering,
      { ...offering, statement: 'Scented candles', pass: 'sample' }
    ])
    reads.corrections.mockResolvedValue([
      {
        id: 'c1',
        section: 'offering',
        original: 'Dog treats and toys',
        action: 'replace',
        value: 'Hand-poured scented candles',
        createdAt: '2026-11-15T09:00:00Z'
      }
    ])
    const got = await readCompetitorSuggestions(store().db, tenantId, {
      service: store().db
    })
    expect(got.map((s) => [s.domain, s.industry])).toEqual([
      ['wick.example', 'home']
    ])
    // Without his correction it is pet: the sample's candles do not count.
    reads.corrections.mockResolvedValue([])
    const plain = await readCompetitorSuggestions(store().db, tenantId, {
      service: store().db
    })
    expect(plain.map((s) => [s.domain, s.industry])).toEqual([
      ['bark.example', 'pet']
    ])
  })

  it('reads the sample store’s sample findings and sample brands', async () => {
    reads.findings.mockResolvedValue([
      { ...offering, statement: 'Scented candles', pass: 'sample' }
    ])
    reads.corrections.mockResolvedValue([])
    const { db } = store({
      brand_profiles: {
        data: { domain: 'cedar-lane.example', synthetic: true },
        error: null
      },
      suggestable_inbox_brands: {
        data: [
          row({
            id: 's1',
            domain: 'wick.example',
            niche: 'Scented candles',
            synthetic: true
          }),
          // A real brand never reaches a sample store.
          row({ id: 'r1', domain: 'wick.com', niche: 'Scented candles' })
        ],
        error: null
      }
    })
    const got = await readCompetitorSuggestions(db, tenantId, { service: db })
    expect(got.map((s) => s.captureId)).toEqual(['s1'])
  })

  it('suggests nothing before the workspace has a brand profile', async () => {
    reads.findings.mockResolvedValue([offering])
    reads.corrections.mockResolvedValue([])
    const { db } = store({ brand_profiles: { data: null, error: null } })
    expect(
      await readCompetitorSuggestions(db, tenantId, { service: db })
    ).toEqual([])
  })

  it('throws a read that fails', async () => {
    reads.findings.mockResolvedValue([offering])
    reads.corrections.mockResolvedValue([])
    const failed = { data: null, error: { code: 'PGRST000' } }
    for (const table of ['brand_profiles', 'suggestable_inbox_brands'])
      await expect(
        readCompetitorSuggestions(store({ [table]: failed }).db, tenantId, {
          service: store({ [table]: failed }).db
        })
      ).rejects.toMatchObject({ code: 'PGRST000' })
    reads.corrections.mockRejectedValueOnce({ code: 'PGRST001' })
    await expect(
      readCompetitorSuggestions(store().db, tenantId, { service: store().db })
    ).rejects.toMatchObject({ code: 'PGRST001' })
    reads.findings.mockRejectedValueOnce({ code: 'PGRST002' })
    await expect(
      readCompetitorSuggestions(store().db, tenantId, { service: store().db })
    ).rejects.toMatchObject({ code: 'PGRST002' })
  })

  it('asks for the inbox’s brands with the server’s client only, after the member’s own read found the store', async () => {
    reads.findings.mockResolvedValue([offering])
    reads.corrections.mockResolvedValue([])
    const own = store()
    const server = store()
    await readCompetitorSuggestions(own.db, tenantId, { service: server.db })
    expect(own.asked.map((a) => a[0])).not.toContain('suggestable_inbox_brands')
    expect(server.asked.map((a) => a[0])).toEqual(['suggestable_inbox_brands'])
    // Not a member (the profile is not his to read): nothing is asked.
    const stranger = store({ brand_profiles: { data: null, error: null } })
    const unused = store()
    expect(
      await readCompetitorSuggestions(stranger.db, tenantId, {
        service: unused.db
      })
    ).toEqual([])
    expect(unused.asked).toEqual([])
  })

  it('suggests a real store the inbox’s real brands of its industry', async () => {
    reads.findings.mockResolvedValue([offering])
    reads.corrections.mockResolvedValue([])
    const { db } = store({
      suggestable_inbox_brands: {
        data: [
          row({ id: 'r1', domain: 'barkreal.com', niche: 'Dog treats' }),
          row({ id: 'r2', domain: 'wickreal.com', niche: 'Scented candles' })
        ],
        error: null
      }
    })
    const got = await readCompetitorSuggestions(db, tenantId, { service: db })
    expect(got.map((s) => [s.captureId, s.industry])).toEqual([['r1', 'pet']])
  })
})

describe('setBrandHidden (REAL-01a)', () => {
  it('hides or shows a brand with the owner’s own client, and throws a refusal', async () => {
    const calls: [string, unknown][] = []
    const db = {
      rpc: async (name: string, args: unknown) => (
        calls.push([name, args]),
        { data: null, error: null }
      )
    } as never
    await setBrandHidden(db, 't1', 'c1', true)
    await setBrandHidden(db, 't1', 'c1', false)
    expect(calls).toEqual([
      ['hide_competitor', { t: 't1', capture: 'c1' }],
      ['unhide_competitor', { t: 't1', capture: 'c1' }]
    ])
    const refused = {
      rpc: async () => ({ data: null, error: { code: '42501' } })
    } as never
    await expect(
      setBrandHidden(refused, 't1', 'c1', true)
    ).rejects.toMatchObject({
      code: '42501'
    })
  })
})
