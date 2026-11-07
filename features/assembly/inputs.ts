import { z } from 'zod'
import { productSchema, type BlockType } from '@/features/blocks/catalog'

const photoSchema = z.object({
  image: z.string().min(1).max(2000),
  alt: z.string().trim().min(1).max(160)
})

/**
 * What the assembly step (ASM-001, VISION Step 3) works from. Everything
 * here comes from the client's own data, never from the AI: the cleaned
 * catalog (only featurable products, with real photos and store-currency
 * prices), the discount codes the client entered with the max discount,
 * the brand's facts sheet and material the client confirmed (reviews,
 * customer photos, a founder note in the founder's own words). The AI only
 * writes words; this step places products, prices, pictures, links, codes
 * and every confirmed word.
 *
 * `DiscountCode` and `BrandFacts` have the same shape as copy QA's
 * (ASM-002, #323), so the engine and QA read the same values; part 2
 * imports them from `features/copy-qa` once that is on main.
 */
export type CatalogProduct = {
  id: string
  title: string
  /** Already formatted in the store currency, e.g. "$24.00". */
  price: string
  /** The catalog's compare-at price, if any. */
  compareAt?: string
  /**
   * True only when the cleaning step confirmed the compare-at price is a
   * temporary sale. Anything else hides it: a permanent compare-at
   * (Step 0 finding 2: always 2x the price) would fake a discount.
   */
  compareAtIsSale?: boolean
  image: string
  url: string
  featurable: boolean
}

export type DiscountCode = {
  code: string
  /** Whole percent off, 1 to 100. */
  percent: number
  /** ISO time the code stops working; null means it doesn't expire. */
  expiresAt: string | null
}

/** What the brand has confirmed. `null` means unknown: claims are refused. */
export type BrandFacts = {
  freeShipping: 'always' | 'never' | { over: number } | null
  deliveryDays: { min: number; max: number } | null
  returnDays: number | null
  guaranteeDays: number | null
  /** Exact claims the brand stands behind, e.g. "100% vegan". */
  approvedClaims: string[]
  bannedPhrases: string[]
  reviewsVerified: boolean
}

export const unknownFacts: BrandFacts = {
  freeShipping: null,
  deliveryDays: null,
  returnDays: null,
  guaranteeDays: null,
  approvedClaims: [],
  bannedPhrases: [],
  reviewsVerified: false
}

export type ConfirmedReview = { quote: string; author: string; rating: number }
export type ConfirmedPhoto = { image: string; alt: string }

export type Brief = {
  /** The calendar action, e.g. "New arrival", "Founder FAQ", "Bestsellers". */
  campaignType: string
  /** What this email must achieve, in the owner's or brief's words. */
  goal: string
  /** Products the brief names first, by catalog id. */
  focusProductIds?: string[]
  /** A code from the client's list to feature, if the brief has an offer. */
  offerCode?: string
}

export type AssemblyInput = {
  brief: Brief
  products: readonly CatalogProduct[]
  codes: readonly DiscountCode[]
  /** The client's max discount (VISION rule 6), 0 to 100. */
  maxDiscountPercent: number
  /** When this email sends (ISO); codes must still work then. */
  sendAt: string
  /** The store's IANA timezone, for every date the email shows. */
  timezone: string
  facts: BrandFacts
  confirmed?: {
    reviews?: readonly ConfirmedReview[]
    customerPhotos?: readonly ConfirmedPhoto[]
    founder?: {
      name: string
      role?: string
      photo?: ConfirmedPhoto
      /** The founder's own note, word for word (1 to 4 paragraphs). */
      note?: readonly string[]
    }
    lifestylePhoto?: ConfirmedPhoto
  }
}

/** An ISO date and time with its offset, never a server-local time. */
const iso = z
  .string()
  .regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?(Z|[+-]\d\d:\d\d)$/, {
    message: 'Use an ISO date and time with Z or an offset'
  })
  .refine((s) => Number.isFinite(Date.parse(s)), { message: 'Not a real date' })

/** True for an IANA timezone this runtime knows, e.g. "Europe/London". */
export function knownTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
    return true
  } catch {
    return false
  }
}
const photo = z.object({
  image: z.string().max(2000),
  alt: z.string().max(160)
})

/** The job boundary: part 2 parses stored rows with this before assembling. */
export const assemblyInputSchema = z.object({
  brief: z.object({
    campaignType: z.string().trim().min(1).max(60),
    goal: z.string().trim().min(1).max(1_000),
    focusProductIds: z.array(z.string().max(100)).max(6).optional(),
    offerCode: z.string().trim().max(40).optional()
  }),
  products: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        title: z.string().max(500),
        price: z.string().max(100),
        compareAt: z.string().max(100).optional(),
        compareAtIsSale: z.boolean().optional(),
        image: z.string().max(4_000),
        url: z.string().max(4_000),
        featurable: z.boolean()
      })
    )
    .max(500),
  codes: z
    .array(
      z.object({
        code: z.string().trim().min(1).max(40),
        percent: z.number().int().min(1).max(100),
        expiresAt: iso.nullable()
      })
    )
    .max(200),
  maxDiscountPercent: z.number().int().min(0).max(100),
  sendAt: iso,
  timezone: z
    .string()
    .min(1)
    .max(64)
    .refine(knownTimezone, { message: 'Not a known timezone' }),
  facts: z.object({
    freeShipping: z
      .union([
        z.literal('always'),
        z.literal('never'),
        z.object({ over: z.number().nonnegative() })
      ])
      .nullable(),
    deliveryDays: z
      .object({ min: z.number().int().min(0), max: z.number().int().min(0) })
      .nullable(),
    returnDays: z.number().int().min(0).nullable(),
    guaranteeDays: z.number().int().min(0).nullable(),
    approvedClaims: z.array(z.string().max(120)).max(50),
    bannedPhrases: z.array(z.string().max(120)).max(200),
    reviewsVerified: z.boolean()
  }),
  confirmed: z
    .object({
      reviews: z
        .array(
          z.object({
            quote: z.string().max(300),
            author: z.string().max(60),
            rating: z.number().int().min(1).max(5)
          })
        )
        .max(20)
        .optional(),
      customerPhotos: z.array(photo).max(12).optional(),
      founder: z
        .object({
          name: z.string().trim().min(1).max(60),
          role: z.string().max(60).optional(),
          photo: photo.optional(),
          note: z.array(z.string().trim().min(1).max(600)).max(4).optional()
        })
        .optional(),
      lifestylePhoto: photo.optional()
    })
    .optional()
}) satisfies z.ZodType<AssemblyInput>

/** Why a product cannot be placed, for the ops queue. */
export function productProblem(p: CatalogProduct): string | null {
  if (!p.featurable) return 'not featurable'
  const checked = productSchema.safeParse({
    title: p.title,
    price: p.price,
    image: p.image,
    url: p.url
  })
  if (!checked.success)
    return `does not fit a product block (${checked.error.issues[0]?.path.join('.') || 'value'})`
  if (!/^https:\/\//.test(p.image)) return 'photo is not https'
  return null
}

/** One email shows at most this many products; the writer sees only these. */
export const maxProducts = 12

/** Products that can be placed, focus first, each once, at most 12. */
export function eligibleProducts(input: AssemblyInput) {
  const ok = input.products.filter((p) => productProblem(p) === null)
  const focus = input.brief.focusProductIds ?? []
  return [
    ...focus
      .map((id) => ok.find((p) => p.id === id))
      .filter((p): p is CatalogProduct => !!p),
    ...ok.filter((p) => !focus.includes(p.id))
  ].slice(0, maxProducts)
}

const usablePhoto = (photo: ConfirmedPhoto | undefined) =>
  !!photo &&
  photoSchema.safeParse(photo).success &&
  /^https:\/\//.test(photo.image)

/**
 * The client's confirmed material that fits its blocks. Reviews count only
 * when the brand has a verified review source (copy QA's `reviewsVerified`);
 * a founder note needs the founder's own words; a photo that would not pass
 * the block schema is left out, so bad data never looks like a model error.
 */
export function usableMaterial(input: AssemblyInput) {
  const c = input.confirmed ?? {}
  const review = (r: ConfirmedReview) =>
    !!r.quote.trim() &&
    r.quote.length <= 300 &&
    !!r.author.trim() &&
    r.author.length <= 60 &&
    Number.isInteger(r.rating) &&
    r.rating >= 1 &&
    r.rating <= 5
  const f = c.founder
  const note = (f?.note ?? []).filter((t) => t.trim() && t.length <= 600)
  return {
    reviews: input.facts.reviewsVerified
      ? (c.reviews ?? []).filter(review).slice(0, 3)
      : [],
    customerPhotos: (c.customerPhotos ?? []).filter(usablePhoto),
    founder:
      f && f.name.trim() && f.name.length <= 60 && note.length
        ? {
            name: f.name,
            role: f.role && f.role.length <= 60 ? f.role : undefined,
            photo: usablePhoto(f.photo) ? f.photo : undefined,
            note: note.slice(0, 4)
          }
        : undefined,
    lifestylePhoto: usablePhoto(c.lifestylePhoto) ? c.lifestylePhoto : undefined
  }
}

/**
 * A focus product the brief names but that cannot be placed. The email is
 * not built without it: a person fixes the catalog or the brief.
 */
export function missingFocus(input: AssemblyInput) {
  return (input.brief.focusProductIds ?? []).flatMap((id) => {
    const product = input.products.find((p) => p.id === id)
    const why = product ? productProblem(product) : 'not in the catalog'
    return why ? [{ id, why }] : []
  })
}

/**
 * The client's code named by the brief: on the list, within the max
 * discount, and still working when the email sends.
 */
export function usableCode(input: AssemblyInput) {
  const wanted = input.brief.offerCode?.trim().toUpperCase()
  if (!wanted) return null
  const code = input.codes.find((c) => c.code.trim().toUpperCase() === wanted)
  if (!code) return null
  if (
    !Number.isInteger(code.percent) ||
    code.percent < 1 ||
    code.percent > Math.min(100, input.maxDiscountPercent)
  )
    return null
  if (code.expiresAt === null) return code
  const ends = Date.parse(code.expiresAt)
  const sends = Date.parse(input.sendAt)
  return Number.isFinite(ends) && Number.isFinite(sends) && ends > sends
    ? code
    : null
}

/** True when the facts sheet confirms anything an FAQ could answer from. */
export const hasFacts = (facts: BrandFacts) =>
  facts.freeShipping !== null ||
  facts.deliveryDays !== null ||
  facts.returnDays !== null ||
  facts.guaranteeDays !== null ||
  facts.approvedClaims.length > 0

/**
 * The block types this email may use: a block only appears when the client
 * gave what it needs, so the AI can never ask for a review strip without
 * confirmed reviews, an offer without a valid code, a founder note without
 * the founder's own words, or an FAQ without facts to answer from.
 */
export function allowedBlockTypes(input: AssemblyInput): BlockType[] {
  const products = eligibleProducts(input).length
  const c = usableMaterial(input)
  const allowed: BlockType[] = [
    'announcement_bar',
    'header_logo',
    'text',
    'steps',
    'cta',
    'signoff',
    'footer'
  ]
  if (hasFacts(input.facts)) allowed.push('faq')
  if (products >= 1)
    allowed.push('hero_product', 'product_feature', 'image_text')
  if (products >= 2) allowed.push('product_grid_2col')
  if (products >= 3) allowed.push('product_grid_3col')
  if (usableCode(input)) allowed.push('offer_banner')
  if (c.reviews.length) allowed.push('review_strip')
  if (c.customerPhotos.length >= 3) allowed.push('ugc_grid')
  if (c.founder) allowed.push('founder_note')
  if (c.lifestylePhoto) allowed.push('hero_image')
  return allowed
}
