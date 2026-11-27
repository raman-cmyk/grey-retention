// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { fallbackEntry } from '@/features/fallback/entry'
import type { PlannedSlot } from './plan'
import {
  droppedOffersEntry,
  droppedOffersNote,
  lastSendDay,
  leftOutNote,
  offerEmailsThatFail,
  offerWorksAt,
  planOfferSource,
  pulseCodes,
  readPlanOffers,
  stillUsable,
  noOfferStory,
  withoutUnusableOffers,
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
    // An end date saved in Settings: 23:59:59 store time on the 20th.
    { code: 'SETTINGS', percent: 10, expiresAt: '2026-11-20T12:59:59.000Z' },
    { code: 'FOREVER', percent: 20, expiresAt: null }
  ]
}
const slot = (date: string, time: string, code: string, percent = 10) => ({
  date,
  time,
  offer: { code, percent }
})

describe('the plan’s offer days', () => {
  it('end a code on the last day an email can still send with it, store time', () => {
    // Settings' end date stays that day (it works past the latest send).
    expect(lastSendDay('2026-11-20T12:59:59.000Z', zone)).toBe('2026-11-20')
    expect(lastSendDay('2026-11-20T23:30:00+11:00', zone)).toBe('2026-11-20')
    // Ending at midnight or mid-day: the day before is the last whole day of sends.
    expect(lastSendDay('2026-11-19T00:00:00+11:00', zone)).toBe('2026-11-18')
    expect(lastSendDay('2026-11-19T14:00:00+11:00', zone)).toBe('2026-11-18')
    expect(lastSendDay('2026-11-19T21:00:00+11:00', zone)).toBe('2026-11-18')
    expect(lastSendDay(null, zone)).toBeNull()
    // In the workspace's own timezone: 11 am UTC on the 20th is 10 pm in Melbourne.
    expect(lastSendDay('2026-11-20T11:00:00Z', zone)).toBe('2026-11-20')
    expect(lastSendDay('2026-11-20T11:00:00Z', 'UTC')).toBe('2026-11-19')
  })

  it('list a code only while an email can use it, and say why when not', () => {
    expect(pulseCodes(offers, '2026-11-16', zone)).toEqual({
      codes: [
        { code: 'MIDNIGHT', percent: 10, expiresOn: '2026-11-18' },
        { code: 'AFTERNOON', percent: 10, expiresOn: '2026-11-18' },
        { code: 'SETTINGS', percent: 10, expiresOn: '2026-11-20' },
        { code: 'FOREVER', percent: 20, expiresOn: null }
      ],
      leftOut: []
    })
    // A plan starting on the 20th still lists the Settings code for that day.
    const late = pulseCodes(offers, '2026-11-20', zone)
    expect(late.codes.map((c) => c.code)).toEqual(['SETTINGS', 'FOREVER'])
    expect(late.leftOut).toEqual([
      // Ends at midnight on the 19th: its last day is the 18th.
      {
        code: 'MIDNIGHT',
        why: 'Its last day is 2026-11-18, too early for an email in these 15 days.'
      },
      {
        code: 'AFTERNOON',
        why: 'Its last day is 2026-11-19, too early for an email in these 15 days.'
      }
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

describe('the guard and the note', () => {
  it('find planned offer emails whose code would not work when they send', () => {
    const slots = [
      slot('2026-11-20', '21:00', 'SETTINGS'),
      slot('2026-11-19', '15:00', 'AFTERNOON'),
      { date: '2026-11-19', time: '10:00', offer: null }
    ]
    expect(offerEmailsThatFail(slots, offers, zone)).toEqual([slots[1]])
  })

  /** A whole planned email, as the plan stores it. */
  const planned = (
    date: string,
    time: string,
    code: string | null,
    percent = 10
  ): PlannedSlot => ({
    date,
    time,
    emailType: code ? 'offer' : 'story',
    angle: 'The candle people love, for less',
    products: [{ id: 'p-candle', title: 'Cedar candle' }],
    offer: code ? { id: `offer:${code}`, code, percent } : null,
    audience: { id: 'engaged', label: 'Engaged subscribers' },
    why: 'Run the offer the store chose for these days.',
    evidence: [
      ...(code
        ? [{ id: `offer:${code}`, fact: `${code} gives ${percent}% off.` }]
        : []),
      { id: 'sales:candle', fact: 'Cedar candle sold best last month.' }
    ]
  })

  it('make an email whose offer would not work a plain story without it, on the same day (REL-OFF)', () => {
    const slots = [
      planned('2026-11-20', '21:00', 'SETTINGS'),
      planned('2026-11-19', '15:00', 'AFTERNOON'),
      planned('2026-11-17', '10:00', 'CANDLE10'),
      planned('2026-11-18', '10:00', 'FOREVER', 20),
      planned('2026-11-19', '10:00', null)
    ]
    const capped = { ...offers, maxDiscountPercent: 15 }
    const { slots: kept, dropped } = withoutUnusableOffers(slots, capped, zone)
    expect(dropped).toEqual([slots[1], slots[2], slots[3]])
    expect(kept[0]).toBe(slots[0])
    expect(kept[4]).toBe(slots[4])
    for (const s of kept.slice(1, 4))
      expect(s).toMatchObject({
        emailType: 'story',
        offer: null,
        angle: noOfferStory.angle,
        why: noOfferStory.why,
        evidence: [
          { id: 'sales:candle', fact: 'Cedar candle sold best last month.' }
        ],
        products: [{ id: 'p-candle', title: 'Cedar candle' }],
        audience: { id: 'engaged', label: 'Engaged subscribers' }
      })
    expect(kept.map((s) => [s.date, s.time])).toEqual(
      slots.map((s) => [s.date, s.time])
    )
    expect(droppedOffersNote(dropped)).toBe(
      'Left out of their emails because they would not work on that day (above your max, not one of your codes, or ended): AFTERNOON on Thu 19 Nov, CANDLE10 on Tue 17 Nov, FOREVER on Wed 18 Nov. Those emails go out without a discount.'
    )
    expect(droppedOffersNote(dropped.slice(0, 1))).toBe(
      'Left out of its email because it would not work on that day (above your max, not one of your codes, or ended): AFTERNOON on Thu 19 Nov. That email goes out without a discount.'
    )
    expect(withoutUnusableOffers(slots.slice(0, 1), offers, zone)).toEqual({
      slots: slots.slice(0, 1),
      dropped: []
    })
    expect(droppedOffersNote([])).toBeNull()
  })

  it('leave an email whose send time the clock skips as it is (not an offer problem)', () => {
    // Melbourne skips 2 to 3 am on 4 Oct 2026.
    const skipped = planned('2026-10-04', '02:30', 'FOREVER')
    expect(withoutUnusableOffers([skipped], offers, zone)).toEqual({
      slots: [skipped],
      dropped: []
    })
  })

  it('name at most ten codes, within a stored note’s 600 characters', () => {
    const many = Array.from({ length: 14 }, (_, i) =>
      planned('2026-11-17', '10:00', `A-LONG-CODE-NAME-FOR-TESTING-${i + 1}`)
    )
    const note = droppedOffersNote(many)!
    expect(note).not.toContain('TESTING-11')
    expect(note.length).toBeLessThanOrEqual(600)
    // Whole names and a whole sentence: fewer names, the rest counted.
    expect(note).toMatch(
      / and \d+ more\. Those emails go out without a discount\.$/
    )
  })

  it('log counts and days only, never a code', () => {
    const dropped = [
      planned('2026-11-19', '15:00', 'AFTERNOON'),
      planned('2026-11-17', '10:00', 'CANDLE10')
    ]
    const entry = droppedOffersEntry({
      tenantId: tenant,
      runId: 'run-1',
      dropped
    })
    expect(fallbackEntry.parse(entry)).toMatchObject({
      agent: 'plan-offers',
      reasonCode: 'offer_unusable',
      detail: { count: 2, days: ['2026-11-19', '2026-11-17'] }
    })
    expect(JSON.stringify(entry)).not.toMatch(/AFTERNOON|CANDLE10/)
  })

  it('name the left-out codes in one short note', () => {
    expect(leftOutNote([])).toBeNull()
    expect(leftOutNote(['WELCOME15'])).toBe(
      'Left out because your offers in Settings changed after they were listed: WELCOME15.'
    )
    const many = Array.from({ length: 12 }, (_, i) => `CODE${i + 1}`)
    const note = leftOutNote(many)!
    expect(note).toContain('CODE10 and 2 more.')
    expect(note).not.toContain('CODE11')
    expect(note.length).toBeLessThanOrEqual(600)
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

describe('the margin floor (PLN-039)', () => {
  it('leaves out a code between the margin cap and the owner’s max', async () => {
    const owned = (code: string, percent: number) => ({
      id: code,
      code,
      percent,
      expiresAt: null,
      ended: false
    })
    // Max 50%, but a 60% margin with a 30% floor allows only 42%.
    const source = planOfferSource(
      {
        managed: async () => ({
          maxDiscountPercent: 50,
          grossMarginPercent: 60,
          marginFloorPercent: 30,
          revision: 2,
          codes: [owned('SALE45', 45), owned('OWNER10', 10)]
        })
      },
      '2026-11-16',
      { sample: true }
    )
    const read = await readPlanOffers(source, tenant, '2026-11-16', zone)
    expect(read.maxDiscountPercent).toBe(42)
    // PLN-039b: the plan knows the floor set it, to say so.
    expect(read.limitedBy).toBe('margin_floor')
    const picked = [
      { id: 'offer:SALE45', code: 'SALE45', percent: 45, until: null },
      { id: 'offer:OWNER10', code: 'OWNER10', percent: 10, until: null }
    ]
    expect(stillUsable(picked, read, '2026-11-16', zone)).toEqual({
      usable: [
        { id: 'offer:OWNER10', code: 'OWNER10', percent: 10, until: null }
      ],
      leftOut: ['SALE45']
    })
    expect(
      offerWorksAt(slot('2026-11-17', '10:00', 'SALE45', 45), read, zone)
    ).toBe(false)
  })
})

describe('the plan’s offers when nothing is saved (ONB-057b)', () => {
  const nothing = {
    managed: async () => ({
      maxDiscountPercent: null,
      grossMarginPercent: null,
      marginFloorPercent: null,
      revision: 0,
      codes: []
    })
  }
  it('offers the sample’s codes only for the sample store', async () => {
    const sample = await readPlanOffers(
      planOfferSource(nothing, '2026-11-16', { sample: true }),
      tenant,
      '2026-11-16',
      zone
    )
    expect(sample.codes.length).toBeGreaterThan(0)
    const own = await readPlanOffers(
      planOfferSource(nothing, '2026-11-16', { sample: false }),
      tenant,
      '2026-11-16',
      zone
    )
    expect(own).toEqual({ maxDiscountPercent: 0, codes: [] })
  })

  it('uses what the owner saved for the own store, and throws when it cannot be read', async () => {
    const saved = {
      managed: async () => ({
        maxDiscountPercent: 20,
        grossMarginPercent: null,
        marginFloorPercent: null,
        revision: 1,
        codes: [
          {
            id: 'c',
            code: 'OWNER10',
            percent: 10,
            expiresAt: null,
            ended: false
          }
        ]
      })
    }
    const own = await readPlanOffers(
      planOfferSource(saved, '2026-11-16', { sample: false }),
      tenant,
      '2026-11-16',
      zone
    )
    expect(own.maxDiscountPercent).toBe(20)
    expect(own.codes.map((c) => c.code)).toEqual(['OWNER10'])
    await expect(
      readPlanOffers(
        planOfferSource(
          { managed: async () => Promise.reject(new Error('down')) },
          '2026-11-16',
          { sample: false }
        ),
        tenant,
        '2026-11-16',
        zone
      )
    ).rejects.toBeTruthy()
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
