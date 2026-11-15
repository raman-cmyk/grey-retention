// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { memoryFallbackLog } from '@/features/fallback/log'
import { builtEmail, buildEmail, codeWorks, type PlannedEmail } from './build'
import { fakeDraftPusher } from '@/lib/providers/klaviyo-draft'
import {
  endOfLocalDay,
  featurableStock,
  offersAt,
  ownerOrSampleOffers,
  sampleOffers,
  sampleStoreSource
} from './ports'

const tenantId = '00000000-0000-4000-8000-000000000101'
const inDays = (n: number) => {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const planned = (over: Partial<PlannedEmail> = {}): PlannedEmail => ({
  date: inDays(2),
  time: '10:00',
  emailType: 'offer',
  angle: 'The candle people love, for less',
  products: [
    { id: 'p-cedar-candle', title: 'Cedar candle' },
    { id: 'p-linen-throw', title: 'Linen throw' }
  ],
  offer: { id: 'offer:CANDLE10', code: 'CANDLE10', percent: 10 },
  audience: { id: 'sample-engaged', label: 'Engaged subscribers (sample)' },
  ...over
})
const build = async (p = planned()) => {
  const fallbacks = memoryFallbackLog()
  const result = await buildEmail(
    {
      planned: p,
      store: await sampleStoreSource.read(tenantId),
      offers: sampleOffers
    },
    { tenantId, callerKey: 'email-build:b1', fallbacks }
  )
  return { result, fallbacks }
}

describe('building a planned email (code-only)', () => {
  it.each(['Cedar\u200b Lane', 'LUMA\u200b Home', 'Winner\u200b Candles'])(
    'builds plain copy for the brand name %j (a hidden character), kept out of the subject and preview (REL-AI part 2b)',
    async (name) => {
      const store = await sampleStoreSource.read(tenantId)
      const result = await buildEmail(
        {
          planned: planned(),
          store: { ...store, brand: { ...store.brand, name } },
          offers: sampleOffers
        },
        {
          tenantId,
          callerKey: 'email-build:b1',
          fallbacks: memoryFallbackLog()
        }
      )
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.email.subject).not.toMatch(/\u200b/)
      expect(result.email.preheader).not.toMatch(/\u200b/)
      expect(result.email.preheader).toContain(name.replace('\u200b', ''))
    }
  )

  it('builds a coded email from the sample store with the locked offer, and says what it is', async () => {
    const { result, fallbacks } = await build()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const email = result.email
    expect(builtEmail.safeParse(email).success).toBe(true)
    expect(email).toMatchObject({
      sample: true,
      ai: false,
      approach: 'A',
      copy: 'plain',
      code: 'CANDLE10',
      audienceId: 'sample-engaged'
    })
    expect(email.productIds).toEqual(['p-cedar-candle', 'p-linen-throw'])
    expect(email.html).toContain('CANDLE10')
    expect(email.html).toContain('Cedar candle')
    // 10:00 in Melbourne is the planned send time.
    expect(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Australia/Melbourne',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
      }).format(new Date(email.plannedSendAt))
    ).toBe('10:00')
    expect(email.name).toMatch(/ · Offer$/)
    expect(fallbacks.entries()).toEqual([])
  })

  it('swaps a sold-out planned product for another real one and logs it', async () => {
    const { result, fallbacks } = await build(
      planned({
        emailType: 'bestseller',
        offer: null,
        products: [
          { id: 'p-stone-vase', title: 'Stone vase' },
          { id: 'p-linen-throw', title: 'Linen throw' }
        ]
      })
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.email.productIds).not.toContain('p-stone-vase')
    expect(result.email.changes).toContain('product_not_featurable')
    expect(fallbacks.entries()[0]).toMatchObject({
      agent: 'content-locker',
      reasonCode: 'content_replaced'
    })
  })

  it('sends without an offer when the code is above the max', async () => {
    const { result } = await build(
      planned({
        offer: { id: 'offer:BIGSALE40', code: 'BIGSALE40', percent: 40 }
      })
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.email.code).toBeNull()
    expect(result.email.html).not.toContain('BIGSALE40')
    expect(result.email.changes).toContain('offer_above_max')
  })

  it('refuses a planned time the store’s clock skips', async () => {
    // Melbourne moves from 02:00 to 03:00 on the first Sunday of October.
    const { result } = await build(
      planned({ date: '2027-10-03', time: '02:30' })
    )
    expect(result).toEqual({ ok: false, code: 'slot_time_invalid' })
  })
})

describe('the ports', () => {
  it('end a code at the end of its store-local day', () => {
    expect(endOfLocalDay('2026-11-22', 'America/Los_Angeles')).toBe(
      '2026-11-23T08:00:00.000Z'
    )
  })

  it('read the sample offers with the max discount', async () => {
    const offers = await sampleOffers.offers(tenantId, new Date().toISOString())
    expect(offers?.maxDiscountPercent).toBe(20)
    // The ended code is left out; the rest are sorted by code.
    expect(offers?.codes.map((c) => c.code)).toEqual([
      'BIGSALE40',
      'CANDLE10',
      'WELCOME15'
    ])
  })

  it('treat an unreadable or unset max as no discount, and drop codes that end before the send', async () => {
    const at = '2026-11-17T23:00:00.000Z'
    const read = (value: unknown) => ({
      offers: async () => value as never
    })
    expect(await offersAt(read(null), tenantId, at)).toEqual({
      maxDiscountPercent: 0,
      codes: []
    })
    expect(
      await offersAt(
        read({ maxDiscountPercent: null, codes: [] }),
        tenantId,
        at
      )
    ).toEqual({ maxDiscountPercent: 0, codes: [] })
    expect(
      await offersAt(
        { offers: async () => Promise.reject(new Error('down')) },
        tenantId,
        at
      )
    ).toEqual({ maxDiscountPercent: 0, codes: [] })
    expect(
      await offersAt(
        read({
          maxDiscountPercent: 20,
          codes: [
            { code: 'OLD', percent: 10, expiresAt: '2026-11-17T22:00:00.000Z' },
            { code: 'NEW', percent: 10, expiresAt: null }
          ]
        }),
        tenantId,
        at
      )
    ).toEqual({
      maxDiscountPercent: 20,
      codes: [{ code: 'NEW', percent: 10, expiresAt: null }]
    })
  })

  it('let the owner’s saved offers win, fall back to the sample only when nothing is saved, and never on a failed read', async () => {
    const at = '2026-11-17T23:00:00.000Z'
    const sample = {
      offers: async () => ({
        maxDiscountPercent: 20,
        codes: [{ code: 'CANDLE10', percent: 10, expiresAt: null }]
      })
    }
    const saved = (value: unknown) =>
      ownerOrSampleOffers({ managed: async () => value as never }, sample)
    const owned = (code: string, expiresAt: string | null) => ({
      id: code,
      code,
      percent: 10,
      expiresAt,
      ended: false
    })
    // 1. The owner saved a max and codes: those, never the sample's.
    expect(
      await saved({
        maxDiscountPercent: 15,
        revision: 1,
        codes: [
          owned('OLD', '2026-11-17T22:00:00.000Z'),
          owned('OWNER10', null)
        ]
      }).offers(tenantId, at)
    ).toEqual({
      maxDiscountPercent: 15,
      limitedBy: 'max_discount',
      codes: [{ code: 'OWNER10', percent: 10, expiresAt: null }]
    })
    // PLN-039: a margin floor that allows less caps the owner's max.
    expect(
      await saved({
        maxDiscountPercent: 50,
        grossMarginPercent: 60,
        marginFloorPercent: 30,
        revision: 2,
        codes: [owned('OWNER10', null)]
      }).offers(tenantId, at)
    ).toMatchObject({ maxDiscountPercent: 42, limitedBy: 'margin_floor' })
    // Codes but no max saved: the owner's (no discount), not the sample's.
    expect(
      await saved({
        maxDiscountPercent: null,
        revision: 0,
        codes: [owned('OWNER10', null)]
      }).offers(tenantId, at)
    ).toEqual({
      maxDiscountPercent: null,
      limitedBy: null,
      codes: [{ code: 'OWNER10', percent: 10, expiresAt: null }]
    })
    // 2. Nothing saved: the sample offers.
    expect(
      await saved({ maxDiscountPercent: null, revision: 0, codes: [] }).offers(
        tenantId,
        at
      )
    ).toEqual(await sample.offers())
    // 3. The read failed (null or thrown): null, so the build offers nothing.
    expect(await saved(null).offers(tenantId, at)).toBeNull()
    const thrown = ownerOrSampleOffers(
      { managed: async () => Promise.reject(new Error('down')) },
      sample
    )
    expect(await thrown.offers(tenantId, at)).toBeNull()
    expect(await offersAt(thrown, tenantId, at)).toEqual({
      maxDiscountPercent: 0,
      codes: []
    })
  })

  it('feature a product unless its stock is known to be 0 (unknown stock is allowed)', async () => {
    expect(featurableStock(0)).toBe(false)
    expect(featurableStock(3)).toBe(true)
    expect(featurableStock(null)).toBe(true)
    expect(featurableStock(undefined)).toBe(true)
    // An email built from products whose stock nobody knows still has them.
    const store = await sampleStoreSource.read(tenantId)
    const unknown = {
      ...store,
      products: store.products.map((p) => ({
        ...p,
        featurable: featurableStock(null)
      }))
    }
    const result = await buildEmail(
      {
        planned: planned({ offer: null, emailType: 'bestseller' }),
        store: unknown,
        offers: sampleOffers
      },
      { tenantId, callerKey: 'email-build:b2', fallbacks: memoryFallbackLog() }
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.email.productIds.length).toBeGreaterThan(0)
  })

  it('fake pusher gives the same draft for the same key', async () => {
    const pusher = fakeDraftPusher()
    const input = {
      tenantId,
      idempotencyKey: 'b1',
      name: 'n',
      subject: 's',
      preheader: 'p',
      html: '<p>x</p>',
      plannedSendAt: '2026-11-17T23:00:00Z',
      audienceId: 'a',
      sample: true
    }
    const one = await pusher.createDraft(input)
    const two = await pusher.createDraft(input)
    expect(one).toEqual(two)
    expect(one).toEqual({
      ok: true,
      campaignId: 'sample-draft-b1',
      sample: true
    })
  })
})

describe('one plan, one subject per email (REL-AI)', () => {
  const store = () => sampleStoreSource.read(tenantId)
  /** Builds the planned emails in order, as "Create email" would. */
  const buildAll = async (list: PlannedEmail[]) => {
    const fallbacks = memoryFallbackLog()
    const taken: string[] = []
    const results = []
    for (const [i, p] of list.entries()) {
      const r = await buildEmail(
        { planned: p, store: await store(), offers: sampleOffers, taken },
        { tenantId, callerKey: `email-build:b${i}`, fallbacks }
      )
      if (r.ok) taken.push(r.email.subject)
      results.push(r)
    }
    return { results, taken, fallbacks }
  }

  it('never gives two emails in one plan the same subject, and each still passes the checks', async () => {
    const plan: PlannedEmail[] = [
      planned({ emailType: 'story', offer: null, date: inDays(2) }),
      planned({ emailType: 'story', offer: null, date: inDays(3) }),
      planned({ emailType: 'bestseller', offer: null, date: inDays(4) }),
      planned({ date: inDays(5) }),
      planned({ emailType: 'reminder', offer: null, date: inDays(6) }),
      planned({ emailType: 'education', offer: null, date: inDays(7) })
    ]
    const { results, taken } = await buildAll(plan)
    expect(results.every((r) => r.ok)).toBe(true)
    expect(new Set(taken.map((t) => t.toLowerCase())).size).toBe(plan.length)
    for (const t of taken) expect(t.length).toBeLessThanOrEqual(60)
  })

  it('stops, with its reason, rather than reuse a subject when every one it could use is taken', async () => {
    // Alike and on one day, so even the send-day subjects run out.
    const same = Array.from({ length: 14 }, (_, i) =>
      planned({
        emailType: 'story',
        offer: null,
        products: [{ id: 'p-cedar-candle', title: 'Cedar candle' }],
        date: inDays(2),
        time: `${String(8 + (i % 12)).padStart(2, '0')}:00`
      })
    )
    const { results, taken, fallbacks } = await buildAll(same)
    expect(new Set(taken.map((t) => t.toLowerCase())).size).toBe(taken.length)
    const stopped = results.filter((r) => !r.ok)
    expect(stopped.length).toBeGreaterThan(0)
    expect(stopped.every((r) => !r.ok && r.code === 'subject_taken')).toBe(true)
    expect(
      fallbacks.entries().some((e) => e.reasonCode === 'subject_taken')
    ).toBe(true)
  })

  it('keeps template tags and hidden characters in store text out of a subject', async () => {
    const base = await store()
    const hostile = {
      ...base,
      products: base.products.map((p) =>
        p.id === 'p-linen-throw'
          ? { ...p, title: 'Linen {{ person.email }} throw' }
          : p.id === 'p-cedar-candle'
            ? { ...p, title: 'Cedar\u202E candle\u200B' }
            : p
      )
    }
    const bestseller = planned({
      emailType: 'bestseller',
      offer: null,
      products: [
        { id: 'p-linen-throw', title: 'Linen throw' },
        { id: 'p-cedar-candle', title: 'Cedar candle' }
      ]
    })
    const fallbacks = memoryFallbackLog()
    const first = await buildEmail(
      { planned: bestseller, store: hostile, offers: sampleOffers },
      { tenantId, callerKey: 'email-build:h1', fallbacks }
    )
    if (!first.ok) throw new Error('first build failed')
    // Its own subject is taken, so it picks from the product titles.
    const second = await buildEmail(
      {
        planned: bestseller,
        store: hostile,
        offers: sampleOffers,
        taken: [first.email.subject.toUpperCase()]
      },
      { tenantId, callerKey: 'email-build:h2', fallbacks }
    )
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.email.subject.toLowerCase()).not.toBe(
      first.email.subject.toLowerCase()
    )
    expect(second.email.subject).not.toMatch(/[{}<>\u200B\u202E]/)
  })

  it('stops rather than put a brand name with template tags in a new subject', async () => {
    const base = await store()
    const odd = { ...base, brand: { ...base.brand, name: 'Shop {{ x }}' } }
    const r = await buildEmail(
      {
        planned: planned({ emailType: 'story', offer: null }),
        store: odd,
        offers: sampleOffers
      },
      {
        tenantId,
        callerKey: 'email-build:o1',
        fallbacks: memoryFallbackLog()
      }
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(['subject_taken', 'copy_failed']).toContain(r.code)
  })
})

describe('a code an email may carry (REL-OFF)', () => {
  const rules = (over: Record<string, unknown> = {}) => ({
    maxDiscountPercent: 20,
    codes: [{ code: 'CANDLE10', percent: 10, expiresAt: null, ...over }]
  })
  const at = '2026-11-17T10:00:00Z'
  it('is one of the working codes, whatever its case and spacing', () => {
    expect(codeWorks('CANDLE10', rules(), at)).toBe(true)
    expect(codeWorks('candle10', rules(), at)).toBe(true)
    expect(codeWorks(' CANDLE10 ', rules(), at)).toBe(true)
    expect(codeWorks('OTHER', rules(), at)).toBe(false)
  })
  it('is a whole percent from 1 to the max', () => {
    expect(codeWorks('CANDLE10', rules({ percent: 0 }), at)).toBe(false)
    expect(codeWorks('CANDLE10', rules({ percent: 12.5 }), at)).toBe(false)
    expect(codeWorks('CANDLE10', rules({ percent: 25 }), at)).toBe(false)
    expect(codeWorks('CANDLE10', rules({ percent: 20 }), at)).toBe(true)
  })
  it('still works when the email sends', () => {
    expect(
      codeWorks('CANDLE10', rules({ expiresAt: '2026-11-17T09:59:59Z' }), at)
    ).toBe(false)
    expect(
      codeWorks('CANDLE10', rules({ expiresAt: '2026-11-17T10:00:01Z' }), at)
    ).toBe(true)
    expect(codeWorks('CANDLE10', rules({ expiresAt: 'soon' }), at)).toBe(false)
  })
})
