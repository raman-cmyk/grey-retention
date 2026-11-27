import { createHash } from 'node:crypto'
import type { Browser } from '@playwright/test'
import {
  BLUEPRINT_VERSION,
  depthOf,
  partsOf,
  textOf,
  type Blueprint,
  type Item,
  type PartRole,
  type Section,
  type SectionKind,
  type TextPart
} from './blueprint'
import { copyBlueprint } from './copy'
import { forStorage } from './stored'

/**
 * DES-ENGINE-004 (step 4 of the email design plan, owner decision of 25
 * November 2026: "Scratch from the real library"): every section of every
 * stored Inspiration blueprint, and of a workspace's own uploads, becomes a
 * **library block**: one section's blueprint on its own, so Scratch can
 * build an email from the library's real layouts in the brand's own look.
 *
 * A block is **structure only** (rule 8). What it keeps: the section's
 * kind, its parts and their roles, every size, place, gap, column, fill
 * and font size (the geometry the engine draws). What it never keeps: a
 * picture address or a link (the stored blueprint has none already), and
 * the words: every letter is blanked to `x` (`X` for a capital), every
 * digit to `0`, so a block's text keeps only its length, its line breaks
 * and its capitals, which the brand swap fits the brand's own words to.
 * Its colours and fonts stay in the stored row (the brand swap reads which
 * fill is light or dark from them) and are never shown: a block is only
 * ever drawn through the brand swap, in the brand's own look.
 *
 * - `blockFingerprint`: the de-duplication. Two sections with the same
 *   kind, the same parts in the same columns at about the same widths and
 *   text sizes, are the same layout: one block with a count of uses (how
 *   often the layout is used, a "this layout works" signal). Sizes are
 *   rounded (column widths to 5 % of their space, text sizes to 2 px, line
 *   counts to bands, heights to about 12 %), neighbouring texts of the same
 *   role count as one, and no word, colour, picture or link counts.
 * - `blockFacts`: the size and shape facts the Scratch planner reads (the
 *   photo slots and their shapes, how many products, whether it shows a
 *   price, an old price or a code, its columns and height).
 * - the quality gate: a block is kept for Scratch only when it is a size
 *   the engine draws safely (`blockSafe`) and, drawn back on its own, it
 *   passes the likeness check against its source section (`checkBlock`,
 *   in the locked browser).
 *
 * Code only: no AI, no request, nothing sent.
 */

/** The version of the cut, the fingerprint and the facts (bumped with any). */
export const BLOCK_VERSION = 1

/** Section kinds that are glue between sections, never a block of their own. */
export const glueKinds: readonly SectionKind[] = ['spacer', 'divider']

/** The section kinds a block may be (every kind but the glue). */
export const blockKinds = [
  'header',
  'hero',
  'text',
  'image',
  'button',
  'product_grid',
  'columns',
  'offer',
  'social',
  'footer',
  'mixed'
] as const satisfies readonly SectionKind[]
export type BlockKind = (typeof blockKinds)[number]

export const blockLimits = {
  /** Shorter than this, a section is a line or a gap, not a layout. */
  minHeight: 16,
  /** Taller than this, a section is most of an email, not a block. */
  maxHeight: 1_600,
  maxParts: 150,
  /** A block's stored blueprint, in characters. */
  maxChars: 100_000
} as const

/** Why a section is not a block, or why a block fails its quality gate. */
export const blockWords = {
  glue: 'is space or a line between sections, not a layout of its own',
  cannot_copy: 'cannot be drawn by the engine',
  empty: 'has nothing in it',
  too_small: `is shorter than ${blockLimits.minHeight} px`,
  too_large: `is taller than ${blockLimits.maxHeight} px or has too many parts`,
  not_alike: 'did not draw back like its source section',
  not_drawn: 'could not be drawn',
  not_checked: 'was not checked by the browser'
} as const
export type BlockSkip = 'glue' | 'cannot_copy' | 'empty'
export type BlockFailure = Exclude<keyof typeof blockWords, BlockSkip>

/** The photo roles a block's slots take (never a logo, an icon or a social mark). */
const photoRoles = new Set<PartRole>(['hero_photo', 'photo', 'product_photo'])

export type BlockPhoto = {
  role: 'hero_photo' | 'photo' | 'product_photo'
  width: number
  height: number
}

/** What a block is, in the facts the Scratch planner reads. */
export type BlockFacts = {
  width: number
  height: number
  /** The most columns side by side anywhere in it. */
  columns: number
  photos: BlockPhoto[]
  /** How many products it shows (its product photos, else its product names). */
  products: number
  texts: number
  buttons: number
  headline: boolean
  logo: boolean
  icons: number
  prices: boolean
  oldPrice: boolean
  code: boolean
  /** It carries the unsubscribe link and the address (a footer Klaviyo needs). */
  footer: boolean
  /** Its own fill (a band), or the email's. */
  band: boolean
}

export type BlockCandidate = {
  /** The section's number in its email. */
  ordinal: number
  kind: BlockKind
  roles: PartRole[]
  facts: BlockFacts
  fingerprint: string
  /** The block as stored: one section, words blanked, no picture or link. */
  blueprint: Blueprint
  /**
   * The section as stored in its email (bare, with its words), on its
   * own: what the quality gate draws back and compares. Never stored as a
   * block.
   */
  check: Blueprint
  /** A size the engine does not draw safely: the gate fails without a drawing. */
  unsafe: Extract<BlockFailure, 'too_small' | 'too_large'> | null
}

export type BlockCut = {
  blocks: BlockCandidate[]
  skipped: { ordinal: number; kind: SectionKind; why: BlockSkip }[]
}

/**
 * Letters to `x`/`X`, digits to `0`, emoji and pictographs to `x`; the
 * marks a letter carries (accents) go; spaces, line breaks and signs stay.
 */
export function blankWords(words: string): string {
  return words
    .replace(/\p{M}/gu, '')
    .replace(/\p{Extended_Pictographic}/gu, 'x')
    .replace(/\p{L}|\p{N}/gu, (c) =>
      /\p{N}/u.test(c) ? '0' : c !== c.toLowerCase() ? 'X' : 'x'
    )
}

const wordless = (items: readonly Item[]): Item[] =>
  items.map((item): Item => {
    if (item.type === 'row')
      return {
        ...item,
        columns: item.columns.map((c) => ({ ...c, items: wordless(c.items) }))
      }
    if (item.type === 'text') {
      // The unsubscribe line is the footer Klaviyo needs: kept as its role
      // (legal), since the words that said so are blanked.
      const role: PartRole =
        item.role === 'footer_text' && /unsubscribe/i.test(textOf(item))
          ? 'legal'
          : item.role
      return {
        ...item,
        role,
        runs: item.runs.map((r) => ({ ...r, text: blankWords(r.text) }))
      }
    }
    if (item.type === 'button')
      return { ...item, label: blankWords(item.label) || 'x' }
    if (item.type === 'image') return { ...item, alt: blankWords(item.alt) }
    return item
  })

/** One section of an email as an email of its own (numbered 1, no gap above). */
export function sectionAlone(bp: Blueprint, section: Section): Blueprint {
  return {
    version: BLUEPRINT_VERSION,
    width: bp.width,
    page: bp.page,
    body: bp.body,
    sections: [{ ...section, ordinal: 1, gapBefore: 0 }],
    bottom: 0,
    margin: { top: 0, bottom: 0 }
  }
}

const round = (v: number, step: number) => Math.round(v / step)
const share = (v: number, of: number) => (of > 0 ? round(v / of, 0.05) : 0)
const lineBand = (lines: number) =>
  lines <= 3 ? lines : lines <= 6 ? 4 : lines <= 12 ? 7 : 13
const heightBand = (h: number) =>
  h <= 0 ? 0 : Math.round(Math.log(h) / Math.log(1.12))
const shapeBand = (w: number, h: number) =>
  w > 0 && h > 0 ? Math.round(Math.log2(w / h) * 4) : 0

/** Neighbouring texts of the same role read as one (two paragraphs, one body). */
function merged(items: readonly Item[]): Item[] {
  const out: Item[] = []
  for (const item of items) {
    const last = out.at(-1)
    if (
      item.type === 'text' &&
      last?.type === 'text' &&
      last.role === item.role
    ) {
      out[out.length - 1] = {
        ...last,
        lines: last.lines + item.lines,
        width: Math.max(last.width, item.width)
      } satisfies TextPart
      continue
    }
    out.push(item)
  }
  return out
}

function itemKey(item: Item, avail: number): unknown {
  switch (item.type) {
    case 'text':
      return [
        't',
        item.role,
        round(item.font.size, 2),
        lineBand(item.lines),
        item.align[0],
        share(item.width, avail)
      ]
    case 'image':
      return [
        'i',
        item.role,
        share(item.width, avail),
        shapeBand(item.width, item.height)
      ]
    case 'button':
      return ['b', item.role, share(item.width, avail), round(item.height, 8)]
    case 'divider':
      return ['d']
    case 'row':
      return [
        'r',
        item.columns.map((c) => [
          share(c.width, avail),
          c.background || c.border ? 1 : 0,
          merged(c.items).map((i) => itemKey(i, c.width))
        ])
      ]
  }
}

/**
 * A section's structural fingerprint (32 hex characters): its kind, its
 * band, its height band and its parts' tree with rounded sizes. Words,
 * colours, pictures, links and a pixel here or there never change it.
 */
export function blockFingerprint(section: Section): string {
  const key = [
    BLOCK_VERSION,
    section.kind,
    section.background && section.background !== section.around ? 1 : 0,
    heightBand(section.height),
    merged(section.items).map((i) => itemKey(i, section.width))
  ]
  return createHash('sha256')
    .update(JSON.stringify(key))
    .digest('hex')
    .slice(0, 32)
}

function maxColumns(items: readonly Item[]): number {
  let most = 1
  for (const item of items)
    if (item.type === 'row')
      most = Math.max(
        most,
        item.columns.length,
        ...item.columns.map((c) => maxColumns(c.items))
      )
  return most
}

/** The facts the Scratch planner reads about a section. */
export function blockFacts(section: Section): BlockFacts {
  const parts = partsOf(section.items)
  const roles = new Set(parts.map((p) => p.role))
  const photos: BlockPhoto[] = parts.flatMap((p) =>
    p.type === 'image' && photoRoles.has(p.role)
      ? [
          {
            role: p.role as BlockPhoto['role'],
            width: Math.round(p.width),
            height: Math.round(p.height)
          }
        ]
      : []
  )
  const productPhotos = photos.filter((p) => p.role === 'product_photo').length
  const productNames = parts.filter((p) => p.role === 'product_name').length
  return {
    width: Math.round(section.width),
    height: Math.round(section.height),
    columns: maxColumns(section.items),
    photos,
    products: Math.max(productPhotos, productNames),
    texts: parts.filter((p) => p.type === 'text').length,
    buttons: parts.filter((p) => p.type === 'button').length,
    headline: roles.has('headline'),
    logo: roles.has('logo'),
    icons: parts.filter((p) => p.role === 'icon' || p.role === 'social').length,
    prices: roles.has('price'),
    oldPrice: roles.has('old_price'),
    code: roles.has('code'),
    footer:
      roles.has('legal') ||
      parts.some(
        (p) =>
          p.type === 'text' &&
          p.role === 'footer_text' &&
          /unsubscribe/i.test(textOf(p))
      ),
    band: !!section.background && section.background !== section.around
  }
}

/** A size the engine draws safely, or why not. */
export function blockSafe(
  section: Section,
  stored: Blueprint
): BlockCandidate['unsafe'] {
  if (section.height < blockLimits.minHeight) return 'too_small'
  if (
    section.height > blockLimits.maxHeight ||
    partsOf(section.items).length > blockLimits.maxParts ||
    depthOf(section.items) > 4 ||
    JSON.stringify(stored).length > blockLimits.maxChars
  )
    return 'too_large'
  return null
}

const isBlockKind = (kind: SectionKind): kind is BlockKind =>
  (blockKinds as readonly string[]).includes(kind)

/**
 * Every section of a stored blueprint as a library block, or why it is
 * not one (glue, a section the engine cannot draw, an empty one). The
 * blueprint is made bare first (a stored one already is).
 */
export function cutBlocks(input: Blueprint): BlockCut {
  const bp = forStorage(input)
  const blocks: BlockCandidate[] = []
  const skipped: BlockCut['skipped'] = []
  for (const section of bp.sections) {
    const skip = (why: BlockSkip) =>
      skipped.push({ ordinal: section.ordinal, kind: section.kind, why })
    if (!isBlockKind(section.kind)) {
      skip('glue')
      continue
    }
    if (section.unsupported) {
      skip('cannot_copy')
      continue
    }
    if (!partsOf(section.items).length) {
      skip('empty')
      continue
    }
    const check = sectionAlone(bp, section)
    const blueprint: Blueprint = {
      ...check,
      sections: check.sections.map((s) => ({ ...s, items: wordless(s.items) }))
    }
    blocks.push({
      ordinal: section.ordinal,
      kind: section.kind,
      roles: [...new Set(partsOf(section.items).map((p) => p.role))].sort(),
      facts: blockFacts(section),
      fingerprint: blockFingerprint(section),
      blueprint,
      check,
      unsafe: blockSafe(section, blueprint)
    })
  }
  return { blocks, skipped }
}

export type BlockCheck =
  | { pass: true }
  | { pass: false; failure: 'not_alike' | 'not_drawn'; problems: string[] }

/**
 * The quality gate's drawing: the section on its own, drawn back by the
 * engine in the locked browser, measured and compared with itself as
 * stored (structure: every limit of the likeness check). Never throws.
 */
export async function checkBlock(
  browser: Browser,
  check: Blueprint
): Promise<BlockCheck> {
  try {
    // Drawn as Scratch draws a block: as a copy of its source (its parts
    // read with the source's kind and roles, the words fitted to its lines),
    // so a section read differently on its own (a first section looks like
    // a hero) is judged by its structure, as it is in an email.
    const drawn = await copyBlueprint(browser, check, structuredClone(check), {
      retries: 2
    })
    if (!drawn.ok)
      return { pass: false, failure: 'not_drawn', problems: [drawn.error] }
    const outcome = drawn.sections[0]
    if (drawn.sections.length === 1 && outcome?.result === 'copied')
      return { pass: true }
    return {
      pass: false,
      failure: 'not_alike',
      problems: (outcome?.problems ?? drawn.problems).slice(0, 3)
    }
  } catch (error) {
    return {
      pass: false,
      failure: 'not_drawn',
      problems: [error instanceof Error ? error.message : String(error)]
    }
  }
}

/** Candidates with the same fingerprint, the first one kept, with how many times it is used. */
export function dedupe<T extends { fingerprint: string }>(
  candidates: readonly T[]
): { block: T; uses: number }[] {
  const byPrint = new Map<string, { block: T; uses: number }>()
  for (const c of candidates) {
    const got = byPrint.get(c.fingerprint)
    if (got) got.uses++
    else byPrint.set(c.fingerprint, { block: c, uses: 1 })
  }
  return [...byPrint.values()]
}
