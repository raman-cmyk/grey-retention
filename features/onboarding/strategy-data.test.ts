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
import { samplePlan } from '@/features/strategy/plan'
import {
  codePulse,
  gatherEvidence,
  readPulseInput
} from '@/features/strategy/pulse'

vi.mock('server-only', () => ({}))
const reads = vi.hoisted(() => ({
  catalog: vi.fn(),
  history: vi.fn(),
  findings: vi.fn(),
  keyDates: vi.fn(),
  timezone: vi.fn(),
  corrections: vi.fn(),
  sendTimes: vi.fn()
}))
vi.mock('@/features/onboarding/history/send-times-store', () => ({
  readSendTimes: reads.sendTimes
}))
vi.mock('@/features/onboarding/brand-book-corrections', async (original) => ({
  ...(await original<
    typeof import('@/features/onboarding/brand-book-corrections')
  >()),
  listCorrections: reads.corrections
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
    // And its plan, as the plan step makes it (the pulse, no offers).
    const pulseOut = codePulse(gatherEvidence(pulse.input))
    const made = samplePlan({
      ...own.plan,
      start,
      pulse: pulseOut,
      offers: [],
      moves: []
    })
    expect(made.slots.length).toBeGreaterThan(0)
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

describe('strategyFrom: send times (PICK-97)', () => {
  const facts = (hours: number[]) =>
    ({
      sends: 4,
      leftOut: 0,
      shared: 0,
      within: [],
      firstSentAt: '2026-11-02T14:00:00Z',
      lastSentAt: '2026-11-11T23:00:00Z',
      recipients: 4000,
      opens: 1200,
      clicks: 100,
      machineOpens: 0,
      hours: hours.map((hour) => ({
        hour,
        sends: 2,
        recipients: 2000,
        opens: 600,
        clicks: 50,
        machineOpens: 0
      })),
      weekdays: []
    }) as never
  const row = (
    audienceId: string,
    bestHour: number,
    weekday: 'Thu' | 'Tue'
  ) => ({
    audienceId,
    facts: facts([9, bestHour]),
    bestHour,
    bestWeekday: weekday,
    rivals: 1,
    compared: true,
    reason: 'enough' as const
  })
  const counted = (over: Record<string, unknown> = {}) => ({
    entries: [row('*', 14, 'Thu'), row('SegA', 19, 'Tue')],
    timezone: 'America/New_York',
    live: true,
    readAt: '2026-11-15T00:00:00Z',
    ...over
  })

  it('hands each audience its best time from the history read', () => {
    const own = strategyFrom(parts({ sendTimes: counted() }), start, now)!
    expect(own.plan.sendTimes).toEqual([
      {
        audienceId: 'SegA',
        time: '19:00',
        basis: 'segment',
        strength: 'clear',
        othersTried: true,
        weekday: 'Tue'
      }
    ])
    // The plan puts its emails there, and says why.
    const made = samplePlan({
      ...own.plan,
      start,
      pulse: codePulse(gatherEvidence(readPulseInput(own.pulse).input)),
      offers: [],
      moves: []
    })
    expect(made.slots.length).toBeGreaterThan(0)
    expect(made.slots.every((s) => s.time === '19:00')).toBe(true)
    expect(made.slots.every((s) => s.timing?.basis === 'segment')).toBe(true)
  })

  it('when the store has no best hour either, an audience gets the usual hour, said so', () => {
    const own = strategyFrom(
      parts({
        sendTimes: counted({
          entries: [
            {
              ...row('*', 14, 'Thu'),
              bestHour: null,
              bestWeekday: null,
              rivals: 0,
              compared: false,
              reason: 'few_sends'
            }
          ]
        })
      }),
      start,
      now
    )!
    expect(own.plan.sendTimes).toEqual([
      expect.objectContaining({ time: '09:00', basis: 'usual' })
    ])
  })

  it('changes and explains no time when nothing was counted yet, or it was counted in another timezone or from the sample account', () => {
    for (const sendTimes of [
      null,
      counted({ entries: [] }),
      counted({ timezone: 'Europe/London' }),
      counted({ live: false })
    ]) {
      const own = strategyFrom(parts({ sendTimes }), start, now)!
      expect(own.plan.sendTimes).toBeUndefined()
      expect(own.plan.sendTime).toBe('09:00')
    }
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

  it('reads whole sentences, never part of a word', () => {
    const cases: [string, string][] = [
      ['Sells menswear basics: overshirts, knitwear and bags.', 'apparel'],
      ['A small shop offering organic dog treats and toys', 'pet'],
      ['Handmade oak chairs and dining tables for the home', 'home'],
      ['Scented soy candles for spring', 'home'],
      [
        'Specialty coffee beans, roasted fresh and shipped during the week',
        'food_drink'
      ],
      ['Wireless earbuds and speakers that last all day', 'electronics']
    ]
    for (const [sentence, key] of cases)
      expect([sentence, industryFrom([offering(sentence)]).key]).toEqual([
        sentence,
        key
      ])
  })

  it('never takes the sample rules’ finding for a live history', () => {
    const findings = [
      offering('Dog treats', 0.9, 'sample'),
      offering('Scented candles', 0.5)
    ]
    expect(industryFrom(findings).key).toBe('pet')
    expect(industryFrom(findings, { live: true }).key).toBe('home')
  })

  it('reads what the brand sells as the owner corrected it, his own lines first (ONB-057c)', () => {
    const findings = [
      offering('Scented candles', 0.9),
      offering('Dog treats', 0.5)
    ]
    const fix = (over: Record<string, unknown>) =>
      ({
        id: `c-${JSON.stringify(over)}`,
        section: 'offering',
        original: null,
        action: 'add',
        value: null,
        createdAt: '2026-11-15T10:00:00Z',
        ...over
      }) as never
    // His replacement of the surest line.
    expect(
      industryFrom(findings, {
        corrections: [
          fix({
            original: 'scented  CANDLES',
            action: 'replace',
            value: 'Linen clothing for travel'
          })
        ]
      })
    ).toEqual({ key: 'apparel', words: 'Linen clothing for travel' })
    // His removal: the next surest.
    expect(
      industryFrom(findings, {
        corrections: [
          fix({ original: 'Scented candles', action: 'remove', value: null })
        ]
      }).key
    ).toBe('pet')
    // His own added line comes first.
    expect(
      industryFrom(findings, {
        corrections: [fix({ value: 'Vitamin supplements for runners' })]
      })
    ).toEqual({ key: 'supplements', words: 'Vitamin supplements for runners' })
    // Corrections of other sections change nothing.
    expect(
      industryFrom(findings, {
        corrections: [fix({ section: 'voice', value: 'Dog treats' })]
      }).key
    ).toBe('home')
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
  const statusEq = vi.fn()
  // The catalog's last read: live like the history unless a test says.
  let catalogStatus: { data: unknown; error: unknown } = {
    data: { live: true },
    error: null
  }
  const db = (profile: { data: unknown; error: unknown }) =>
    ({
      from: (table: string) => {
        expect(['brand_profiles', 'catalog_status']).toContain(table)
        const eq = table === 'catalog_status' ? statusEq : profileEq
        const answer = table === 'catalog_status' ? catalogStatus : profile
        return {
          select: () => ({
            eq: (column: string, value: string) => {
              eq(column, value)
              return { maybeSingle: async () => answer }
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
    reads.corrections.mockResolvedValue([])
    reads.sendTimes.mockResolvedValue(null)
    catalogStatus = { data: { live: true }, error: null }
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
    // ONB-057b: "Create email" builds from the store this was made from.
    expect(own.own).toBe(true)
    expect(sample.load).not.toHaveBeenCalled()
    expect(reads.timezone).toHaveBeenCalledWith(expect.anything(), tenantId)
    expect(statusEq).toHaveBeenCalledWith('tenant_id', tenantId)
    // A live store never plans the fake Klaviyo's products.
    expect(reads.catalog).toHaveBeenCalledWith(expect.anything(), tenantId, {
      featurableOnly: true,
      synthetic: false
    })
    expect(reads.history).toHaveBeenCalledWith(expect.anything(), tenantId)
    // PICK-97: this workspace's send times, as of the plan's clock.
    expect(reads.sendTimes).toHaveBeenCalledWith(
      expect.anything(),
      tenantId,
      now
    )
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

  it('plans from what the brand sells as the owner corrected it (ONB-057c)', async () => {
    reads.corrections.mockResolvedValue([
      {
        id: 'c1',
        section: 'offering',
        original: 'Linen clothing for warm weather',
        action: 'replace',
        value: 'Scented candles for the home',
        createdAt: '2026-11-15T10:00:00Z'
      }
    ])
    const own = await load()
    expect(reads.corrections).toHaveBeenCalledWith(expect.anything(), tenantId)
    // Key dates match his words, and the plan takes his industry.
    expect(reads.keyDates).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ industry: 'Scented candles for the home' })
    )
    expect(own.pulse).toMatchObject({ brand: { industry: 'home' } })
  })

  it('plans without changing any time when the send times cannot be read (PICK-97)', async () => {
    reads.sendTimes.mockRejectedValue(new Error('down'))
    const own = await load()
    expect(own.sample).toBe(false)
    expect(own.plan.sendTimes).toBeUndefined()
  })

  it('hands back the sample store until there is enough', async () => {
    reads.history.mockResolvedValue(null)
    await expect(load({ data: null, error: null })).resolves.toBe(sampleAnswer)
    expect(sample.load).toHaveBeenCalledWith({ tenantId, start })
    reads.history.mockResolvedValue(stored({ readAt: '2026-10-01T00:00:00Z' }))
    await expect(load()).resolves.toBe(sampleAnswer)
  })

  it('plans the sample store until the catalog and the history were read the same way (ONB-057b)', async () => {
    // No catalog read yet, or one read fake while the history is live.
    for (const status of [{ live: false }, null]) {
      catalogStatus = { data: status, error: null }
      await expect(load()).resolves.toBe(sampleAnswer)
    }
    expect(reads.catalog).not.toHaveBeenCalled()
    // Both fake: the recorded store, marked sample, with the fake products.
    catalogStatus = { data: { live: false }, error: null }
    reads.history.mockResolvedValue(stored({ live: false }))
    const fake = await load()
    expect(fake).toMatchObject({ sample: true, own: true })
    expect(reads.catalog).toHaveBeenLastCalledWith(
      expect.anything(),
      tenantId,
      { featurableOnly: true, synthetic: true }
    )
  })

  it('needs no more reads, and never waits on key dates, for a sample plan', async () => {
    reads.history.mockResolvedValue(stored({ readAt: '2026-10-01T00:00:00Z' }))
    reads.keyDates.mockResolvedValue(null)
    await expect(load()).resolves.toBe(sampleAnswer)
    expect(reads.findings).not.toHaveBeenCalled()
    expect(reads.corrections).not.toHaveBeenCalled()
    expect(reads.keyDates).not.toHaveBeenCalled()
    expect(profileEq).not.toHaveBeenCalled()
    reads.history.mockResolvedValue(stored())
    reads.catalog.mockResolvedValue([])
    await expect(load()).resolves.toBe(sampleAnswer)
    expect(reads.findings).not.toHaveBeenCalled()
  })

  it('throws when any read fails, so the step is tried again', async () => {
    for (const read of [
      'timezone',
      'catalog',
      'history',
      'findings',
      'corrections'
    ] as const) {
      reads[read].mockRejectedValueOnce(new Error(`${read} down`))
      await expect(load()).rejects.toThrow(`${read} down`)
    }
    await expect(
      load({ data: null, error: { code: '42501' } as never })
    ).rejects.toMatchObject({
      code: '42501'
    })
    catalogStatus = { data: null, error: { code: 'PGRST000' } }
    await expect(load()).rejects.toMatchObject({ code: 'PGRST000' })
    catalogStatus = { data: { live: true }, error: null }
    // Never a plan without the key dates (Black Friday, the owner's own days).
    reads.keyDates.mockResolvedValueOnce(null)
    await expect(load()).rejects.toMatchObject({ code: 'key_dates_unreadable' })
    expect(sample.load).not.toHaveBeenCalled()
  })
})
