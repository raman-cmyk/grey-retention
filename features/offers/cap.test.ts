import { describe, expect, it } from 'vitest'
import { discountCap, marginCap } from './cap'

/** The margin left after `d` percent off, for a check by hand. */
const marginAfter = (gross: number, d: number) =>
  1 - (1 - gross / 100) / (1 - d / 100)

describe('marginCap (PLN-039)', () => {
  it('allows 42% off a 60% margin with a 30% floor, and not 43%', () => {
    expect(marginCap({ grossMarginPercent: 60, marginFloorPercent: 30 })).toBe(
      42
    )
    expect(marginAfter(60, 42)).toBeGreaterThanOrEqual(0.3)
    expect(marginAfter(60, 43)).toBeLessThan(0.3)
  })

  it('is the highest whole percent that keeps the floor, for every valid pair', () => {
    for (let g = 1; g <= 99; g++)
      for (let f = 0; f < g; f++) {
        const cap = marginCap({ grossMarginPercent: g, marginFloorPercent: f })
        expect(cap).not.toBeNull()
        expect(cap).toBeGreaterThanOrEqual(0)
        expect(cap).toBeLessThanOrEqual(g)
        // Exact whole-number checks: (100-g)*100 <= (100-f)*(100-d).
        expect((100 - g) * 100).toBeLessThanOrEqual((100 - f) * (100 - cap!))
        expect((100 - g) * 100).toBeGreaterThan((100 - f) * (100 - cap! - 1))
      }
  })

  it('a floor of 0 allows up to the whole margin, and exact cases stay exact', () => {
    expect(marginCap({ grossMarginPercent: 60, marginFloorPercent: 0 })).toBe(
      60
    )
    // 1 - 0.5/0.75 = 1/3 → 33; 1 - 0.5/0.5 is not valid (floor = margin).
    expect(marginCap({ grossMarginPercent: 50, marginFloorPercent: 25 })).toBe(
      33
    )
    expect(marginCap({ grossMarginPercent: 75, marginFloorPercent: 50 })).toBe(
      50
    )
  })

  it('refuses pairs that cannot be saved', () => {
    for (const [g, f] of [
      [40, 40],
      [40, 50],
      [0, 0],
      [100, 30],
      [60, -1],
      [60.5, 30]
    ])
      expect(
        marginCap({ grossMarginPercent: g, marginFloorPercent: f })
      ).toBeNull()
  })
})

describe('discountCap (PLN-039)', () => {
  it('uses the lower of the max discount and the margin cap, and names it', () => {
    expect(
      discountCap({
        maxDiscountPercent: 50,
        grossMarginPercent: 60,
        marginFloorPercent: 30
      })
    ).toEqual({ maxDiscountPercent: 42, limitedBy: 'margin_floor' })
    expect(
      discountCap({
        maxDiscountPercent: 20,
        grossMarginPercent: 60,
        marginFloorPercent: 30
      })
    ).toEqual({ maxDiscountPercent: 20, limitedBy: 'max_discount' })
    // A tie names the max discount: it is what the owner typed.
    expect(
      discountCap({
        maxDiscountPercent: 42,
        grossMarginPercent: 60,
        marginFloorPercent: 30
      })
    ).toEqual({ maxDiscountPercent: 42, limitedBy: 'max_discount' })
  })

  it('no max discount means no discount, whatever the margin', () => {
    expect(
      discountCap({
        maxDiscountPercent: null,
        grossMarginPercent: 60,
        marginFloorPercent: 30
      })
    ).toEqual({ maxDiscountPercent: null, limitedBy: null })
  })

  it('a missing or broken margin pair leaves the max discount as is', () => {
    for (const margin of [
      {},
      { grossMarginPercent: 60, marginFloorPercent: null },
      { grossMarginPercent: null, marginFloorPercent: 30 },
      { grossMarginPercent: 30, marginFloorPercent: 60 }
    ])
      expect(discountCap({ maxDiscountPercent: 25, ...margin })).toEqual({
        maxDiscountPercent: 25,
        limitedBy: 'max_discount'
      })
  })

  it('a floor just under the margin leaves little room, and a fractional floor is ignored', () => {
    expect(
      discountCap({
        maxDiscountPercent: 25,
        grossMarginPercent: 31,
        marginFloorPercent: 30
      })
    ).toEqual({ maxDiscountPercent: 1, limitedBy: 'margin_floor' })
    expect(
      discountCap({
        maxDiscountPercent: 25,
        grossMarginPercent: 30,
        marginFloorPercent: 29.5
      })
    ).toEqual({ maxDiscountPercent: 25, limitedBy: 'max_discount' })
  })
})
