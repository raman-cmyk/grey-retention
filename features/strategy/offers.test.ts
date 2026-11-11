// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  lastFullDay,
  offerWorksAt,
  pulseCodes,
  readPlanOffers,
  stillUsable,
  type PlanOffers
} from './offers'

const zone = 'Australia/Melbourne'
const tenant = '00000000-0000-4000-8000-000000000101'
const offers: PlanOffers = {
  maxDiscountPercent: 20,
  codes: [
    // Ends at the very end of the 18th (midnight on the 19th, store time).
    { code: 'MIDNIGHT', percent: 10, expiresAt: '2026-11-19T00:00:00+11:00' },
    // Ends at 2 pm on the 19th.
    { code: 'AFTERNOON', percent: 10, expiresAt: '2026-11-19T14:00:00+11:00' },
    { code: 'FOREVER', percent: 20, expiresAt: null }
  ]
}
const slot = (date: string, time: string, code: string, percent = 10) => ({
  date,
  time,
  offer: { code, percent }
})

describe('the plan’s offer days', () => {
  it('end a code on the last day it works all day, store time', () => {
    expect(lastFullDay('2026-11-19T00:00:00+11:00', zone)).toBe('2026-11-18')
    expect(lastFullDay('2026-11-19T14:00:00+11:00', zone)).toBe('2026-11-18')
    expect(lastFullDay(null, zone)).toBeNull()
  })

  it('list a code only when it works for a whole planned day', () => {
    expect(pulseCodes(offers, '2026-11-16', zone)).toEqual([
      { code: 'MIDNIGHT', percent: 10, expiresOn: '2026-11-18' },
      { code: 'AFTERNOON', percent: 10, expiresOn: '2026-11-18' },
      { code: 'FOREVER', percent: 20, expiresOn: null }
    ])
    // From the 19th, neither ending code works a whole day.
    expect(pulseCodes(offers, '2026-11-19', zone).map((c) => c.code)).toEqual([
      'FOREVER'
    ])
  })
})

describe('a planned offer at its own send time', () => {
  it('works exactly when the email build will accept it', () => {
    expect(
      offerWorksAt(slot('2026-11-18', '23:00', 'MIDNIGHT'), offers, zone)
    ).toBe(true)
    expect(
      offerWorksAt(slot('2026-11-19', '10:00', 'AFTERNOON'), offers, zone)
    ).toBe(true)
    expect(
      offerWorksAt(slot('2026-11-19', '15:00', 'AFTERNOON'), offers, zone)
    ).toBe(false)
    expect(
      offerWorksAt(slot('2026-11-19', '00:30', 'MIDNIGHT'), offers, zone)
    ).toBe(false)
    // Not a saved code, or above the max.
    expect(
      offerWorksAt(slot('2026-11-17', '10:00', 'CANDLE10'), offers, zone)
    ).toBe(false)
    expect(
      offerWorksAt(
        slot('2026-11-17', '10:00', 'FOREVER', 20),
        { ...offers, maxDiscountPercent: 15 },
        zone
      )
    ).toBe(false)
    // A time the store's clock skips (Melbourne, 2 to 3 am on 4 Oct 2026).
    expect(
      offerWorksAt(slot('2026-10-04', '02:30', 'FOREVER'), offers, zone)
    ).toBe(false)
    expect(
      offerWorksAt(
        { date: '2026-11-17', time: '10:00', offer: null },
        offers,
        zone
      )
    ).toBe(true)
  })
})

describe('picked offers at the plan step', () => {
  it('keep only those that still work, with their current percent and days', () => {
    const picked = [
      {
        id: 'offer:FOREVER',
        code: 'forever',
        percent: 15,
        until: '2026-11-20'
      },
      { id: 'offer:GONE', code: 'GONE', percent: 10, until: null },
      {
        id: 'offer:AFTERNOON',
        code: 'AFTERNOON',
        percent: 10,
        until: '2026-11-19'
      }
    ]
    expect(stillUsable(picked, offers, '2026-11-16', zone)).toEqual({
      usable: [
        { id: 'offer:FOREVER', code: 'FOREVER', percent: 20, until: null },
        {
          id: 'offer:AFTERNOON',
          code: 'AFTERNOON',
          percent: 10,
          until: '2026-11-18'
        }
      ],
      leftOut: ['GONE']
    })
    expect(
      stillUsable(
        picked,
        { ...offers, maxDiscountPercent: 15 },
        '2026-11-16',
        zone
      ).leftOut
    ).toEqual(['forever', 'GONE'])
  })
})

describe('reading the plan’s offers', () => {
  it('reads them at the start of the first day, and throws to retry when it cannot', async () => {
    const asked: string[] = []
    const read = await readPlanOffers(
      {
        offers: async (_t, at) => {
          asked.push(at!)
          return { maxDiscountPercent: null, codes: [] }
        }
      },
      tenant,
      '2026-11-16',
      zone
    )
    expect(asked).toEqual(['2026-11-15T13:00:00.000Z'])
    // No max saved: no discount.
    expect(read).toEqual({ maxDiscountPercent: 0, codes: [] })
    await expect(
      readPlanOffers({ offers: async () => null }, tenant, '2026-11-16', zone)
    ).rejects.toMatchObject({ code: 'offers_unreadable' })
    await expect(
      readPlanOffers(
        { offers: async () => Promise.reject(new Error('down')) },
        tenant,
        '2026-11-16',
        zone
      )
    ).rejects.toMatchObject({ code: 'offers_unreadable' })
  })
})
