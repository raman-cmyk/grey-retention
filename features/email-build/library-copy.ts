import { z } from 'zod'
import type { Draft } from '@/features/assembly/assemble'
import type { CatalogProduct } from '@/features/assembly/inputs'
import type { BlockBrand } from '@/features/blocks/brand'
import type {
  SwapBrand,
  SwapPicture,
  SwapProduct
} from '@/features/design-engine/swap'
import type { WordPools, WordRules } from '@/features/design-engine/words'
import {
  designTokensSchema,
  type DesignTokens
} from '@/features/design-engine/tokens'
import type { WebFont } from '@/features/studio/design-step'
import type { Store } from './ports'
import type { LibraryBlock } from './scratch'

/**
 * DES-ENGINE-002b2: "Use this design" with Copy, in the email build's
 * design step. The inspiration email's stored blueprint is copied 1:1 in
 * structure with the brand's own colours, fonts, logo, photos, products,
 * prices, offer and the Copywriter's words (`libraryCopy`, run by the
 * browser job, `scripts/design-copies.mjs`). This module turns the build's
 * saved steps into the copy's input (`copyInput`), names the ports the
 * step uses (`LibraryCopyPort`, live in `library-copy-live.ts`, faked in
 * tests), the record the browser job hands back (`copyRecord`), and says,
 * in plain words, why an email that asked for Copy was drawn with coded
 * blocks instead.
 *
 * The input never says where photos may be fetched from: the browser job
 * fetches only from the server's fixed list (`photoOrigins`), whatever a
 * store's catalog links to.
 */

/**
 * The owner's switch for the library copy in "Create email": off unless
 * `DESIGN_LIBRARY_COPY=on` (on in the local fake mode and the tests).
 */
export const libraryCopyOn = (
  env: Readonly<Record<string, string | undefined>>
) => env.DESIGN_LIBRARY_COPY?.trim() === 'on'

/** At most this many cut photos one copy uploads (the bucket's rule). */
export const maxCopyPhotos = 24

const text = (max: number) => z.string().max(max)
const picture = z.looseObject({
  src: text(2_000),
  width: z.number().min(0).max(20_000),
  height: z.number().min(0).max(20_000),
  alt: text(300)
})
const pool = z.array(text(2_000)).max(80)

/** What the browser job is given (stored in `email_copies.input`). */
export const copyInputSchema = z.object({
  brand: z.looseObject({
    name: text(200),
    site: text(2_000),
    ink: text(20),
    background: text(20),
    accent: text(20),
    dark: text(20),
    headingFont: text(200),
    bodyFont: text(200),
    logo: picture.nullable(),
    logoOnDark: picture.nullable().optional(),
    photos: z.array(picture).max(8).optional(),
    /** PICK-006: the brand's design tokens, with their sources. */
    tokens: designTokensSchema.optional()
  }),
  products: z
    .array(
      z.looseObject({
        id: text(200),
        title: text(300),
        price: text(40),
        compareAt: text(40).nullable().optional(),
        url: text(2_000),
        photo: picture.nullable()
      })
    )
    .max(12),
  words: z.object({
    headline: pool,
    subheadline: pool.optional(),
    eyebrow: pool.optional(),
    body: pool,
    button: pool,
    caption: pool.optional()
  }),
  rules: z.object({
    offer: z
      .object({ code: text(60), percent: z.number().min(0).max(100) })
      .nullable(),
    maxDiscountPercent: z.number().min(0).max(100),
    amounts: z.array(text(40)).max(40).optional(),
    claims: z.array(text(600)).max(40).optional()
  }),
  vocabulary: z.array(text(2_000)).max(600),
  sourceNames: z.array(text(200)).max(6),
  mode: z.enum(['preview', 'klaviyo']),
  /** DES-ENGINE-003b: the brand's own uploaded design: its look is kept. */
  keepLook: z.boolean().optional()
})
export type CopyInput = {
  brand: SwapBrand
  products: SwapProduct[]
  words: WordPools
  rules: WordRules
  vocabulary: string[]
  sourceNames: string[]
  mode: 'preview' | 'klaviyo'
  keepLook?: boolean
}

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
  sections: z.array(copiedSection).min(1).max(41),
  pass: z.boolean(),
  leaks: z
    .array(z.object({ kind: z.string().max(20), value: z.string().max(200) }))
    .max(200),
  footerAdded: z.boolean(),
  /** DES-ENGINE-003b: an own design's look problems (`lookProblems`); empty when kept. */
  look: z.array(z.string().max(300)).max(60).optional(),
  /** The cut photos uploaded, by index (`<workspace>/<build>/<lease>/<i>.jpg`). */
  photos: z
    .array(
      z
        .int()
        .min(0)
        .max(maxCopyPhotos - 1)
    )
    .max(maxCopyPhotos)
})
export type CopyRecord = z.infer<typeof copyRecord>

/**
 * Each recorded photo as the database pinned it (`record_email_copy`): its
 * path in its claim's folder, its stored tag and size, checked again
 * before its link is signed.
 */
export const storedPhotos = z
  .array(
    z.object({
      index: z
        .int()
        .min(0)
        .max(maxCopyPhotos - 1),
      path: z
        .string()
        .regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/\d{1,2}\.jpg$/),
      etag: z.string().min(1).max(200),
      size: z.number().int().min(0).nullable()
    })
  )
  .max(maxCopyPhotos)
export type StoredPhotos = z.infer<typeof storedPhotos>

/** The placeholder a cut photo has until its link is signed (`cutPlaceholder`). */
export const photoPlaceholder = (index: number) =>
  `https://email-copies.invalid/${index}.jpg`

/**
 * Where the browser job stores a cut photo (the private `email-copies`
 * bucket): its claim's own folder, so a stale claim never touches a
 * recorded photo.
 */
export const copyPhotoPath = (
  tenant: string,
  build: string,
  lease: string,
  index: number
) => `${tenant}/${build}/${lease}/${index}.jpg`

/** Why the browser job could not copy an email, in the owner's words. */
export const copyFailures = {
  copy_failed: 'the copy could not be drawn',
  copy_leaked:
    'the copy still showed something of the other brand when GROS checked it',
  build_moved_on: 'the email was already being made another way',
  photo_changed: 'one of its photos changed after it was copied',
  too_many_photos: 'it needs more photos than one copy can hold',
  blueprint_gone: 'its measured design is no longer stored',
  source_missing: 'the original email is no longer stored',
  copy_job_failed: 'the copying job failed 4 times',
  input_invalid: 'what GROS saved for the copy could not be read',
  /** DES-ENGINE-004b */
  block_unusable: 'one of its library layouts can no longer be used'
} as const
export type CopyFailure = keyof typeof copyFailures

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
  /** The chosen email's stored blueprint, if the workspace may see it. */
  blueprint: (competitorEmailId: string) => Promise<BlueprintState>
  /**
   * Asks for the copy (stored once) or reads it; when done, its photos'
   * placeholders are their signed links.
   */
  copy: (
    messageId: string,
    input: CopyInput,
    photos: number
  ) => Promise<CopyState>
  /**
   * DES-ENGINE-003b: the workspace's own uploaded email this build copies
   * (`email_builds.upload_id`), if any, its state and its copy.
   */
  upload?: string
  uploadBlueprint?: (uploadId: string) => Promise<UploadBlueprintState>
  copyUpload?: (
    uploadId: string,
    input: CopyInput,
    photos: number
  ) => Promise<CopyState>
  /**
   * DES-ENGINE-004b: a Scratch build with the library on
   * (`DESIGN_LIBRARY_SCRATCH=on`): the blocks the workspace may use and its
   * last Scratch emails' picks, and the copy of the picked blocks.
   */
  scratch?: {
    library: () => Promise<{ blocks: LibraryBlock[]; recent: string[] }>
    /** The pick this build's copy already asked for, if any. */
    stored: () => Promise<string[] | null>
    copy: (
      blocks: readonly string[],
      input: CopyInput,
      photos: number
    ) => Promise<CopyState>
  }
}

export type UploadBlueprintState =
  | { state: 'ready'; design: 'own' | 'other' }
  | { state: 'waiting' }
  | { state: 'unusable'; reason: string }

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
    `The design of the email you chose in Inspiration could not be copied (${reason.replace(/\.$/, '')}), so this email was made with coded blocks.`,
  /** DES-ENGINE-003b: the owner's own uploaded email. */
  uploadWaiting:
    'Your email is still being read, so this email was made with coded blocks. Create it again later to copy its design.',
  uploadFailed: (reason: string) =>
    `The design of your email could not be copied (${reason.replace(/\.$/, '')}), so this email was made with coded blocks.`,
  uploadLook:
    'The copy of your own design did not keep its look (its colours, fonts or pictures), so this email was made with coded blocks.',
  uploadTooLittle: (copied: number, total: number) =>
    `Only ${copied} of the ${total} sections of your email could be copied, so this email was made with coded blocks.`
} as const

/** DES-ENGINE-004b: why a Scratch email was drawn with coded blocks instead of from the library. */
export const scratchWords = {
  none: (reason: string) =>
    `GROS could not build this email from the block library (${reason.replace(/\.$/, '')}), so it was made with coded blocks.`,
  copying:
    'Drawing this email from the block library took too long, so it was made with coded blocks.',
  failed: (reason: string) =>
    `This email could not be drawn from the block library (${reason.replace(/\.$/, '')}), so it was made with coded blocks.`,
  leaks:
    'The email drawn from the block library still showed something of another brand when GROS checked it, so it was made with coded blocks instead (your brand’s words and photos only).',
  checks:
    'The email drawn from the block library did not pass the email checks, so it was made with coded blocks.'
} as const

/** DES-ENGINE-003b: at least this share of an upload's sections must be copied. */
export const uploadCopiedShare = 0.5

/** How many of a copy's sections were copied, of how many. */
export const copiedCount = (sections: readonly CopiedSection[]) => ({
  copied: sections.filter((s) => s.result === 'copied').length,
  total: sections.length
})

/** Pictures of an own design are kept as they are: what is written in them too. */
export const keptPicturesWords =
  'Your pictures are kept as they are: check any offer or price written in a picture (a discount in a banner, for example) before you schedule it.'

/** Why an uploaded email cannot be copied, in the owner's words. */
export const uploadWords = {
  gone: 'it was deleted from your emails',
  failed: 'GROS could not read its design',
  pictures: 'one of its pictures changed or is gone'
} as const

/** Why the chosen email's blueprint cannot be used, in the owner's words. */
export const blueprintWords = {
  hidden: 'you no longer follow its brand, or you hid it in Inspiration',
  none: 'it has no stored copy that can be measured'
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
      list.push(v.replace(/\s+/g, ' ').trim().slice(0, 2_000))
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
  const uniq = (l: string[]) => [...new Set(l)].slice(0, 80)
  return {
    headline: uniq(pools.headline),
    subheadline: [],
    eyebrow: [],
    body: uniq(pools.body),
    button: uniq(pools.button),
    caption: uniq(pools.caption)
  }
}

const photoOf = (src: string | undefined, alt: string): SwapPicture | null =>
  src && /^(?:https:|data:image\/)/i.test(src) && src.length <= 2_000
    ? { src, width: 0, height: 0, alt: alt.slice(0, 300) }
    : null

/** A family name the swap and the email may carry (the studio's own rule). */
const familyName = /^[A-Za-z0-9][A-Za-z0-9 -]{0,59}$/

/**
 * Pick #3: the swap's heading and body fonts. The brand's own web fonts
 * (`Store.fonts`) win: the first with the heading role for headings, the
 * first with the body role for the rest (each the other's stand-in when
 * the site gave only one); otherwise the brand kit's font for both. The
 * drawing code adds the email-safe fonts after them (`safeFontStack`), as
 * most inboxes never load a web font.
 */
export function swapFontsOf(
  brand: Pick<BlockBrand, 'font'>,
  fonts: readonly Pick<WebFont, 'family' | 'roles'>[] = []
): { headingFont: string; bodyFont: string } {
  const named = fonts.filter((f) => familyName.test(f.family))
  const heading = named.find((f) => f.roles.includes('heading'))?.family
  const body = named.find((f) => f.roles.includes('body'))?.family
  return {
    headingFont: heading ?? body ?? brand.font,
    bodyFont: body ?? heading ?? brand.font
  }
}

/**
 * The brand as the swap reads it (sizes are read by the browser job).
 * PICK-006: with its design tokens (the store's, their sources kept).
 */
export function swapBrandOf(
  brand: BlockBrand,
  lifestyle?: { image: string; alt: string },
  fonts?: readonly Pick<WebFont, 'family' | 'roles'>[],
  tokens?: DesignTokens
): SwapBrand {
  const own = lifestyle ? photoOf(lifestyle.image, lifestyle.alt) : null
  return {
    name: brand.name,
    site: brand.site,
    ink: brand.ink,
    background: brand.background,
    accent: brand.accent,
    dark: brand.dark,
    ...swapFontsOf(brand, fonts),
    logo: photoOf(brand.logo, brand.name),
    logoOnDark: photoOf(brand.logoOnDark, brand.name),
    photos: own ? [own] : [],
    icons: [],
    radius: Number(/^(\d+)px$/.exec(brand.radius ?? '')?.[1] ?? 8),
    address: null,
    ...(tokens ? { tokens } : {})
  }
}

/**
 * The copy's input from the build's saved steps: the brand, the draft's
 * products in order (a compare-at price only for a confirmed sale), the
 * Copywriter's words, the money rules (the code and its percent, the max,
 * the free-shipping threshold, the store's approved claims) and everything
 * the brand's content says, for the leak check.
 */
export function copyInput(input: {
  store: Pick<
    Store,
    'brand' | 'products' | 'facts' | 'confirmed' | 'fonts' | 'tokens'
  >
  draft: Draft
  rules: {
    maxDiscountPercent: number
    codes: readonly { code: string; percent: number }[]
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
      photo: photoOf(p.image, p.title)
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
  const brand = swapBrandOf(
    store.brand,
    store.confirmed?.lifestylePhoto,
    store.fonts,
    store.tokens
  )
  const claims = store.facts.approvedClaims.slice(0, 40)
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
    ]
      .filter(Boolean)
      .slice(0, 600),
    sourceNames: [...input.sourceNames].slice(0, 6),
    mode: input.mode
  }
}

/** How many cut photos the copy may upload (its pictures, at most 24). */
export const photosFor = (input: CopyInput) =>
  Math.min(
    maxCopyPhotos,
    input.products.length * 2 + (input.brand.photos?.length ?? 0) * 2 + 8
  )

/**
 * The email's page: what it says about a copy. Every section copied, or
 * each section built from a library block (or left out) with its reason.
 */
export function copiedLines(library: {
  sections: readonly CopiedSection[]
  upload?: 'own' | 'other'
  scratch?: number
}): string[] {
  const reasons = library.sections.flatMap((s) =>
    s.result !== 'copied' && s.reason ? [s.reason] : []
  )
  // DES-ENGINE-004b: a Scratch email from the block library.
  if (library.scratch)
    return [
      reasons.length
        ? `Built from ${library.scratch} layouts in the GROS block library, in your brand’s colours, fonts, logo, words and photos. Some sections were built differently:`
        : `Built from ${library.scratch} layouts in the GROS block library, in your brand’s colours, fonts, logo, words and photos. Only the layouts come from the library: never another brand’s words or pictures.`,
      ...reasons
    ]
  // DES-ENGINE-003b: one of the owner's own uploaded emails, said by how
  // much of it was kept.
  const { copied, total } = copiedCount(library.sections)
  if (library.upload === 'own')
    return [
      copied === total
        ? 'Your own design was kept, every section: its layout, colours, fonts and pictures, with this email’s words, products, prices and links.'
        : `Your own design was kept in ${copied} of its ${total} sections (their layout, colours, fonts and pictures), with this email’s words, products, prices and links. The others were built differently:`,
      ...reasons,
      keptPicturesWords
    ]
  if (library.upload === 'other')
    return [
      copied === total
        ? 'Every section was copied from the email you added, with your brand’s colours, fonts, logo, words and photos.'
        : `${copied} of the ${total} sections were copied from the email you added, with your brand’s colours, fonts, logo, words and photos. The others were built differently:`,
      ...reasons
    ]
  return [
    reasons.length
      ? 'The design was copied from the email you chose in Inspiration, with your brand’s colours, fonts, logo, words and photos. Some sections were built differently:'
      : 'Every section was copied from the email you chose in Inspiration, with your brand’s colours, fonts, logo, words and photos.',
    ...reasons
  ]
}
