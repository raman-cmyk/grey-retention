// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { memoryFallbackLog } from '@/features/fallback/log'
import type { OfferSource } from '@/features/offers/source'
import { buildEmail, type BuiltEmail, type PlannedEmail } from './build'
import { sampleOffers, sampleStoreSource, type StoreSource } from './ports'
import { restoreRefusal } from './restore-checks'

/**
 * PICK-106: what "Use this version" checks before it queues the push, so a
 * version the push would refuse never leaves the draft: an email built
 * the real way (the sample store), checked under today's rules.
 */
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
const built = async (p = planned()) => {
  const made = await buildEmail(
    {
      planned: p,
      store: await sampleStoreSource.read(tenantId),
      offers: sampleOffers
    },
    { tenantId, callerKey: 'x', fallbacks: memoryFallbackLog() }
  )
  if (!made.ok) throw new Error('sample build failed')
  return made.email
}
/** The plan's store: the sample store (as `planStore` reads it). */
const db = {
  from: () => {
    const q = {
      select: () => q,
      eq: () => q,
      maybeSingle: async () => ({
        data: { own: false, sample: true },
        error: null
      })
    }
    return q
  }
} as never
/** Today's offers: the sample's, with these changes. */
const offersNow = (
  change: (o: { maxDiscountPercent: number | null; codes: unknown[] }) => {
    maxDiscountPercent: number | null
    codes: unknown[]
  }
): OfferSource => ({
  async offers(t, at) {
    const read = await sampleOffers.offers(t, at)
    return read ? (change(read) as never) : null
  }
})
const check = (
  email: BuiltEmail,
  deps: {
    offers?: OfferSource
    stores?: StoreSource
    klaviyoState?: () => Promise<null | 'scheduled_in_klaviyo'>
  } = {}
) =>
  restoreRefusal(
    db,
    {
      tenantId,
      runId: 'r1',
      startOn: inDays(0),
      pushKey: 'k1',
      email
    },
    {
      offers: deps.offers ?? sampleOffers,
      stores: deps.stores ?? sampleStoreSource,
      klaviyoState: deps.klaviyoState ?? (async () => null)
    }
  )

describe('the checks before a restore (PICK-106)', () => {
  it('lets a version through that still passes everything', async () => {
    expect(await check(await built())).toBeNull()
  })

  it('refuses a version whose code the owner has since retired', async () => {
    const email = await built()
    expect(email.code).toBe('CANDLE10')
    expect(
      await check(email, {
        offers: offersNow((o) => ({
          ...o,
          codes: o.codes.filter(
            (c) => (c as { code: string }).code !== 'CANDLE10'
          )
        }))
      })
    ).toBe(
      'This version’s discount code CANDLE10 is no longer one of your working codes within your max discount, so it is not used again.'
    )
  })

  it('refuses a version over a max discount the owner has since lowered', async () => {
    const email = await built()
    expect(
      await check(email, {
        offers: offersNow((o) => ({ ...o, maxDiscountPercent: 5 }))
      })
    ).toMatch(/no longer one of your working codes within your max discount/)
    // Without a code, the drawn percent is checked under the new max.
    const plain = await built(planned({ emailType: 'launch', offer: null }))
    const drawn = {
      ...plain,
      html: plain.html.replace('</body>', '<p>Take 10% off today</p></body>')
    }
    expect(await check(drawn)).toBeNull()
    expect(
      await check(drawn, {
        offers: offersNow((o) => ({ ...o, maxDiscountPercent: 5 }))
      })
    ).toMatch(/^This version no longer passes the email checks: /)
  })

  it('refuses a draft the owner scheduled in Klaviyo since', async () => {
    expect(
      await check(await built(), {
        klaviyoState: async () => 'scheduled_in_klaviyo'
      })
    ).toBe(
      'This email is scheduled in Klaviyo, so GROS will not change it. Unschedule it in Klaviyo first.'
    )
  })

  it('refuses a version with a phrase the owner takes out of his emails', async () => {
    const email = await built()
    const store = await sampleStoreSource.read(tenantId)
    const word = email.subject.split(/\s+/).find((w) => w.length > 4)!
    expect(
      await check(email, {
        stores: { read: async () => ({ ...store, neverWords: [word] }) }
      })
    ).toContain('which you take out of your emails')
  })

  it('says it could not check, never lets it through, when a read fails', async () => {
    expect(
      await check(await built(), {
        stores: {
          read: async () => {
            throw new Error('down')
          }
        }
      })
    ).toBe('This version could not be checked just now. Try again in a moment.')
    expect(
      await check(await built(), {
        klaviyoState: async () => {
          throw new Error('down')
        }
      })
    ).toBe('This version could not be checked just now. Try again in a moment.')
  })
})
