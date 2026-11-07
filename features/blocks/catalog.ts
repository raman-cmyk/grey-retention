import { z } from 'zod'

/**
 * The block library (VISION.md Step 1, issue BLK-001). Every email the AI
 * builds is a sequence of these 20 block types, and the section labeller
 * (BLK-003) may only answer one of these keys. There is no countdown timer
 * in v1. Claude chose the list from email-marketing practice; the owner
 * approves it (decision D3).
 *
 * Each type says in plain words what it is for and what content it needs.
 * The content schemas are what the assembly step (ASM-001) must fill: text
 * is plain text (never HTML), prices arrive already formatted in the store
 * currency, and every image is a real photo with alt text (no text inside
 * images, VISION hard rules 9 and 10).
 */

const text = (max: number) => z.string().trim().min(1).max(max)
const optionalText = (max: number) => z.string().trim().max(max).optional()

export const linkSchema = z.object({
  label: text(40),
  url: z.string().trim().min(1).max(2000)
})
export const imageSchema = z.object({
  url: z.string().trim().min(1).max(200_000),
  alt: text(160)
})
export const productSchema = z.object({
  title: text(90),
  price: text(24),
  compareAt: optionalText(24),
  image: imageSchema,
  url: z.string().trim().min(1).max(2000)
})

export type BlockLink = z.infer<typeof linkSchema>
export type BlockImage = z.infer<typeof imageSchema>
export type BlockProduct = z.infer<typeof productSchema>

const definitions = {
  header: {
    name: 'Logo header',
    purpose: 'Opens the email with the brand logo and up to three links.',
    needs: 'Logo (or the brand name), up to 3 short links',
    content: z.object({ links: z.array(linkSchema).max(3).default([]) })
  },
  hero: {
    name: 'Hero',
    purpose:
      'The big first impression: one photo, the main message and one button.',
    needs: 'Photo, headline, short line, button',
    content: z.object({
      image: imageSchema,
      headline: text(80),
      subline: optionalText(160),
      cta: linkSchema
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
      cta: linkSchema
    })
  },
  free_shipping_bar: {
    name: 'Free-shipping bar',
    purpose: 'A thin strip with one fact the shopper cares about.',
    needs: 'One short line from the facts sheet',
    content: z.object({ text: text(90) })
  },
  product_feature: {
    name: 'Single product feature',
    purpose: 'One product up close: photo, name, price, why it is good.',
    needs: '1 featurable product, short copy, button',
    content: z.object({
      product: productSchema,
      headline: optionalText(80),
      body: optionalText(400),
      cta: linkSchema
    })
  },
  product_grid_2: {
    name: 'Product grid, 2 columns',
    purpose: 'Two or four products side by side, each with price and link.',
    needs: '2 or 4 featurable products',
    content: z.object({
      headline: optionalText(80),
      products: z
        .array(productSchema)
        .refine((list) => list.length === 2 || list.length === 4, {
          message: 'Use 2 or 4 products'
        })
    })
  },
  product_grid_3: {
    name: 'Product grid, 3 columns',
    purpose: 'Three or six smaller products, for a range or a collection.',
    needs: '3 or 6 featurable products',
    content: z.object({
      headline: optionalText(80),
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
      headline: optionalText(80),
      tiles: z
        .array(
          z.object({
            image: imageSchema,
            label: text(40),
            url: z.string().trim().min(1).max(2000)
          })
        )
        .refine((list) => list.length === 2 || list.length === 4, {
          message: 'Use 2 or 4 tiles'
        })
    })
  },
  image_text: {
    name: 'Image and text',
    purpose: 'A photo beside a short story; stacks on a phone.',
    needs: 'Photo, headline, a few lines, optional button',
    content: z.object({
      image: imageSchema,
      headline: text(80),
      body: text(600),
      cta: linkSchema.optional(),
      imageSide: z.enum(['left', 'right']).default('left')
    })
  },
  text: {
    name: 'Text section',
    purpose: 'Plain paragraphs, like a letter. Good for text-first emails.',
    needs: 'Optional headline, 1 to 4 paragraphs',
    content: z.object({ headline: optionalText(80), body: text(1500) })
  },
  founder_note: {
    name: 'Founder note',
    purpose: 'A short personal note signed by the founder.',
    needs: 'Optional photo, note, name and role',
    content: z.object({
      photo: imageSchema.optional(),
      greeting: optionalText(60),
      body: text(1000),
      signoff: text(60),
      role: optionalText(60)
    })
  },
  review_strip: {
    name: 'Review strip',
    purpose: 'One to three real customer reviews with star ratings.',
    needs: '1 to 3 reviews (quote, name, stars)',
    content: z.object({
      headline: optionalText(80),
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
      headline: optionalText(80),
      photos: z
        .array(imageSchema)
        .refine((list) => list.length === 3 || list.length === 6, {
          message: 'Use 3 or 6 photos'
        }),
      caption: optionalText(160),
      cta: linkSchema.optional()
    })
  },
  before_after: {
    name: 'Before and after',
    purpose: 'Two real photos that show the change the product makes.',
    needs: 'Before photo, after photo, short caption',
    content: z.object({
      before: imageSchema,
      after: imageSchema,
      beforeLabel: text(24).default('Before'),
      afterLabel: text(24).default('After'),
      caption: optionalText(200)
    })
  },
  benefits: {
    name: 'Benefits',
    purpose: 'Three reasons to buy, each a short title and one line.',
    needs: '3 benefits from the facts sheet',
    content: z.object({
      headline: optionalText(80),
      items: z.array(z.object({ title: text(40), body: text(160) })).length(3)
    })
  },
  how_it_works: {
    name: 'How it works',
    purpose: 'Three numbered steps: how to use it or how ordering works.',
    needs: '3 steps (title and one line)',
    content: z.object({
      headline: optionalText(80),
      steps: z.array(z.object({ title: text(40), body: text(160) })).length(3)
    })
  },
  comparison: {
    name: 'Comparison table',
    purpose: 'Us against the usual alternative, row by row.',
    needs: '2 column labels, 3 to 5 rows',
    content: z.object({
      headline: optionalText(80),
      usLabel: text(30),
      themLabel: text(30),
      rows: z
        .array(z.object({ feature: text(50), us: text(40), them: text(40) }))
        .min(3)
        .max(5)
    })
  },
  faq: {
    name: 'FAQ',
    purpose: 'Answers to the questions that stop people buying.',
    needs: '2 to 5 questions with short answers from the facts sheet',
    content: z.object({
      headline: optionalText(80),
      items: z
        .array(z.object({ question: text(120), answer: text(400) }))
        .min(2)
        .max(5)
    })
  },
  cta: {
    name: 'Button section',
    purpose: 'A last push: one line and one clear button.',
    needs: 'Optional headline and line, button',
    content: z.object({
      headline: optionalText(80),
      body: optionalText(200),
      cta: linkSchema
    })
  },
  footer: {
    name: 'Footer',
    purpose:
      "Closes every email with Klaviyo's required links and the address.",
    needs: 'Nothing to write: brand, unsubscribe, address, view in browser',
    content: z.object({ note: optionalText(200) })
  }
} as const

export type BlockType = keyof typeof definitions
export const blockTypes = Object.keys(definitions) as BlockType[]

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
  const result = definitions[type].content.safeParse(content)
  if (!result.success)
    return {
      ok: false,
      error: result.error.issues
        .map((i) => `${i.path.join('.') || type}: ${i.message}`)
        .join('; ')
    }
  return { ok: true, block: { type, content: result.data } as Block }
}
