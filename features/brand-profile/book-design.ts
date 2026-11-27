import {
  clampToken,
  stepLimits,
  tokenFromText,
  tokenKeys,
  tokenLimits,
  tokenText,
  type TokenKey,
  type TokenSource
} from '@/features/design-engine/tokens'

/**
 * PICK-006: the brand's design tokens in the Brand book, in the owner's
 * words (UI-BRAND-2's rules: he types a correction straight into the book,
 * it needs no approval, and the book is rewritten at once). Each value says
 * where it came from: his website, GROS's default (nothing was read), or
 * his own correction. A correction is checked against the email-safe range
 * here and again by the database (`private.brand_token_ok`); an empty field
 * takes his correction back, so the website's value (or the default)
 * returns.
 */

export const designGroups: { label: string; keys: TokenKey[] }[] = [
  { label: 'Spacing', keys: ['spacing.base', 'spacing.steps'] },
  {
    label: 'Type',
    keys: [
      'type.body',
      'type.h1',
      'type.h2',
      'type.h3',
      'type.lineHeight',
      'type.headingCase'
    ]
  },
  { label: 'Corners', keys: ['radius.button', 'radius.card', 'radius.image'] },
  {
    label: 'Buttons',
    keys: [
      'button.style',
      'button.paddingX',
      'button.paddingY',
      'button.case',
      'button.weight'
    ]
  }
]

export const tokenLabels: Record<TokenKey, string> = {
  'spacing.base': 'Spacing unit',
  'spacing.steps': 'Spacing scale',
  'type.body': 'Body text',
  'type.h1': 'Headline',
  'type.h2': 'Section heading',
  'type.h3': 'Small heading',
  'type.lineHeight': 'Line height',
  'type.headingCase': 'Heading case',
  'radius.button': 'Button corners',
  'radius.card': 'Card corners',
  'radius.image': 'Picture corners',
  'button.style': 'Button style',
  'button.paddingX': 'Button side space',
  'button.paddingY': 'Button top and bottom space',
  'button.case': 'Button text case',
  'button.weight': 'Button text weight'
}

/** Where a value came from, in words. */
export const sourceText = (source: TokenSource, assistant = 'GROS') =>
  source === 'site'
    ? 'From your website'
    : source === 'owner'
      ? 'Your correction'
      : `${assistant} default`

const caseWords = { none: 'As written', uppercase: 'Capitals' } as const
const styleWords = { filled: 'Filled', outline: 'Outline' } as const

/** A token's value in words: "8 px", "4, 8, 16 px", "1.5", "Capitals". */
export function tokenWords(key: TokenKey, value: unknown): string {
  if (key === 'spacing.steps')
    return Array.isArray(value) ? `${value.join(', ')} px` : ''
  if (key === 'type.headingCase' || key === 'button.case')
    return caseWords[value as keyof typeof caseWords] ?? ''
  if (key === 'button.style')
    return styleWords[value as keyof typeof styleWords] ?? ''
  if (typeof value !== 'number') return ''
  if (key === 'type.lineHeight' || key === 'button.weight') return String(value)
  return `${value} px`
}

/** How to write each token, said under its field. */
export function tokenHelp(key: TokenKey): string {
  if (key === 'spacing.steps')
    return `${stepLimits.min} to ${stepLimits.max} sizes from ${tokenLimits['spacing.steps'].min} to ${tokenLimits['spacing.steps'].max} px, like 8, 16, 24, 32`
  if (key === 'type.headingCase' || key === 'button.case')
    return 'As written, or capitals'
  if (key === 'button.style') return 'Filled, or outline'
  if (key === 'button.weight') return '400 to 800, like 700 for bold'
  if (key === 'type.lineHeight') return 'From 1.2 to 1.8, like 1.5'
  const range = tokenLimits[key as keyof typeof tokenLimits]
  return `Whole px from ${range.min} to ${range.max}`
}

export type TokenInput = { value: string | null } | { error: string }

/**
 * The owner's words for a token as the checked value the database takes
 * (`tokenText`): "8px" or "8" is 8, "capitals" is uppercase, "as written"
 * is none. Outside the email-safe range is refused with the range, never
 * changed quietly. Empty: take his correction back (`value: null`).
 */
export function tokenInput(key: TokenKey, typed: string): TokenInput {
  const text = typed
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/\s*px$/, '')
  if (!text) return { value: null }
  const label = tokenLabels[key]
  const refuse = { error: `${label}: ${tokenHelp(key).toLowerCase()}.` }
  if (key === 'type.headingCase' || key === 'button.case') {
    if (['capitals', 'capital', 'caps', 'uppercase', 'upper'].includes(text))
      return { value: 'uppercase' }
    if (['as written', 'none', 'normal', 'no'].includes(text))
      return { value: 'none' }
    return refuse
  }
  if (key === 'button.style')
    return text === 'filled' || text === 'outline' ? { value: text } : refuse
  if (key === 'spacing.steps') {
    const sizes = text.split(/\s*,\s*|\s+/).map(Number)
    if (sizes.some((n) => !Number.isInteger(n))) return refuse
    const sorted = [...new Set(sizes)].sort((a, b) => a - b)
    const clean = clampToken(key, sorted)
    return clean &&
      clean.length === sorted.length &&
      clean.every((v, i) => v === sorted[i])
      ? { value: tokenText(key, clean) }
      : refuse
  }
  const n = Number(text)
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(text) || !Number.isFinite(n))
    return refuse
  const clean = clampToken(key, n)
  if (clean !== n) return refuse
  return { value: tokenText(key, clean) }
}

/** The value a stored correction holds, in words (it may no longer read). */
export function correctionWords(key: TokenKey, value: string | null) {
  const v = tokenFromText(key, value)
  return v === undefined ? null : tokenWords(key, v)
}

export { tokenKeys }
