import { createHash } from 'node:crypto'
import { z } from 'zod'
import { blockTypes, type BlockType } from '@/features/blocks/catalog'
import {
  layouts,
  maxStyles,
  purposes,
  styles,
  type Layout,
  type Purpose,
  type Style
} from './taxonomy'

/**
 * Block variants (CI-002, AGENT_MAP §1, D18): reusable section designs, so
 * the block library grows from the 20 seed blocks into the thousands. A
 * variant is **structure only**: rows of columns, each a stack of slots
 * (a picture, a heading, a paragraph, a button…), with their proportions.
 * It never holds a competitor's words, pictures, links or colours (VISION
 * rule 8); the email agents fill the slots with the client's own content
 * and brand kit. One row per structure: a section whose structure is
 * already in the library adds evidence to it instead of a copy.
 */

export const slotKinds = [
  'image',
  'heading',
  'eyebrow',
  'text',
  'button',
  'price',
  'rating',
  'quote',
  'code',
  'divider',
  'social',
  'spacer'
] as const
export type SlotKind = (typeof slotKinds)[number]

const imageSlot = z.object({
  kind: z.literal('image'),
  role: z.enum(['product', 'lifestyle', 'logo', 'icon']),
  aspect: z.enum(['1:1', '4:5', '3:2', '16:9', '2:1', 'free']),
  /** Edge to edge, with no padding around it. */
  bleed: z.boolean().default(false)
})
const headingSlot = z.object({
  kind: z.literal('heading'),
  size: z.enum(['xl', 'l', 'm', 's'])
})
const textSlot = z.object({
  kind: z.literal('text'),
  /** About how many lines of body text (12 words a line). */
  lines: z.number().int().min(1).max(12)
})
const buttonSlot = z.object({
  kind: z.literal('button'),
  style: z.enum(['solid', 'outline', 'link'])
})
const plainSlot = z.object({
  kind: z.enum([
    'eyebrow',
    'price',
    'rating',
    'quote',
    'code',
    'divider',
    'social',
    'spacer'
  ])
})
export const slotSchema = z.discriminatedUnion('kind', [
  imageSlot,
  headingSlot,
  textSlot,
  buttonSlot,
  plainSlot
])
export type Slot = z.infer<typeof slotSchema>

export const columnSchema = z.object({
  /** Share of the 600px row, 0.1 to 1; a row's columns add up to 1. */
  width: z.number().min(0.1).max(1),
  slots: z.array(slotSchema).min(1).max(8)
})
export const rowSchema = z.object({
  columns: z.array(columnSchema).min(1).max(4)
})

export const variantSpecSchema = z.object({
  rows: z.array(rowSchema).min(1).max(6),
  align: z.enum(['left', 'center', 'right']),
  background: z.enum(['none', 'brand', 'accent', 'dark', 'image']),
  padding: z.enum(['none', 's', 'm', 'l'])
})
export type VariantSpec = z.infer<typeof variantSpecSchema>

/** A variant as the library stores it. */
export type BlockVariant = {
  family: BlockType
  layout: Layout
  purpose: Purpose
  styles: Style[]
  spec: VariantSpec
  fingerprint: string
}

/** Most slots in one variant (a section is one row of an email). */
export const maxSlots = 24

/** Slots a family cannot do without. */
const familyNeeds: Partial<Record<BlockType, SlotKind[]>> = {
  header_logo: ['image'],
  hero_product: ['image'],
  hero_image: ['image'],
  offer_banner: ['heading'],
  product_feature: ['image', 'price'],
  product_grid_2col: ['image', 'price'],
  product_grid_3col: ['image', 'price'],
  category_tiles: ['image'],
  image_text: ['image', 'text'],
  review_strip: ['quote'],
  ugc_grid: ['image'],
  before_after: ['image'],
  cta: ['button'],
  footer: ['text']
}

/**
 * Whether a structure is one the email agents can draw: each row's columns
 * add up to the full width, at most `maxSlots` slots, and the slots its
 * family cannot do without. Returns the problems in plain words.
 */
export function variantProblems(
  family: BlockType,
  spec: VariantSpec
): string[] {
  const problems: string[] = []
  spec.rows.forEach((row, i) => {
    const total = row.columns.reduce((sum, c) => sum + c.width, 0)
    if (Math.abs(total - 1) > 0.02)
      problems.push(`row ${i + 1}: the columns add up to ${total.toFixed(2)}`)
  })
  const slots = spec.rows.flatMap((r) => r.columns.flatMap((c) => c.slots))
  if (slots.length > maxSlots) problems.push(`${slots.length} slots`)
  const kinds = new Set(slots.map((s) => s.kind))
  for (const need of familyNeeds[family] ?? [])
    if (!kinds.has(need)) problems.push(`a ${family} needs a ${need}`)
  return problems
}

type Row = VariantSpec['rows'][number]

/** Neighbouring paragraphs are one text slot; social icons are one row. */
export function mergeSlots(slots: Slot[]): Slot[] {
  const merged: Slot[] = []
  for (const slot of slots) {
    const last = merged.at(-1)
    if (last?.kind === 'text' && slot.kind === 'text')
      merged[merged.length - 1] = {
        kind: 'text',
        lines: Math.min(12, last.lines + slot.lines)
      }
    else if (last?.kind === 'social' && slot.kind === 'social') continue
    else merged.push(slot)
  }
  return merged
}

/**
 * Rows of a single column are one stack: the same design whether the HTML
 * put each part in a row of its own or all in one. The stack is cut again
 * into rows of at most 8 slots, so it never takes more rows than before.
 */
export function stackRows(rows: Row[]): Row[] {
  const out: Row[] = []
  let stack: Slot[] = []
  const flush = () => {
    const merged = mergeSlots(stack)
    for (let i = 0; i < merged.length; i += 8)
      out.push({ columns: [{ width: 1, slots: merged.slice(i, i + 8) }] })
    stack = []
  }
  for (const row of rows) {
    if (row.columns.length === 1) stack.push(...row.columns[0]!.slots)
    else {
      flush()
      out.push(row)
    }
  }
  flush()
  return out
}

/**
 * The structure as it is stored: defaults filled in, keys in a fixed order,
 * single-column rows stacked, column widths to two decimals.
 */
export function normalSpec(spec: VariantSpec): VariantSpec {
  const parsed = variantSpecSchema.parse(spec)
  return {
    rows: stackRows(parsed.rows).map((row) => ({
      columns: row.columns.map((c) => ({
        width: Math.round(c.width * 100) / 100,
        slots: c.slots.map(normalSlot)
      }))
    })),
    align: parsed.align,
    background: parsed.background,
    padding: parsed.padding
  }
}

function normalSlot(slot: Slot): Slot {
  switch (slot.kind) {
    case 'image':
      return {
        kind: 'image',
        role: slot.role,
        aspect: slot.aspect,
        bleed: slot.bleed
      }
    case 'heading':
      return { kind: 'heading', size: slot.size }
    case 'text':
      return { kind: 'text', lines: slot.lines }
    case 'button':
      return { kind: 'button', style: slot.style }
    default:
      return { kind: slot.kind }
  }
}

/**
 * The duplicate check's key: sha256 of the family and the structure's
 * shape, with column widths to tenths and paragraphs as short, medium or
 * long. Two sections that differ only by a pixel, a line or their words
 * have the same key. Layout, purpose and styles describe a variant; they
 * do not make a new one.
 */
export function fingerprintOf(family: BlockType, spec: VariantSpec) {
  const normal = normalSpec(spec)
  const shape = {
    ...normal,
    rows: normal.rows.map((row) => ({
      columns: row.columns.map((c) => ({
        width: Math.round(c.width * 10) / 10,
        slots: c.slots.map((slot) =>
          slot.kind === 'text'
            ? {
                kind: 'text',
                lines: slot.lines <= 2 ? 2 : slot.lines <= 5 ? 5 : 10
              }
            : slot
        )
      }))
    }))
  }
  return createHash('sha256')
    .update(JSON.stringify([family, shape]))
    .digest('hex')
}

const img = (
  role: 'product' | 'lifestyle' | 'logo' | 'icon',
  aspect: '1:1' | '4:5' | '3:2' | '16:9' | '2:1' | 'free',
  bleed = false
): Slot => ({ kind: 'image', role, aspect, bleed })
const one = (...slots: Slot[]) => ({ columns: [{ width: 1, slots }] })
const split = (width: number, left: Slot[], right: Slot[]) => ({
  columns: [
    { width, slots: left },
    { width: Math.round((1 - width) * 10) / 10, slots: right }
  ]
})
const across = (n: number, slots: Slot[]) => ({
  columns: Array.from({ length: n }, () => ({
    width: Math.round((1 / n) * 100) / 100,
    slots
  }))
})
const product: Slot[] = [
  img('product', '1:1'),
  { kind: 'text', lines: 1 },
  { kind: 'price' },
  { kind: 'button', style: 'link' }
]

/** The 20 seed blocks (BLK-001) as the first variant of each family. */
export const seedSpecs: Record<
  BlockType,
  { layout: Layout; purpose: Purpose; styles: Style[]; spec: VariantSpec }
> = {
  announcement_bar: {
    layout: 'strip',
    purpose: 'announcement',
    styles: ['minimal'],
    spec: {
      rows: [one({ kind: 'text', lines: 1 })],
      align: 'center',
      background: 'dark',
      padding: 's'
    }
  },
  header_logo: {
    layout: 'single_column',
    purpose: 'brand_header',
    styles: ['minimal'],
    spec: {
      rows: [one(img('logo', 'free'))],
      align: 'center',
      background: 'none',
      padding: 'm'
    }
  },
  hero_product: {
    layout: 'single_column',
    purpose: 'hook',
    styles: ['photo_led'],
    spec: {
      rows: [
        one(
          { kind: 'eyebrow' },
          { kind: 'heading', size: 'xl' },
          { kind: 'text', lines: 2 },
          img('product', '4:5'),
          { kind: 'button', style: 'solid' }
        )
      ],
      align: 'center',
      background: 'brand',
      padding: 'l'
    }
  },
  hero_image: {
    layout: 'full_width_image',
    purpose: 'hook',
    styles: ['photo_led'],
    spec: {
      rows: [
        one(img('lifestyle', '4:5', true)),
        one(
          { kind: 'heading', size: 'xl' },
          { kind: 'text', lines: 2 },
          { kind: 'button', style: 'solid' }
        )
      ],
      align: 'center',
      background: 'none',
      padding: 'none'
    }
  },
  offer_banner: {
    layout: 'single_column',
    purpose: 'offer',
    styles: ['bold'],
    spec: {
      rows: [
        one(
          { kind: 'heading', size: 'xl' },
          { kind: 'text', lines: 1 },
          { kind: 'code' },
          { kind: 'text', lines: 1 },
          { kind: 'button', style: 'solid' }
        )
      ],
      align: 'center',
      background: 'accent',
      padding: 'l'
    }
  },
  text: {
    layout: 'single_column',
    purpose: 'story',
    styles: ['text_led'],
    spec: {
      rows: [one({ kind: 'heading', size: 'm' }, { kind: 'text', lines: 5 })],
      align: 'left',
      background: 'none',
      padding: 'm'
    }
  },
  steps: {
    layout: 'list',
    purpose: 'education',
    styles: ['text_led'],
    spec: {
      rows: [
        one({ kind: 'heading', size: 'm' }),
        split(
          0.2,
          [{ kind: 'heading', size: 's' }],
          [{ kind: 'text', lines: 2 }]
        ),
        split(
          0.2,
          [{ kind: 'heading', size: 's' }],
          [{ kind: 'text', lines: 2 }]
        ),
        split(
          0.2,
          [{ kind: 'heading', size: 's' }],
          [{ kind: 'text', lines: 2 }]
        )
      ],
      align: 'left',
      background: 'none',
      padding: 'm'
    }
  },
  product_feature: {
    layout: 'image_left',
    purpose: 'product_showcase',
    styles: ['photo_led'],
    spec: {
      rows: [
        split(
          0.5,
          [img('product', '1:1')],
          [
            { kind: 'heading', size: 's' },
            { kind: 'text', lines: 1 },
            { kind: 'price' },
            { kind: 'text', lines: 2 },
            { kind: 'button', style: 'solid' }
          ]
        )
      ],
      align: 'left',
      background: 'none',
      padding: 'm'
    }
  },
  product_grid_2col: {
    layout: 'two_column',
    purpose: 'product_showcase',
    styles: ['photo_led'],
    spec: {
      rows: [
        one({ kind: 'heading', size: 'm' }),
        across(2, product),
        across(2, product)
      ],
      align: 'center',
      background: 'none',
      padding: 'm'
    }
  },
  product_grid_3col: {
    layout: 'three_column',
    purpose: 'product_showcase',
    styles: ['photo_led'],
    spec: {
      rows: [one({ kind: 'heading', size: 'm' }), across(3, product)],
      align: 'center',
      background: 'none',
      padding: 'm'
    }
  },
  category_tiles: {
    layout: 'grid',
    purpose: 'navigation',
    styles: ['photo_led'],
    spec: {
      rows: [
        one({ kind: 'heading', size: 'm' }),
        across(2, [img('lifestyle', '1:1'), { kind: 'text', lines: 1 }]),
        across(2, [img('lifestyle', '1:1'), { kind: 'text', lines: 1 }])
      ],
      align: 'center',
      background: 'none',
      padding: 'm'
    }
  },
  image_text: {
    layout: 'image_left',
    purpose: 'story',
    styles: ['editorial'],
    spec: {
      rows: [
        split(
          0.5,
          [img('lifestyle', '4:5')],
          [
            { kind: 'heading', size: 'm' },
            { kind: 'text', lines: 5 },
            { kind: 'button', style: 'link' }
          ]
        )
      ],
      align: 'left',
      background: 'none',
      padding: 'm'
    }
  },
  founder_note: {
    layout: 'single_column',
    purpose: 'story',
    styles: ['editorial'],
    spec: {
      rows: [
        one(
          img('lifestyle', '1:1'),
          { kind: 'text', lines: 10 },
          { kind: 'text', lines: 1 }
        )
      ],
      align: 'center',
      background: 'none',
      padding: 'l'
    }
  },
  review_strip: {
    layout: 'three_column',
    purpose: 'social_proof',
    styles: ['text_led'],
    spec: {
      rows: [
        one({ kind: 'heading', size: 'm' }),
        across(3, [
          { kind: 'rating' },
          { kind: 'quote' },
          { kind: 'text', lines: 1 }
        ])
      ],
      align: 'center',
      background: 'none',
      padding: 'm'
    }
  },
  ugc_grid: {
    layout: 'grid',
    purpose: 'social_proof',
    styles: ['photo_led'],
    spec: {
      rows: [
        one({ kind: 'heading', size: 'm' }),
        across(3, [img('lifestyle', '1:1')]),
        one({ kind: 'text', lines: 1 }, { kind: 'button', style: 'solid' })
      ],
      align: 'center',
      background: 'none',
      padding: 'm'
    }
  },
  before_after: {
    layout: 'two_column',
    purpose: 'social_proof',
    styles: ['photo_led'],
    spec: {
      rows: [
        across(2, [{ kind: 'eyebrow' }, img('lifestyle', '4:5')]),
        one({ kind: 'text', lines: 1 })
      ],
      align: 'center',
      background: 'none',
      padding: 'm'
    }
  },
  faq: {
    layout: 'list',
    purpose: 'education',
    styles: ['text_led'],
    spec: {
      rows: [
        one(
          { kind: 'heading', size: 'm' },
          { kind: 'heading', size: 's' },
          { kind: 'text', lines: 2 },
          { kind: 'heading', size: 's' },
          { kind: 'text', lines: 2 }
        )
      ],
      align: 'left',
      background: 'none',
      padding: 'm'
    }
  },
  cta: {
    layout: 'single_column',
    purpose: 'call_to_action',
    styles: ['minimal'],
    spec: {
      rows: [one({ kind: 'button', style: 'solid' })],
      align: 'center',
      background: 'none',
      padding: 'm'
    }
  },
  signoff: {
    layout: 'single_column',
    purpose: 'closing',
    styles: ['text_led'],
    spec: {
      rows: [one({ kind: 'text', lines: 2 })],
      align: 'center',
      background: 'none',
      padding: 'm'
    }
  },
  footer: {
    layout: 'single_column',
    purpose: 'legal',
    styles: ['minimal'],
    spec: {
      rows: [
        one(
          { kind: 'social' },
          { kind: 'text', lines: 2 },
          { kind: 'text', lines: 1 }
        )
      ],
      align: 'center',
      background: 'none',
      padding: 'm'
    }
  }
}

/** The seed variants with their fingerprints (the migration stores them). */
export function seedVariants(): BlockVariant[] {
  return blockTypes.map((family) => {
    const seed = seedSpecs[family]
    const spec = normalSpec(seed.spec)
    return {
      family,
      layout: seed.layout,
      purpose: seed.purpose,
      styles: seed.styles.slice(0, maxStyles),
      spec,
      fingerprint: fingerprintOf(family, spec)
    }
  })
}

export { layouts, purposes, styles }
