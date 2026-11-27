import { z } from 'zod'

/**
 * PICK-006 (owner pick #6, "Design tokens per brand"): the brand's spacing
 * scale, type scale, corner radius and button style, read from its own
 * website (`features/onboarding/site/tokens.ts`), kept in the Brand book
 * with where each value came from, corrected by the owner, and used by the
 * design engine wherever it puts the brand's look on an email.
 *
 * Every value is clamped to what an email can carry safely (`tokenLimits`):
 * a site's 80 px hero headline or 999 px pill radius never reaches an
 * inbox as it is. When the site gives nothing, the value is GROS's
 * **default** (`tokenDefaults`): exactly what the coded blocks already
 * drew before tokens existed, so a brand with no site read looks as it
 * did. A default never changes a library layout: in Copy and Scratch only
 * a value from the site or the owner replaces the layout's own.
 *
 * Each value records its source: `site` (read from the brand's website),
 * `default` (GROS's own, nothing was read) or `owner` (the owner corrected
 * it in the Brand book). The owner's value wins, then the site's, then the
 * default (`resolveTokens`).
 */

export const tokenKeys = [
  'spacing.base',
  'spacing.steps',
  'type.body',
  'type.h1',
  'type.h2',
  'type.h3',
  'type.lineHeight',
  'type.headingCase',
  'radius.button',
  'radius.card',
  'radius.image',
  'button.style',
  'button.paddingX',
  'button.paddingY',
  'button.case',
  'button.weight'
] as const
export type TokenKey = (typeof tokenKeys)[number]

export type TextCase = 'none' | 'uppercase'
export type ButtonStyle = 'filled' | 'outline'

/** Every token's value, px unless said otherwise. */
export type TokenValues = {
  /** The spacing unit the site's spaces are multiples of. */
  'spacing.base': number
  /** The spaces the site uses, smallest first. */
  'spacing.steps': number[]
  /** Body text size. */
  'type.body': number
  /** Heading sizes: the main headline, a section heading, a small heading. */
  'type.h1': number
  'type.h2': number
  'type.h3': number
  /** Body line height, as a multiple of the size (1.5). */
  'type.lineHeight': number
  'type.headingCase': TextCase
  'radius.button': number
  'radius.card': number
  'radius.image': number
  'button.style': ButtonStyle
  /** Space left and right of a button's words, and above and below. */
  'button.paddingX': number
  'button.paddingY': number
  'button.case': TextCase
  /** 400 to 800. */
  'button.weight': number
}

export type TokenSource = 'site' | 'default' | 'owner'
export type DesignTokens = {
  [K in TokenKey]: { value: TokenValues[K]; source: TokenSource }
}
/** What a site read found: only the tokens it could read, clamped. */
export type SiteTokens = Partial<TokenValues>

/**
 * GROS's defaults, used when the site gives nothing: the coded blocks'
 * own look before tokens (`features/blocks/render.ts`): a 4 px unit with
 * 28 px between a block's edge and its words and 32 px at the sides, 16 px
 * body text at 1.5, headings of 32, 22 and 18 px as written, 8 px corners,
 * and a filled button with 14 × 32 px of padding in bold, as written.
 */
export const tokenDefaults: TokenValues = {
  'spacing.base': 4,
  'spacing.steps': [4, 8, 12, 16, 20, 24, 28, 32, 40, 48],
  'type.body': 16,
  'type.h1': 32,
  'type.h2': 22,
  'type.h3': 18,
  'type.lineHeight': 1.5,
  'type.headingCase': 'none',
  'radius.button': 8,
  'radius.card': 8,
  'radius.image': 8,
  'button.style': 'filled',
  'button.paddingX': 32,
  'button.paddingY': 14,
  'button.case': 'none',
  'button.weight': 700
}

type Range = { min: number; max: number; step: number }
/**
 * The email-safe ranges: what every inbox draws well at 600 px and on a
 * 375 px phone. Text never smaller than 14 px (16 for body is the norm),
 * headlines never so large that a short one breaks into many lines on a
 * phone, corners at most 24 px (a 48 px button at 24 is already a pill),
 * button padding that still fits a phone, and weights every client has.
 */
export const tokenLimits = {
  'spacing.base': { min: 2, max: 12, step: 1 },
  'spacing.steps': { min: 2, max: 64, step: 1 },
  'type.body': { min: 14, max: 20, step: 1 },
  'type.h1': { min: 24, max: 48, step: 1 },
  'type.h2': { min: 18, max: 36, step: 1 },
  'type.h3': { min: 16, max: 28, step: 1 },
  'type.lineHeight': { min: 1.2, max: 1.8, step: 0.05 },
  'radius.button': { min: 0, max: 24, step: 1 },
  'radius.card': { min: 0, max: 24, step: 1 },
  'radius.image': { min: 0, max: 24, step: 1 },
  'button.paddingX': { min: 12, max: 48, step: 1 },
  'button.paddingY': { min: 8, max: 20, step: 1 },
  'button.weight': { min: 400, max: 800, step: 100 }
} as const satisfies Partial<Record<TokenKey, Range>>
/** Fewest and most spaces a scale keeps. */
export const stepLimits = { min: 2, max: 10 }

const enums = {
  'type.headingCase': ['none', 'uppercase'],
  'button.case': ['none', 'uppercase'],
  'button.style': ['filled', 'outline']
} as const satisfies Partial<Record<TokenKey, readonly string[]>>

const isEnumKey = (key: TokenKey): key is keyof typeof enums => key in enums

/** A number inside its range, on its step (no float noise), or undefined. */
function clampNumber(value: unknown, range: Range): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const on = Math.round(value / range.step) * range.step
  const fixed = Number(on.toFixed(2))
  return Math.min(range.max, Math.max(range.min, fixed))
}

/** A scale of spaces: whole px in range, each once, smallest first. */
function clampSteps(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined
  const range = tokenLimits['spacing.steps']
  const steps = [
    ...new Set(
      value
        .map((v) => clampNumber(v, range))
        .filter((v): v is number => v !== undefined)
    )
  ]
    .sort((a, b) => a - b)
    .slice(0, stepLimits.max)
  return steps.length >= stepLimits.min ? steps : undefined
}

/** One token clamped to its email-safe range, or undefined when it is not one. */
export function clampToken<K extends TokenKey>(
  key: K,
  value: unknown
): TokenValues[K] | undefined {
  if (key === 'spacing.steps') return clampSteps(value) as TokenValues[K]
  if (isEnumKey(key))
    return (enums[key] as readonly unknown[]).includes(value)
      ? (value as TokenValues[K])
      : undefined
  return clampNumber(
    value,
    tokenLimits[key as keyof typeof tokenLimits]
  ) as TokenValues[K]
}

/** Only the tokens a read could use, each clamped; anything else dropped. */
export function clampTokens(found: Readonly<Record<string, unknown>>) {
  const out: SiteTokens = {}
  for (const key of tokenKeys) {
    if (!(key in found)) continue
    const v = clampToken(key, found[key])
    if (v !== undefined) (out as Record<string, unknown>)[key] = v
  }
  return out
}

/** The spaces of a unit when the site named none: 1, 2, 3, 4, 6, 8 and 12 units. */
export const stepsOf = (base: number) =>
  clampSteps(
    [1, 2, 3, 4, 6, 8, 12]
      .map((m) => m * base)
      .filter((v) => v <= tokenLimits['spacing.steps'].max)
  ) ?? [base, base * 2]

/**
 * The brand's tokens: the owner's value, else the site's, else GROS's
 * default, each clamped and with its source. Headings never grow smaller
 * than the text under them (a small heading is at least the body size, a
 * section heading at least the small one, the headline at least that).
 * The steps of a unit the site or owner gave, but no scale, are its own
 * multiples (`stepsOf`).
 */
export function resolveTokens({
  site,
  owner
}: {
  site?: Readonly<Record<string, unknown>> | null
  owner?: Readonly<Record<string, unknown>> | null
}): DesignTokens {
  const fromSite = clampTokens(site ?? {})
  const fromOwner = clampTokens(owner ?? {})
  const out = {} as Record<TokenKey, { value: unknown; source: TokenSource }>
  for (const key of tokenKeys) {
    if (fromOwner[key] !== undefined)
      out[key] = { value: fromOwner[key], source: 'owner' }
    else if (fromSite[key] !== undefined)
      out[key] = { value: fromSite[key], source: 'site' }
    else out[key] = { value: tokenDefaults[key], source: 'default' }
  }
  const tokens = out as DesignTokens
  if (
    tokens['spacing.steps'].source === 'default' &&
    tokens['spacing.base'].source !== 'default'
  )
    tokens['spacing.steps'] = {
      value: stepsOf(tokens['spacing.base'].value),
      source: 'default'
    }
  // A heading is never smaller than what comes below it.
  const body = tokens['type.body'].value
  const h3 = tokens['type.h3']
  if (h3.value < body) tokens['type.h3'] = { ...h3, value: body }
  const h2 = tokens['type.h2']
  if (h2.value < tokens['type.h3'].value)
    tokens['type.h2'] = { ...h2, value: tokens['type.h3'].value }
  const h1 = tokens['type.h1']
  if (h1.value < tokens['type.h2'].value)
    tokens['type.h1'] = { ...h1, value: tokens['type.h2'].value }
  return tokens
}

/** The tokens' values only. */
export const tokenValues = (tokens: DesignTokens): TokenValues =>
  Object.fromEntries(tokenKeys.map((k) => [k, tokens[k].value])) as TokenValues

/** The values the site or the owner gave (a default is left to the layout). */
export const givenTokens = (tokens: DesignTokens): SiteTokens =>
  Object.fromEntries(
    tokenKeys.flatMap((k) =>
      tokens[k].source === 'default' ? [] : [[k, tokens[k].value]]
    )
  ) as SiteTokens

/** The step of `steps` nearest to `value` (the smaller one on a tie). */
export function snapTo(value: number, steps: readonly number[]): number {
  let best = steps[0] ?? value
  for (const s of steps)
    if (Math.abs(s - value) < Math.abs(best - value)) best = s
  return best
}

/**
 * The token as the owner writes it in the Brand book and the database
 * keeps it (`private.brand_token_ok`): a whole number of px ("8"), a line
 * height ("1.5"), the spaces as a list ("4, 8, 16, 24"), or one of the
 * words of its kind (filled or outline; none or uppercase).
 */
export function tokenText(key: TokenKey, value: unknown): string {
  if (key === 'spacing.steps')
    return Array.isArray(value) ? value.join(', ') : ''
  if (typeof value === 'number') return String(value)
  return typeof value === 'string' ? value : ''
}

/**
 * The owner's typed value as the token, clamped, or undefined when the
 * words do not fit (a stored correction that no longer reads is skipped).
 */
export function tokenFromText<K extends TokenKey>(
  key: K,
  text: string | null | undefined
): TokenValues[K] | undefined {
  const t = (text ?? '').trim().toLowerCase()
  if (!t) return undefined
  if (key === 'spacing.steps') {
    if (!/^\d{1,2}(?:\s*,\s*\d{1,2}){1,9}$/.test(t)) return undefined
    return clampToken(
      key,
      t.split(',').map((n) => Number(n.trim()))
    )
  }
  if (isEnumKey(key)) return clampToken(key, t)
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(t)) return undefined
  return clampToken(key, Number(t))
}

/** One token as the copy job's input carries it (schema checked again there). */
const tokenSchema = (value: z.ZodType) =>
  z.strictObject({
    value,
    source: z.enum(['site', 'default', 'owner'])
  })
const px = (key: keyof typeof tokenLimits) =>
  z.number().min(tokenLimits[key].min).max(tokenLimits[key].max)
const caseSchema = z.enum(['none', 'uppercase'])

/** The tokens as stored with a copy's input (`email_copies.input.brand.tokens`). */
export const designTokensSchema = z.strictObject({
  'spacing.base': tokenSchema(px('spacing.base')),
  'spacing.steps': tokenSchema(
    z.array(px('spacing.steps')).min(stepLimits.min).max(stepLimits.max)
  ),
  'type.body': tokenSchema(px('type.body')),
  'type.h1': tokenSchema(px('type.h1')),
  'type.h2': tokenSchema(px('type.h2')),
  'type.h3': tokenSchema(px('type.h3')),
  'type.lineHeight': tokenSchema(px('type.lineHeight')),
  'type.headingCase': tokenSchema(caseSchema),
  'radius.button': tokenSchema(px('radius.button')),
  'radius.card': tokenSchema(px('radius.card')),
  'radius.image': tokenSchema(px('radius.image')),
  'button.style': tokenSchema(z.enum(['filled', 'outline'])),
  'button.paddingX': tokenSchema(px('button.paddingX')),
  'button.paddingY': tokenSchema(px('button.paddingY')),
  'button.case': tokenSchema(caseSchema),
  'button.weight': tokenSchema(px('button.weight'))
})
