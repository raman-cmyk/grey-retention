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
  maxSuggestions,
  readCompetitorSuggestions,
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
  live: true,
  following: new Set<string>()
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

  it('never suggests the store itself, a brand it follows, one the inbox does not get, or the other kind', () => {
    const own = brand({ domain: 'WWW.MyStore.example' })
    const followed = brand()
    const pending = brand({ subscriptionStatus: 'pending' })
    const sample = brand({ synthetic: true })
    const good = brand()
    const got = suggestCompetitors({
      ...base,
      following: new Set([followed.id]),
      brands: [own, followed, pending, sample, good]
    })
    expect(got.map((s) => s.captureId)).toEqual([good.id])
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
  })
})

describe('readCompetitorSuggestions (ONB-065a)', () => {
  const tenantId = '00000000-0000-4000-8000-000000000101'
  function fakeDb(answers: Record<string, { data: unknown; error: unknown }>) {
    const asked: [string, string, ...unknown[]][] = []
    const from = (table: string) => {
      const chain: Record<string, unknown> = {}
      for (const op of ['select', 'eq', 'in', 'gte', 'order', 'limit'])
        chain[op] = (...a: unknown[]) => (asked.push([table, op, ...a]), chain)
      chain.maybeSingle = async () => answers[table]
      chain.then = (done: (r: unknown) => unknown) => done(answers[table])
      return chain
    }
    return { db: { from } as never, asked }
  }
  const offering = {
    topic: 'offering',
    statement: 'Dog treats and toys',
    confidence: 0.9,
    pass: 'model',
    source: 'site'
  } as unknown as Finding

  const brandRows = [
    {
      id: 'b1',
      domain: 'bark.example',
      brand_name: 'Bark Co',
      niche: 'Dog treats',
      synthetic: false,
      subscription_status: 'subscribed',
      last_received_at: '2026-11-14T10:00:00Z'
    },
    {
      id: 'b2',
      domain: 'wick.example',
      brand_name: 'Wick',
      niche: 'Scented candles',
      synthetic: false,
      subscription_status: 'subscribed',
      last_received_at: '2026-11-13T10:00:00Z'
    }
  ]
  const realStore = (
    over: Record<string, { data: unknown; error: unknown }> = {}
  ) =>
    fakeDb({
      brand_profiles: {
        data: { domain: 'mystore.example', synthetic: false },
        error: null
      },
      competitor_subscriptions: { data: [], error: null },
      competitor_captures: { data: brandRows, error: null },
      competitor_emails: { data: [], error: null },
      ...over
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
    const got = await readCompetitorSuggestions(realStore().db, tenantId)
    expect(got.map((s) => [s.domain, s.industry])).toEqual([
      ['wick.example', 'home']
    ])
    // Without his correction it is pet: the sample's candles do not count.
    reads.corrections.mockResolvedValue([])
    const plain = await readCompetitorSuggestions(realStore().db, tenantId)
    expect(plain.map((s) => [s.domain, s.industry])).toEqual([
      ['bark.example', 'pet']
    ])
  })

  it('suggests nothing before the workspace has a brand profile', async () => {
    reads.findings.mockResolvedValue([offering])
    reads.corrections.mockResolvedValue([])
    const { db } = realStore({ brand_profiles: { data: null, error: null } })
    expect(await readCompetitorSuggestions(db, tenantId)).toEqual([])
  })

  it('reads the workspace’s own rows and the inbox’s brands and recent emails', async () => {
    reads.findings.mockResolvedValue([offering])
    reads.corrections.mockResolvedValue([])
    const { db, asked } = fakeDb({
      brand_profiles: {
        data: { domain: 'mystore.example', synthetic: false },
        error: null
      },
      competitor_subscriptions: {
        data: [{ capture_id: 'b-followed' }],
        error: null
      },
      competitor_captures: {
        data: [
          {
            id: 'b1',
            domain: 'bark.example',
            brand_name: 'Bark Co',
            niche: 'Home goods',
            synthetic: false,
            subscription_status: 'subscribed',
            last_received_at: '2026-11-14T10:00:00Z'
          },
          {
            id: 'b-followed',
            domain: 'followed.example',
            brand_name: 'Followed',
            niche: 'Dog treats',
            synthetic: false,
            subscription_status: 'subscribed',
            last_received_at: '2026-11-14T10:00:00Z'
          }
        ],
        error: null
      },
      competitor_emails: {
        data: [
          { capture_id: 'b1', industry: 'pet' },
          { capture_id: 'b1', industry: 'pet' },
          { capture_id: 'b1', industry: null }
        ],
        error: null
      }
    })
    const got = await readCompetitorSuggestions(db, tenantId, {
      now: new Date('2026-11-15T12:00:00Z')
    })
    // Its emails say pet, whatever its niche says.
    expect(got).toEqual([
      {
        captureId: 'b1',
        domain: 'bark.example',
        name: 'Bark Co',
        industry: 'pet',
        reason: 'Also a pet brand, and sent 3 emails in the last 30 days.'
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
      'competitor_subscriptions',
      'eq',
      'tenant_id',
      tenantId
    ])
    expect(asked).toContainEqual([
      'competitor_captures',
      'eq',
      'subscription_status',
      'subscribed'
    ])
    expect(asked).toContainEqual([
      'competitor_emails',
      'gte',
      'received_at',
      '2026-10-16T12:00:00.000Z'
    ])
  })

  it('throws a read that fails', async () => {
    reads.findings.mockResolvedValue([offering])
    reads.corrections.mockResolvedValue([])
    const ok = { data: [], error: null }
    for (const table of [
      'brand_profiles',
      'competitor_subscriptions',
      'competitor_captures'
    ]) {
      const answers: Record<string, { data: unknown; error: unknown }> = {
        brand_profiles: {
          data: { domain: 'mystore.example', synthetic: false },
          error: null
        },
        competitor_subscriptions: ok,
        competitor_captures: ok,
        competitor_emails: ok
      }
      answers[table] = { data: null, error: { code: 'PGRST000' } }
      await expect(
        readCompetitorSuggestions(fakeDb(answers).db, tenantId)
      ).rejects.toMatchObject({ code: 'PGRST000' })
    }
    reads.corrections.mockRejectedValue({ code: 'PGRST001' })
    await expect(
      readCompetitorSuggestions(realStore().db, tenantId)
    ).rejects.toMatchObject({ code: 'PGRST001' })
  })
})
