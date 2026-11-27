import { createHash } from 'node:crypto'
import {
  BLUEPRINT_VERSION,
  type Blueprint
} from '@/features/design-engine/blueprint'
import type { BlockFacts, BlockKind } from '@/features/design-engine/blocks'
import { lightness } from '@/features/design-engine/palette'
import type { EmailType } from '@/features/strategy/plan'

/**
 * DES-ENGINE-004b (step 4 of the email design plan, owner decision of 25
 * November 2026: "Scratch from the real library"): GROS picks the sections
 * of a Scratch email from the **whole** block library (`library_blocks`:
 * every layout captured from the Inspiration inbox, and the workspace's
 * own private blocks), then the design engine draws them in the brand's
 * own look (brand swap, leak check, hard checks) and the email goes to
 * Klaviyo as a draft. Code only: no AI picks, so a pick is explained.
 *
 * - **Goal**: each email type has a running order of section kinds (a
 *   launch: header, hero, words, products, button, footer); a slot takes
 *   the first kind it has a fitting block for, and optional slots are left
 *   out when nothing fits.
 * - **The brand**: a block is used only when the brand can fill it: no
 *   discount code without an offer, no old price (a sale price is never
 *   guessed), no more products than the email has, product photos only for
 *   products with a photo, other photos only while the brand has photos
 *   left, a logo only with a logo, no icons (the brand has none stored),
 *   a footer only with the unsubscribe line Klaviyo needs, emails 600 px
 *   wide only.
 * - **Used a lot**: blocks used by more brands (then by more emails) rank
 *   higher, and
 *   blocks from emails of the same type (a launch's layouts for a launch).
 * - **Variety**: a block the workspace's last Scratch emails used ranks
 *   lower, and a small fixed shake per email (from its build) keeps two
 *   emails of the same type from always taking the same layout.
 * - The workspace's hidden layouts ("Don't use this layout") are never
 *   picked. Fewer than 3 blocks: Scratch draws coded blocks (the seeds),
 *   as before, with the reason.
 */

export type LibraryBlock = {
  id: string
  kind: BlockKind
  facts: BlockFacts
  /** The width of the email it came from (Scratch takes 600 px ones). */
  width: number
  uses: number
  brands: number
  emailTypes: readonly string[]
  /** A private block of this workspace (from its own upload). */
  yours: boolean
}

export type ScratchInput = {
  emailType: EmailType
  /** Products the email shows, and how many of them have a photo. */
  products: number
  productPhotos: number
  /** The email has a discount code. */
  offer: boolean
  logo: boolean
  /** The brand's own non-product photos (lifestyle, banners). */
  photos: number
  /** Blocks the workspace's last Scratch emails used. */
  recent: ReadonlySet<string>
  /** The build, for the email's own shake. */
  seed: string
}

export type ScratchPlan =
  | { ok: true; blocks: LibraryBlock[]; why: string[] }
  | { ok: false; reason: string }

/** The running order per email type: each slot the kinds it takes, in order. */
type Slot = {
  kinds: BlockKind[]
  optional?: boolean
  purpose: string
  /**
   * The email's main section: it takes a block with a headline when the
   * library has one that fits (every email needs one real heading).
   */
  lead?: true
}
const header: Slot = { kinds: ['header'], optional: true, purpose: 'logo' }
const button: Slot = { kinds: ['button'], optional: true, purpose: 'button' }
const footer: Slot = { kinds: ['footer'], optional: true, purpose: 'footer' }
export const scratchOrder: Record<EmailType, Slot[]> = {
  launch: [
    header,
    { kinds: ['hero'], purpose: 'the new product', lead: true },
    { kinds: ['text'], optional: true, purpose: 'the story' },
    { kinds: ['product_grid', 'columns'], optional: true, purpose: 'products' },
    button,
    footer
  ],
  bestseller: [
    header,
    { kinds: ['hero'], purpose: 'the best seller', lead: true },
    { kinds: ['product_grid'], optional: true, purpose: 'more best sellers' },
    {
      kinds: ['text', 'columns'],
      optional: true,
      purpose: 'why people love it'
    },
    button,
    footer
  ],
  offer: [
    header,
    { kinds: ['offer', 'hero'], purpose: 'the offer', lead: true },
    { kinds: ['product_grid', 'columns'], optional: true, purpose: 'products' },
    { kinds: ['text'], optional: true, purpose: 'the terms' },
    button,
    footer
  ],
  story: [
    header,
    { kinds: ['hero', 'image'], purpose: 'the opening picture', lead: true },
    { kinds: ['text'], purpose: 'the story' },
    { kinds: ['columns', 'text'], optional: true, purpose: 'more of it' },
    button,
    footer
  ],
  'gift guide': [
    header,
    { kinds: ['hero'], purpose: 'the guide', lead: true },
    { kinds: ['product_grid'], optional: true, purpose: 'the gifts' },
    { kinds: ['columns', 'text'], optional: true, purpose: 'how to choose' },
    button,
    footer
  ],
  restock: [
    header,
    { kinds: ['hero'], purpose: 'back in stock', lead: true },
    { kinds: ['text'], optional: true, purpose: 'the news' },
    { kinds: ['product_grid'], optional: true, purpose: 'products' },
    button,
    footer
  ],
  reminder: [
    header,
    { kinds: ['hero', 'text'], purpose: 'the reminder', lead: true },
    { kinds: ['product_grid', 'columns'], optional: true, purpose: 'products' },
    button,
    footer
  ],
  education: [
    header,
    { kinds: ['text', 'hero'], purpose: 'the lesson', lead: true },
    { kinds: ['columns'], optional: true, purpose: 'the steps' },
    { kinds: ['text'], optional: true, purpose: 'the takeaway' },
    button,
    footer
  ]
}

/** The inbox's email labels (CI-001) that match each of our email types. */
export const typeLabels: Record<EmailType, readonly string[]> = {
  launch: ['launch', 'new_arrivals'],
  bestseller: ['bestsellers', 'social_proof'],
  offer: ['sale', 'bundle'],
  story: ['story', 'newsletter'],
  'gift guide': ['gift_guide', 'holiday'],
  restock: ['restock'],
  reminder: ['bestsellers', 'collection'],
  education: ['education']
}

export const scratchLimits = {
  /** The email's own width; blocks of other widths are left out. */
  widthPx: 600,
  widthSlack: 4,
  /** The email at most this tall (sections only). */
  maxHeight: 2_800,
  minBlocks: 3
} as const

/** Why a block does not fit, or null. */
export function misfit(
  b: LibraryBlock,
  left: { products: number; productPhotos: number; photos: number },
  input: Pick<ScratchInput, 'offer' | 'logo'>
): string | null {
  const f = b.facts
  if (Math.abs(b.width - scratchLimits.widthPx) > scratchLimits.widthSlack)
    return 'from an email of another width'
  if (f.code && !input.offer) return 'shows a code and this email has none'
  if (b.kind === 'offer' && !input.offer)
    return 'an offer and this email has none'
  if (f.oldPrice) return 'shows an old price'
  if (f.icons > 0) return 'needs icons the brand has not stored'
  if (f.logo && !input.logo) return 'needs a logo'
  if (f.products > left.products) return 'shows more products than are left'
  if (f.prices && f.products === 0) return 'shows a price with no product'
  if (b.kind === 'product_grid' && f.products === 0)
    return 'a grid with no product'
  const productPhotos = f.photos.filter(
    (p) => p.role === 'product_photo'
  ).length
  if (productPhotos > left.productPhotos) return 'needs product photos'
  if (f.photos.length - productPhotos > left.photos) return 'needs more photos'
  if (b.kind === 'footer' && !f.footer)
    return 'a footer without the unsubscribe line'
  return null
}

/** A number in [0, 1) fixed for this email and block (the shake). */
const shake = (seed: string, id: string) =>
  createHash('sha256').update(`${seed}:${id}`).digest().readUInt32BE(0) /
  2 ** 32

export function rank(b: LibraryBlock, input: ScratchInput): number {
  const labels = typeLabels[input.emailType]
  return (
    // Different brands weigh most (one brand resending is weak evidence),
    // then different emails.
    Math.log1p(b.brands) +
    0.5 * Math.log1p(b.uses) +
    (b.emailTypes.some((t) => labels.includes(t)) ? 1 : 0) +
    (b.yours ? 0.5 : 0) -
    (input.recent.has(b.id) ? 3 : 0) +
    0.5 * shake(input.seed, b.id)
  )
}

/** The email's sections from the library, or why Scratch draws coded blocks. */
export function planScratch(
  library: readonly LibraryBlock[],
  input: ScratchInput
): ScratchPlan {
  const left = {
    products: input.products,
    productPhotos: input.productPhotos,
    photos: input.photos
  }
  const picked: LibraryBlock[] = []
  const why: string[] = []
  let height = 0
  for (const slot of scratchOrder[input.emailType]) {
    let best: LibraryBlock | null = null
    for (const kind of slot.kinds) {
      const fits = library
        .filter(
          (b) =>
            b.kind === kind &&
            !picked.some((p) => p.id === b.id) &&
            !misfit(b, left, input) &&
            height + b.facts.height <= scratchLimits.maxHeight
        )
        .sort(
          (a, b) => rank(b, input) - rank(a, input) || a.id.localeCompare(b.id)
        )
      // The main section brings the email's one real heading when it can.
      const headed =
        slot.lead && !picked.some((p) => p.facts.headline)
          ? fits.filter((b) => b.facts.headline)
          : []
      if (fits.length) {
        best = headed[0] ?? fits[0]!
        break
      }
    }
    if (!best) {
      if (slot.optional) continue
      return {
        ok: false,
        reason: `the library has no ${slot.kinds.join(' or ')} layout your brand can fill for ${slot.purpose}`
      }
    }
    picked.push(best)
    height += best.facts.height
    const productPhotos = best.facts.photos.filter(
      (p) => p.role === 'product_photo'
    ).length
    left.products -= best.facts.products
    left.productPhotos -= productPhotos
    left.photos -= best.facts.photos.length - productPhotos
    why.push(
      `${slot.purpose}: a ${best.kind.replace('_', ' ')} layout used ${best.uses} ${best.uses === 1 ? 'time' : 'times'}${best.yours ? ' (one of yours)' : ''}`
    )
  }
  if (picked.length < scratchLimits.minBlocks)
    return {
      ok: false,
      reason:
        'the library has too few layouts your brand can fill for this email'
    }
  return { ok: true, blocks: picked, why }
}

/**
 * The picked blocks as one email: their sections in order, numbered 1, 2,
 * 3…, the email's page and body colours from the first block. Each block
 * is one section on its own (`sectionAlone`), structure only.
 */
export function composeScratch(blocks: readonly Blueprint[]): Blueprint {
  const first = blocks[0]!
  return {
    version: BLUEPRINT_VERSION,
    width: first.width,
    page: first.page,
    body: first.body,
    // A section that showed its own email's fill (no fill of its own)
    // keeps that fill when it is of the other kind (a block from a dark
    // email in a light one stays a dark band), so its words are mapped
    // against the colour they sit on.
    sections: blocks.map((b, i) => {
      const s = b.sections[0]!
      return {
        ...s,
        ordinal: i + 1,
        gapBefore: 0,
        background:
          s.background ??
          (Math.abs(lightness(b.body) - lightness(first.body)) > 0.4
            ? b.body
            : null)
      }
    }),
    bottom: 0,
    margin: { top: 24, bottom: 24 }
  }
}
