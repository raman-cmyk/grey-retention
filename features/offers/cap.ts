/**
 * PLN-039 (owner pick #39, D27): the margin floor. Products carry no cost
 * in Klaviyo, so the owner gives their usual gross margin and the lowest
 * margin they accept after a discount. With margin g and floor f (both as
 * fractions), a discount d keeps the margin at or above the floor while
 * (1 - g) / (1 - d) <= 1 - f, so d <= 1 - (1 - g) / (1 - f).
 *
 * Example: a 60% margin with a 30% floor allows at most 42% off (42% leaves
 * 30.9% margin, 43% would leave 29.8%).
 */

/** Which owner setting sets the discount agents may use. */
export type DiscountLimit = 'max_discount' | 'margin_floor'

export type MarginFloor = {
  /** Whole percent, 1 to 99. */
  grossMarginPercent: number
  /** Whole percent, 0 up to just below the gross margin. */
  marginFloorPercent: number
}

const valid = (m: MarginFloor) =>
  Number.isInteger(m.grossMarginPercent) &&
  Number.isInteger(m.marginFloorPercent) &&
  m.grossMarginPercent >= 1 &&
  m.grossMarginPercent <= 99 &&
  m.marginFloorPercent >= 0 &&
  m.marginFloorPercent < m.grossMarginPercent

/**
 * The highest whole percent off that keeps the margin at or above the
 * floor, or null when the numbers are not a valid pair. Whole-number
 * arithmetic, so 60/30 is exactly 42 (3000 / 70, floored).
 */
export function marginCap(m: MarginFloor): number | null {
  if (!valid(m)) return null
  const { grossMarginPercent: g, marginFloorPercent: f } = m
  return Math.floor((100 * (g - f)) / (100 - f))
}

/**
 * The discount agents may use: the lower of the owner's max discount and the
 * margin cap. No max discount means no discount (DSC-001), whatever the
 * margin. A missing or invalid margin pair leaves the max discount as is.
 * On a tie the max discount is named, since it is what the owner typed.
 */
export function discountCap(input: {
  maxDiscountPercent: number | null
  grossMarginPercent?: number | null
  marginFloorPercent?: number | null
}): { maxDiscountPercent: number | null; limitedBy: DiscountLimit | null } {
  const max = input.maxDiscountPercent
  if (max === null) return { maxDiscountPercent: null, limitedBy: null }
  const cap =
    input.grossMarginPercent == null || input.marginFloorPercent == null
      ? null
      : marginCap({
          grossMarginPercent: input.grossMarginPercent,
          marginFloorPercent: input.marginFloorPercent
        })
  return cap !== null && cap < max
    ? { maxDiscountPercent: cap, limitedBy: 'margin_floor' }
    : { maxDiscountPercent: max, limitedBy: 'max_discount' }
}
