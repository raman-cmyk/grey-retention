import { z } from 'zod'
import type { Draft } from '@/features/assembly/assemble'
import type { CatalogProduct } from '@/features/assembly/inputs'
import type { BlockBrand } from '@/features/blocks/brand'
import type { SwapBrand, SwapProduct } from '@/features/design-engine/swap'
import type { WordPools, WordRules } from '@/features/design-engine/words'
import type { Store } from './ports'

/**
 * DES-ENGINE-002b2: "Use this design" with Copy, in the email build's
 * design step. The inspiration email's stored blueprint is copied 1:1 in
 * structure with the brand's own colours, fonts, logo, photos, products,
 * prices, offer and the Copywriter's words (`libraryCopy`, run by the
 * browser job). This module turns the build's saved steps into the copy's
 * input (`copyInput`), names the ports the step uses (`LibraryCopyPort`,
 * live in `library-copy-live.ts`, faked in tests) and says, in plain words,
 * why an email that asked for Copy was drawn with coded blocks instead.
 */

/** What the browser job is given (stored in `email_copies.input`). */
export const copyInputSchema = z.object({
  brand: z.custom<SwapBrand>((v) => typeof v === 'object' && v !== null),
  products: z.array(z.custom<SwapProduct>()).max(12),
  words: z.custom<WordPools>(),
  rules: z.custom<WordRules>(),
  vocabulary: z.array(z.string().max(2_000)).max(600),
  sourceNames: z.array(z.string().max(200)).max(6),
  origins: z.array(z.string().max(200)).max(24),
  mode: z.enum(['preview', 'klaviyo'])
})
export type CopyInput = z.infer<typeof copyInputSchema>

/** A section of the copy as the email's page tells it. */
export const copiedSection = z.object({
  ordinal: z.int().min(1).max(41),
  kind: z.string().max(40),
  result: z.enum(['copied', 'library', 'left_out']),
  /** Plain words when it was built from a block or left out. */
  reason: z.string().max(600).nullable()
})
export type CopiedSection = z.infer<typeof copiedSection>

/** What the browser job records (`email_copies.result`). */
export const copyRecord = z.object({
  html: z.string().min(1).max(300_000),
  sections: z.array(copiedSection).max(41),
  pass: z.boolean(),
  leaks: z
    .array(z.object({ kind: z.string(), value: z.string().max(200) }))
    .max(200),
  footerAdded: z.boolean(),
  /** The cut photos uploaded, by index (`copy/<build>/<i>.jpg`). */
  photos: z.array(z.int().min(0).max(23)).max(24)
})
export type CopyRecord = z.infer<typeof copyRecord>

/** The placeholder a cut photo has until its link is signed. */
export const photoPlaceholder = (index: number) =>
  `https://email-copies.invalid/${index}.jpg`

export type BlueprintState =
  | { state: 'ready'; messageId: string; sourceNames: string[] }
  | { state: 'waiting' }
  | { state: 'unusable'; reason: string }

export type CopyState =
  | { state: 'queued' }
  | { state: 'done'; record: CopyRecord }
  | { state: 'failed'; reason: string }

/** The ports the design step uses for a library copy. */
export type LibraryCopyPort = {
  /** The chosen email's stored blueprint, if the workspace follows it. */
  blueprint: (competitorEmailId: string) => Promise<BlueprintState>
  /** Asks for the copy (stored once) or reads it; links signed when done. */
  copy: (
    messageId: string,
    input: CopyInput,
    photos: number
  ) => Promise<CopyState>
}

/** Why a Copy email was drawn with coded blocks, in the owner's words. */
export const copyWords = {
  waiting:
    'The design of the email you chose in Inspiration is still being measured, so this email was made with coded blocks. Create it again later to copy its design.',
  copying:
    'Copying the design of the email you chose took too long, so this email was made with coded blocks.',
  leaks:
    'The copy of the email you chose still showed something of the other brand, so this email was made with coded blocks instead (your brand’s words and photos only).',
  checks:
    'The copy of the email you chose did not pass the email checks, so this email was made with coded blocks.',
  failed: (reason: string) =>
    `The design of the email you chose in Inspiration could not be copied (${reason.replace(/\.$/, '')}), so this email was made with coded blocks.`
} as const

const headlineKeys = /^(?:heading|headline|title|name)$/i
const bodyKeys =
  /^(?:sub|subheading|detail|paras?|body|text|note|quote|answer|question|description|story)$/i
const buttonKeys = /^(?:cta|label|button)$/i
const captionKeys = /^(?:eyebrow|kicker|caption|tagline)$/i

/** The Copywriter's words by role, from the draft's blocks. */
export function wordsFromDraft(draft: Draft): WordPools {
  const pools = {
    headline: [] as string[],
    body: [] as string[],
    button: [] as string[],
    caption: [] as string[]
  }
  const add = (list: string[], v: unknown) => {
    if (typeof v === 'string' && v.trim() && !/^https?:|^data:/i.test(v))
      list.push(v.replace(/\s+/g, ' ').trim())
    if (Array.isArray(v)) for (const x of v) add(list, x)
  }
  const walk = (o: unknown) => {
    if (!o || typeof o !== 'object') return
    for (const [k, v] of Object.entries(o)) {
      if (headlineKeys.test(k) && typeof v === 'string') add(pools.headline, v)
      else if (bodyKeys.test(k)) add(pools.body, v)
      else if (buttonKeys.test(k)) add(pools.button, v)
      else if (captionKeys.test(k)) add(pools.caption, v)
      else if (typeof v === 'object') walk(v)
    }
  }
  for (const b of draft.blocks) walk(b.content)
  const uniq = (l: string[]) => [...new Set(l)]
  return {
    headline: uniq(pools.headline),
    subheadline: [],
    eyebrow: [],
    body: uniq(pools.body),
    button: uniq(pools.button),
    caption: uniq(pools.caption)
  }
}

const originOf = (u: string | undefined) => {
  try {
    const url = new URL(u ?? '')
    return url.protocol === 'https:' ? url.origin : null
  } catch {
    return null
  }
}

const picture = (src: string | undefined, alt: string) =>
  src && /^(?:https:|data:image\/)/i.test(src)
    ? { src, width: 0, height: 0, alt }
    : null

/** The brand as the swap reads it (sizes are read by the browser job). */
export function swapBrandOf(brand: BlockBrand): SwapBrand {
  return {
    name: brand.name,
    site: brand.site,
    ink: brand.ink,
    background: brand.background,
    accent: brand.accent,
    dark: brand.dark,
    headingFont: brand.font,
    bodyFont: brand.font,
    logo: picture(brand.logo, brand.name),
    logoOnDark: picture(brand.logoOnDark, brand.name),
    photos: [],
    icons: [],
    radius: Number(/^(\d+)px$/.exec(brand.radius ?? '')?.[1] ?? 8),
    address: null
  }
}

/**
 * The copy's input from the build's saved steps: the brand, the draft's
 * products in order (a compare-at price only for a confirmed sale), the
 * Copywriter's words, the money rules (the code and its percent, the max,
 * the catalog's prices, the store's approved claims) and everything the
 * brand's content says, for the leak check.
 */
export function copyInput(input: {
  store: Pick<Store, 'brand' | 'products' | 'facts'>
  draft: Draft
  rules: {
    maxDiscountPercent: number
    codes: { code: string; percent: number }[]
  }
  sourceNames: readonly string[]
  mode: 'preview' | 'klaviyo'
}): CopyInput {
  const { store, draft, rules } = input
  const byId = new Map(store.products.map((p) => [p.id, p]))
  const products: SwapProduct[] = draft.productIds
    .flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []))
    .slice(0, 12)
    .map((p: CatalogProduct) => ({
      id: p.id,
      title: p.title,
      price: p.price,
      compareAt: p.compareAtIsSale === true ? (p.compareAt ?? null) : null,
      url: p.url,
      photo: picture(p.image, p.title)
    }))
  const code = draft.code
  const own = code
    ? rules.codes.find((c) => c.code.toUpperCase() === code.toUpperCase())
    : undefined
  const freeOver =
    store.facts.freeShipping && typeof store.facts.freeShipping === 'object'
      ? [String(store.facts.freeShipping.over)]
      : []
  const words = wordsFromDraft(draft)
  const brand = swapBrandOf(store.brand)
  const claims = [...store.facts.approvedClaims]
  return {
    brand,
    products,
    words,
    rules: {
      offer: own ? { code: own.code, percent: own.percent } : null,
      maxDiscountPercent: rules.maxDiscountPercent,
      amounts: freeOver,
      claims
    },
    vocabulary: [
      brand.name,
      ...Object.values(words).flat(),
      ...products.flatMap((p) => [p.title, p.price, p.compareAt ?? '']),
      ...claims,
      ...freeOver,
      ...(own ? [own.code, `${own.percent}%`] : [])
    ].filter(Boolean),
    sourceNames: [...input.sourceNames].slice(0, 6),
    origins: [
      ...new Set(
        [
          store.brand.logo,
          store.brand.logoOnDark,
          ...products.map((p) => p.photo?.src)
        ]
          .map(originOf)
          .filter((o): o is string => !!o)
      )
    ].slice(0, 24),
    mode: input.mode
  }
}

/** How many cut photos the copy may upload (its pictures, at most 24). */
export const photosFor = (input: CopyInput) =>
  Math.min(24, input.products.length * 2 + 8)

/** The sections' plain words for the email's page (those built from a block or left out). */
export const sectionReasons = (record: CopyRecord) =>
  record.sections.flatMap((s) => (s.reason ? [s.reason] : []))
