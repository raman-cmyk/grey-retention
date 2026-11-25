import { z } from 'zod'

/**
 * DES-ENGINE-001 (step 1 of the email design plan, owner approval of 25
 * November 2026): the **blueprint**, an exact map of one email, section by
 * section. Upload, Library and Scratch all end on it: the measuring tool
 * (`measure.ts`) writes one from an HTML email drawn in the safe browser,
 * the drawing code (`render.ts`) turns one back into email HTML, and the
 * likeness check (`likeness.ts`) compares two.
 *
 * Every size is in CSS px at the email's own width (600 for almost every
 * email). Positions are relative, never absolute, so a section can be
 * drawn anywhere:
 * - a section's items sit in the section's own box; a column's items in
 *   the column's box;
 * - `gapBefore` is the space between an item's top and the bottom of the
 *   item above it (or the top of its box), `x` its left edge from the left
 *   of its box, and `bottom` the space after the last item.
 * A row puts columns side by side: each column has its own `x`, `y` (from
 * the row's top), `width`, `height`, fill and items, so a product grid, a
 * picture beside words or a card on a coloured band keep their exact
 * proportions.
 *
 * Words, links and pictures are kept so an email can be drawn back
 * unchanged (the golden test). Later steps swap the words, photos,
 * colours and fonts for the brand's own (Library), or only the words and
 * products (an upload of the brand's own design); the geometry stays.
 */

export const BLUEPRINT_VERSION = 1
/** The width emails are designed at; an email's own width may differ a little. */
export const EMAIL_WIDTH = 600
export const minEmailWidth = 320
export const maxEmailWidth = 800
/** The most sections kept (as the inbox's splitter, `features/inbox/sections.ts`). */
export const maxBlueprintSections = 40
/** Rows inside columns inside rows: deeper layouts are not kept. */
export const maxNesting = 4

/** What a part of the email is for, marked by code from where it sits and how it looks. */
export const partRoles = [
  'logo',
  'nav',
  'headline',
  'subheadline',
  'eyebrow',
  'body',
  'price',
  'old_price',
  'product_name',
  'product_photo',
  'hero_photo',
  'photo',
  'icon',
  'social',
  'main_button',
  'secondary_button',
  'link',
  'code',
  'caption',
  'footer_text',
  'legal',
  'divider'
] as const
export type PartRole = (typeof partRoles)[number]

/** What a whole section is, marked by code from its parts. */
export const sectionKinds = [
  'header',
  'hero',
  'text',
  'image',
  'button',
  'product_grid',
  'columns',
  'offer',
  'social',
  'divider',
  'spacer',
  'footer',
  'mixed'
] as const
export type SectionKind = (typeof sectionKinds)[number]

const px = z.number().finite().min(0).max(20_000)
const offset = z.number().finite().min(-2_000).max(20_000)
const hex = z
  .string()
  .regex(/^#[0-9a-f]{6}$/, 'Use a six-digit lower-case hex colour')

const linkOk = (value: string) => {
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
/** A link the email may keep: https, http or mailto, without credentials. */
export const linkSchema = z
  .string()
  .max(2_000)
  .refine(linkOk, { message: 'Use a full https link' })

const inlinePicture =
  /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/]+={0,2}$/i
/**
 * A picture: https, or an inline PNG/JPEG/GIF/WebP for previews and the
 * golden test (the Klaviyo drawing mode refuses inline pictures).
 */
export const pictureSchema = z
  .string()
  .max(3_000_000)
  .refine(
    (v) => {
      if (inlinePicture.test(v)) return true
      try {
        const u = new URL(v)
        return u.protocol === 'https:' && !u.username && !u.password
      } catch {
        return false
      }
    },
    { message: 'Use an https picture' }
  )

export const fontSchema = z.strictObject({
  /** A CSS font-family list, names only (letters, digits, spaces, hyphens). */
  family: z
    .string()
    .max(300)
    .regex(/^[A-Za-z0-9 ,'-]*$/, 'Font names only'),
  size: z.number().finite().min(1).max(200),
  weight: z.int().min(100).max(900),
  /** CSS px between lines. */
  lineHeight: z.number().finite().min(1).max(400),
  italic: z.boolean(),
  letterSpacing: z.number().finite().min(-20).max(60),
  transform: z.enum(['none', 'uppercase', 'lowercase', 'capitalize'])
})
export type FontSpec = z.infer<typeof fontSchema>

/** A stretch of words with its own look inside a text (a bold word, a link). */
export const runSchema = z.strictObject({
  /** The words; "\n" is a line break the email wrote. */
  text: z.string().max(5_000),
  weight: z.int().min(100).max(900).optional(),
  italic: z.boolean().optional(),
  color: hex.optional(),
  size: z.number().finite().min(1).max(200).optional(),
  underline: z.boolean().optional(),
  strike: z.boolean().optional(),
  href: linkSchema.optional()
})
export type TextRun = z.infer<typeof runSchema>

const borderSchema = z.strictObject({
  width: z.number().finite().min(0).max(40),
  color: hex
})

const placed = {
  gapBefore: offset,
  x: offset,
  width: px,
  height: px,
  role: z.enum(partRoles)
}

export const textPartSchema = z.strictObject({
  type: z.literal('text'),
  ...placed,
  runs: z.array(runSchema).min(1).max(200),
  font: fontSchema,
  color: hex,
  align: z.enum(['left', 'center', 'right', 'justify']),
  /** How many lines the words took where they were measured. */
  lines: z.int().min(1).max(500)
})
export const imagePartSchema = z.strictObject({
  type: z.literal('image'),
  ...placed,
  /** Null: the picture could not be kept (a blocked or unsafe address); its box is. */
  src: pictureSchema.nullable(),
  alt: z.string().max(400),
  href: linkSchema.nullable(),
  radius: px
})
export const buttonPartSchema = z.strictObject({
  type: z.literal('button'),
  ...placed,
  label: z.string().min(1).max(200),
  href: linkSchema.nullable(),
  font: fontSchema,
  color: hex,
  background: hex.nullable(),
  radius: px,
  border: borderSchema.nullable(),
  lines: z.int().min(1).max(10)
})
export const dividerPartSchema = z.strictObject({
  type: z.literal('divider'),
  ...placed,
  color: hex
})

export type TextPart = z.infer<typeof textPartSchema>
export type ImagePart = z.infer<typeof imagePartSchema>
export type ButtonPart = z.infer<typeof buttonPartSchema>
export type DividerPart = z.infer<typeof dividerPartSchema>
export type Part = TextPart | ImagePart | ButtonPart | DividerPart

export type Column = {
  x: number
  y: number
  width: number
  height: number
  background: string | null
  radius: number
  border: { width: number; color: string } | null
  items: Item[]
  bottom: number
}
export type RowItem = {
  type: 'row'
  gapBefore: number
  height: number
  /** Kept side by side on a phone (small icons, a menu); other rows stack. */
  keepOnPhone: boolean
  columns: Column[]
}
export type Item = Part | RowItem

export const columnSchema: z.ZodType<Column> = z.lazy(() =>
  z.strictObject({
    x: offset,
    y: offset,
    width: px,
    height: px,
    background: hex.nullable(),
    radius: px,
    border: borderSchema.nullable(),
    items: z.array(itemSchema).max(200),
    bottom: offset
  })
)
export const rowSchema: z.ZodType<RowItem> = z.lazy(() =>
  z.strictObject({
    type: z.literal('row'),
    gapBefore: offset,
    height: px,
    keepOnPhone: z.boolean(),
    columns: z.array(columnSchema).min(1).max(12)
  })
)
export const itemSchema: z.ZodType<Item> = z.lazy(() =>
  z.union([
    textPartSchema,
    imagePartSchema,
    buttonPartSchema,
    dividerPartSchema,
    rowSchema
  ])
)

export const sectionSchema = z.strictObject({
  /** 1, 2, 3… top to bottom, as the inbox numbers sections (`data-gr-section`). */
  ordinal: z.int().min(1).max(maxBlueprintSections),
  kind: z.enum(sectionKinds),
  /** Space between this section and the one above it (or the email's top). */
  gapBefore: offset,
  x: offset,
  width: px,
  height: px,
  /** The section's own fill; null where it shows the email's. */
  background: hex.nullable(),
  /** The fill around the section (its side margins and the gap above it). */
  around: hex,
  items: z.array(itemSchema).max(300),
  bottom: offset,
  /**
   * Why the section cannot be copied (a countdown timer, a moving picture,
   * words over a background picture), or null. Such a section is built
   * from the closest library block instead.
   */
  unsupported: z.string().max(200).nullable()
})
export type Section = z.infer<typeof sectionSchema>

export const blueprintSchema = z
  .strictObject({
    version: z.literal(BLUEPRINT_VERSION),
    /** The email's own width. */
    width: z.number().finite().min(minEmailWidth).max(maxEmailWidth),
    /** The colour around the email. */
    page: hex,
    /** The email's own fill. */
    body: hex,
    sections: z.array(sectionSchema).min(1).max(maxBlueprintSections),
    /** Space after the last section. */
    bottom: offset,
    /** The page's own space above and below the email (outside it). */
    margin: z.strictObject({
      top: z.number().finite().min(0).max(400),
      bottom: z.number().finite().min(0).max(400)
    })
  })
  .superRefine((bp, ctx) => {
    const deepest = Math.max(0, ...bp.sections.map((s) => depthOf(s.items)))
    if (deepest > maxNesting)
      ctx.addIssue({
        code: 'custom',
        message: `Rows are nested ${deepest} deep; at most ${maxNesting} are kept.`
      })
    bp.sections.forEach((s, i) => {
      if (s.ordinal !== i + 1)
        ctx.addIssue({
          code: 'custom',
          message: 'Sections are numbered 1, 2, 3… in order.'
        })
    })
  })
export type Blueprint = z.infer<typeof blueprintSchema>

/** How deep rows nest inside columns. */
export function depthOf(items: readonly Item[]): number {
  let deepest = 0
  for (const item of items)
    if (item.type === 'row')
      deepest = Math.max(
        deepest,
        1 + Math.max(0, ...item.columns.map((c) => depthOf(c.items)))
      )
  return deepest
}

/** A blueprint checked against the schema, or the first problem in words. */
export function parseBlueprint(
  value: unknown
): { ok: true; blueprint: Blueprint } | { ok: false; error: string } {
  const parsed = blueprintSchema.safeParse(value)
  if (parsed.success) return { ok: true, blueprint: parsed.data }
  const issue = parsed.error.issues[0]
  return {
    ok: false,
    error: `${issue?.path.join('.') || 'blueprint'}: ${issue?.message ?? 'not valid'}`
  }
}

/** Every part of a list of items, depth first, top to bottom and left to right. */
export function partsOf(items: readonly Item[]): Part[] {
  const out: Part[] = []
  for (const item of items)
    if (item.type === 'row')
      for (const column of item.columns) out.push(...partsOf(column.items))
    else out.push(item)
  return out
}

/** The words of a text part, as one string. */
export const textOf = (part: Pick<TextPart, 'runs'>) =>
  part.runs.map((r) => r.text).join('')

/**
 * Where each part and each filled column sits on the email, in px from
 * its top-left: the same arithmetic the drawing code follows (each item
 * below the one above it by its gap; a row's columns at their x and y).
 */
export type PlacedBox = {
  kind: Part['type'] | 'fill'
  x: number
  y: number
  width: number
  height: number
  section: number
}

export function placedBoxes(bp: Blueprint): PlacedBox[] {
  const out: PlacedBox[] = []
  const stack = (
    items: readonly Item[],
    left: number,
    top: number,
    section: number
  ) => {
    let y = top
    for (const item of items) {
      y += item.gapBefore
      if (item.type === 'row') {
        for (const c of item.columns) {
          if (c.background || c.border)
            out.push({
              kind: 'fill',
              x: left + c.x,
              y: y + c.y,
              width: c.width,
              height: c.height,
              section
            })
          stack(c.items, left + c.x, y + c.y, section)
        }
      } else
        out.push({
          kind: item.type,
          x: left + item.x,
          y,
          width: item.width,
          height: item.height,
          section
        })
      y += item.height
    }
  }
  let y = 0
  for (const s of bp.sections) {
    y += s.gapBefore
    if (s.background && s.background !== s.around)
      out.push({
        kind: 'fill',
        x: s.x,
        y,
        width: s.width,
        height: s.height,
        section: s.ordinal
      })
    stack(s.items, s.x, y, s.ordinal)
    y += s.height
  }
  return out
}

/** The email's whole height, as the blueprint lays it out. */
export const blueprintHeight = (bp: Blueprint) =>
  bp.sections.reduce((n, s) => n + s.gapBefore + s.height, 0) + bp.bottom
