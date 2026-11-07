import { z } from 'zod'

/**
 * The block library (VISION.md Step 1, issue BLK-001). Every email the AI
 * builds is a sequence of these 20 block types, and the section labeller
 * (BLK-003) may only answer one of these keys. There is no countdown timer
 * in v1. The owner approves the list (decision D3).
 *
 * The reference set is the Step 0 renderer (docs/step0/render.py): its 10
 * types keep their keys and their input fields exactly, so a Step 0 spec
 * (docs/step0/example_spec.json) is valid input here. The other 10 follow
 * the same conventions: a picture is `image` (https URL) plus `alt`, a
 * button is `cta` (its words) plus `url`, a section title is `heading`.
 *
 * Text is plain text (never HTML), prices arrive already formatted in the
 * store currency, and every image is a real photo (no text inside images,
 * VISION hard rules 9 and 10). The renderer checks every block against
 * these schemas again, so content stored and re-rendered later can never
 * skip them.
 */

const text = (max: number) => z.string().trim().min(1).max(max)
const optionalText = (max: number) => z.string().trim().max(max).optional()

const safeLink = (value: string) => {
  try {
    const u = new URL(value)
    return (
      ['https:', 'http:', 'mailto:'].includes(u.protocol) &&
      !u.username &&
      !u.password
    )
  } catch {
    return false
  }
}
/** A link: https, http or mailto, without credentials in it. */
export const urlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .refine(safeLink, { message: 'Use a full https link' })

const inlineImage =
  /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/]+={0,2}$/i
const safeImage = (value: string) => {
  if (inlineImage.test(value)) return true
  try {
    const u = new URL(value)
    return u.protocol === 'https:' && !u.username && !u.password
  } catch {
    return false
  }
}
/**
 * A picture: an https URL (Klaviyo-hosted when sent, VISION rule 11), or
 * an inline PNG/JPEG/GIF/WebP for our own previews. Klaviyo mode refuses
 * inline pictures at render time.
 */
export const imageUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .refine(safeImage, { message: 'Use an https picture' })

const hexSchema = z
  .string()
  .trim()
  .regex(/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i, 'Use a hex colour')

export const productSchema = z.object({
  title: text(90),
  price: text(24),
  /**
   * The old price, struck through. Leave it out when the catalog's
   * compare-at price is permanent (Step 0 finding 2).
   */
  compareAt: optionalText(24),
  image: imageUrlSchema,
  alt: optionalText(160),
  url: urlSchema
})
const photoSchema = z.object({ image: imageUrlSchema, alt: text(160) })
const pair = (a: number, b: number) => z.tuple([text(a), text(b)])

export type BlockProduct = z.infer<typeof productSchema>
export type BlockPhoto = z.infer<typeof photoSchema>

const definitions = {
  announcement_bar: {
    name: 'Announcement bar',
    purpose:
      'A thin strip with one short line: a launch, free shipping, a deadline.',
    needs:
      'One short line (free-shipping and delivery facts come from the facts sheet)',
    content: z.object({ text: text(90) })
  },
  header_logo: {
    name: 'Logo header',
    purpose: 'Opens the email with the brand logo, linked to the store.',
    needs: 'Nothing to write: the logo and store link come from the brand kit',
    content: z.object({})
  },
  hero_product: {
    name: 'Product hero',
    purpose:
      'The product on a brand-colour panel, with a short headline and one button.',
    needs: 'Product photo, small eyebrow line, headline, short line, button',
    content: z.object({
      eyebrow: optionalText(40),
      headline: text(80),
      sub: optionalText(160),
      image: imageUrlSchema,
      alt: optionalText(160),
      url: urlSchema,
      cta: text(40),
      panel: hexSchema.optional()
    })
  },
  hero_image: {
    name: 'Photo hero',
    purpose:
      'A full-width lifestyle photo, then the main message and one button.',
    needs: 'Wide photo, headline, short line, button',
    content: z.object({
      image: imageUrlSchema,
      alt: text(160),
      headline: text(80),
      sub: optionalText(160),
      url: urlSchema,
      cta: text(40)
    })
  },
  offer_banner: {
    name: 'Offer banner',
    purpose: 'States the offer and the code in large text on a brand colour.',
    needs: 'Offer headline, code from the client list, end date, button',
    content: z.object({
      headline: text(60),
      detail: optionalText(140),
      code: optionalText(40),
      expiry: optionalText(60),
      url: urlSchema,
      cta: text(40)
    })
  },
  text: {
    name: 'Text section',
    purpose: 'Plain paragraphs, like a letter. Good for text-first emails.',
    needs: 'Optional heading, 1 to 4 paragraphs',
    content: z.object({
      heading: optionalText(80),
      paras: z.array(text(600)).min(1).max(4),
      align: z.enum(['center', 'left']).default('center')
    })
  },
  steps: {
    name: 'Numbered steps',
    purpose:
      'A numbered list: how to use it, how ordering works, or reasons to buy.',
    needs: '2 to 5 steps, each a short title and one line',
    content: z.object({
      heading: optionalText(80),
      items: z.array(pair(40, 200)).min(2).max(5)
    })
  },
  product_feature: {
    name: 'Single product feature',
    purpose: 'One product up close: photo, name, price, why it is good.',
    needs: '1 featurable product, short copy, button',
    content: z.object({
      product: productSchema,
      heading: optionalText(80),
      body: optionalText(400),
      cta: text(40)
    })
  },
  product_grid_2col: {
    name: 'Product grid, 2 columns',
    purpose: 'Two or four products side by side, each with price and link.',
    needs: '2 or 4 featurable products',
    content: z.object({
      heading: optionalText(80),
      products: z
        .array(productSchema)
        .refine((list) => list.length === 2 || list.length === 4, {
          message: 'Use 2 or 4 products'
        })
    })
  },
  product_grid_3col: {
    name: 'Product grid, 3 columns',
    purpose: 'Three or six smaller products, for a range or a collection.',
    needs: '3 or 6 featurable products',
    content: z.object({
      heading: optionalText(80),
      products: z
        .array(productSchema)
        .refine((list) => list.length === 3 || list.length === 6, {
          message: 'Use 3 or 6 products'
        })
    })
  },
  category_tiles: {
    name: 'Category tiles',
    purpose: 'Photo tiles that send shoppers to collections.',
    needs: '2 or 4 collection photos with a label and link',
    content: z.object({
      heading: optionalText(80),
      tiles: z
        .array(photoSchema.extend({ label: text(40), url: urlSchema }))
        .refine((list) => list.length === 2 || list.length === 4, {
          message: 'Use 2 or 4 tiles'
        })
    })
  },
  image_text: {
    name: 'Image and text',
    purpose: 'A photo beside a short story; the photo comes first on a phone.',
    needs: 'Photo, heading, a few lines, optional button',
    content: z.object({
      image: imageUrlSchema,
      alt: text(160),
      heading: text(80),
      paras: z.array(text(500)).min(1).max(3),
      cta: optionalText(40),
      url: urlSchema.optional(),
      imageSide: z.enum(['left', 'right']).default('left')
    })
  },
  founder_note: {
    name: 'Founder note',
    purpose: 'A short personal note signed by the founder.',
    needs: 'Optional photo, note, name and role',
    content: z.object({
      photo: photoSchema.optional(),
      greeting: optionalText(60),
      paras: z.array(text(600)).min(1).max(4),
      signoff: text(60),
      role: optionalText(60)
    })
  },
  review_strip: {
    name: 'Review strip',
    purpose: 'One to three real customer reviews with star ratings.',
    needs: '1 to 3 confirmed reviews (quote, name, stars)',
    content: z.object({
      heading: optionalText(80),
      reviews: z
        .array(
          z.object({
            quote: text(300),
            author: text(60),
            rating: z.number().int().min(1).max(5)
          })
        )
        .min(1)
        .max(3)
    })
  },
  ugc_grid: {
    name: 'Customer photo grid',
    purpose: 'Photos customers shared, in a grid, to show the product in use.',
    needs: '3 or 6 customer photos, optional caption and button',
    content: z.object({
      heading: optionalText(80),
      photos: z
        .array(photoSchema)
        .refine((list) => list.length === 3 || list.length === 6, {
          message: 'Use 3 or 6 photos'
        }),
      caption: optionalText(160),
      cta: optionalText(40),
      url: urlSchema.optional()
    })
  },
  before_after: {
    name: 'Before and after',
    purpose: 'Two real photos that show the change the product makes.',
    needs: 'Before photo, after photo, short caption',
    content: z.object({
      before: photoSchema,
      after: photoSchema,
      beforeLabel: text(24).default('Before'),
      afterLabel: text(24).default('After'),
      caption: optionalText(200)
    })
  },
  faq: {
    name: 'FAQ',
    purpose: 'Answers to the questions that stop people buying.',
    needs: '1 to 5 questions with short answers from the facts sheet',
    content: z.object({
      heading: optionalText(80),
      items: z.array(pair(120, 400)).min(1).max(5)
    })
  },
  cta: {
    name: 'Button',
    purpose: 'One clear button on its own.',
    needs: 'Button words and link',
    content: z.object({ label: text(40), url: urlSchema })
  },
  signoff: {
    name: 'Sign-off',
    purpose: 'A short closing line from the brand, like "With love, the team".',
    needs: 'One short line',
    content: z.object({ text: text(120) })
  },
  footer: {
    name: 'Footer',
    purpose:
      "Closes every email with Klaviyo's required links and the address.",
    needs:
      'Nothing to write: brand, address, unsubscribe, preferences, view in browser',
    content: z.object({ note: optionalText(200) })
  }
} as const

export type BlockType = keyof typeof definitions
export const blockTypes = Object.keys(definitions) as BlockType[]

/** The Step 0 reference renderer's types (docs/step0/render.py). */
export const referenceBlockTypes = [
  'announcement_bar',
  'header_logo',
  'hero_product',
  'text',
  'steps',
  'product_grid_2col',
  'faq',
  'cta',
  'signoff',
  'footer'
] as const satisfies readonly BlockType[]

export type BlockContent<T extends BlockType> = z.infer<
  (typeof definitions)[T]['content']
>
/** Content as it is written, before schema defaults are applied. */
export type BlockContentInput<T extends BlockType> = z.input<
  (typeof definitions)[T]['content']
>

export type Block = {
  [T in BlockType]: { type: T; content: BlockContent<T> }
}[BlockType]

export type BlockDefinition = {
  type: BlockType
  name: string
  purpose: string
  needs: string
}

/** The 20 types in plain words, in gallery order. */
export const blockCatalog: readonly BlockDefinition[] = blockTypes.map(
  (type) => ({
    type,
    name: definitions[type].name,
    purpose: definitions[type].purpose,
    needs: definitions[type].needs
  })
)

export function isBlockType(value: unknown): value is BlockType {
  return typeof value === 'string' && Object.hasOwn(definitions, value)
}

/** Validates one block's content; the assembly step must pass this. */
export function parseBlock(
  type: BlockType,
  content: unknown
): { ok: true; block: Block } | { ok: false; error: string } {
  if (!isBlockType(type)) return { ok: false, error: `Unknown block ${type}` }
  const result = definitions[type].content.strict().safeParse(content)
  if (!result.success)
    return {
      ok: false,
      error: result.error.issues
        .map((i) => `${i.path.join('.') || type}: ${i.message}`)
        .join('; ')
    }
  return { ok: true, block: { type, content: result.data } as Block }
}

/**
 * A Step 0 style block (`{ type, ...fields }`, docs/step0/example_spec.json)
 * as a checked block.
 */
export function parseSpecBlock(
  input: unknown
): { ok: true; block: Block } | { ok: false; error: string } {
  if (!input || typeof input !== 'object')
    return { ok: false, error: 'A block must be an object' }
  const { type, ...content } = input as { type?: unknown }
  if (!isBlockType(type))
    return { ok: false, error: `Unknown block ${String(type)}` }
  return parseBlock(type, content)
}
