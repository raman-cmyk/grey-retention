/**
 * The Brand book's four confirmed facts as the owner types them
 * (UI-BRAND-2), turned into the checked values the database takes
 * (`private.brand_fact_ok`, ONB-058): free shipping `always`, `never` or
 * `over 75`; return and guarantee days `0` to `3650` (`0`: none); delivery
 * `min-max` calendar days, at most 90. An empty field makes the fact
 * unknown, so no email claims anything about it.
 */
export const factKeys = [
  'freeShipping',
  'returnDays',
  'guaranteeDays',
  'deliveryDays'
] as const
export type FactKey = (typeof factKeys)[number]

export const factLabels: Record<FactKey, string> = {
  freeShipping: 'Free shipping',
  returnDays: 'Returns',
  guaranteeDays: 'Money-back guarantee',
  deliveryDays: 'Delivery time'
}

/** How to write each fact, said under its field. */
export const factHelp: Record<FactKey, string> = {
  freeShipping: 'Every order, never, or an amount like over 75',
  returnDays: 'Days to return an order. 0 means no returns',
  guaranteeDays: 'Days of the guarantee. 0 means none',
  deliveryDays: 'Days like 3 to 7, at most 90'
}

const errors: Record<FactKey, string> = {
  freeShipping:
    'Free shipping: write every order, never, or an amount like over 75.',
  returnDays: 'Returns: write a number of days from 0 to 3650.',
  guaranteeDays: 'Money-back guarantee: write a number of days from 0 to 3650.',
  deliveryDays: 'Delivery time: write the days like 3 to 7, at most 90.'
}

export type FactInput = { value: string | null } | { error: string }

/** The owner's words for a fact, as the database's checked value. */
export function factInput(key: FactKey, typed: string): FactInput {
  const text = typed.trim().replace(/\s+/g, ' ').toLowerCase()
  if (!text) return { value: null }
  if (key === 'freeShipping') {
    if (['always', 'every order', 'on every order', 'yes'].includes(text))
      return { value: 'always' }
    if (['never', 'no', 'none'].includes(text)) return { value: 'never' }
    const over = /^(?:over )?(\d{1,7}(?:\.\d{1,2})?)$/.exec(text)
    if (over) {
      const amount = Number(over[1])
      return { value: `over ${String(amount)}` }
    }
    return { error: errors[key] }
  }
  if (key === 'deliveryDays') {
    const window = /^(\d{1,2})(?: ?(?:-|to) ?(\d{1,2}))?(?: days?)?$/.exec(text)
    if (!window) return { error: errors[key] }
    const min = Number(window[1])
    const max = Number(window[2] ?? window[1])
    return max >= 1 && min <= max && max <= 90
      ? { value: `${min}-${max}` }
      : { error: errors[key] }
  }
  const days = /^(\d{1,4})(?: days?)?$/.exec(text)
  if (!days || Number(days[1]) > 3650) return { error: errors[key] }
  return { value: String(Number(days[1])) }
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
const whole = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null

/** A stored book fact as the words the owner edits ('' when unknown). */
export function factText(key: FactKey, stored: unknown): string {
  if (key === 'freeShipping') {
    if (stored === 'always') return 'every order'
    if (stored === 'never') return 'never'
    const over = whole(record(stored).over)
    return over === null ? '' : `over ${over}`
  }
  if (key === 'deliveryDays') {
    const min = whole(record(stored).min)
    const max = whole(record(stored).max)
    if (min === null || max === null) return ''
    return min === max ? String(max) : `${min} to ${max}`
  }
  const days = whole(stored)
  return days === null ? '' : String(days)
}
