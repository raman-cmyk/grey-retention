import { z } from 'zod'
import { hiddenChars } from '@/features/assembly/assemble'
import type { BlockType } from '@/features/blocks/catalog'
import type { BuildMode } from '@/features/email-build/sections'
import type { EmailType } from '@/features/strategy/plan'

/**
 * DST-002a (D25, AGENT_MAP §4 layer 3, step 1; owner pick #7): the
 * storyboard of a designed email, before any section is designed (the Art
 * director, DST-002, writes it; code checks it and has its own):
 * the light and dark rhythm, the white space, one focus per section and
 * where the products go, for an email about 1,800 to 2,400 px tall at 600
 * wide. Code checks the storyboard; one that keeps failing becomes code's
 * own (logged, D16). An email no storyboard can fit (too few or too many
 * sections) is not designed at all: it is drawn with coded blocks.
 *
 * Only the two heroes are designed (drawn as one picture by the Section
 * designer, DST-003); their button stays live HTML beside the picture.
 * Every other section is live HTML from its block variant, with the tone
 * that block always has. `focus` and `note` describe the design only: the
 * Section designer never draws them as words (all words come from the
 * copy, layer 2).
 *
 * Copy mode (D1 "Exact") keeps layer 1's order, which already follows the
 * reference email, and each designed section keeps its reference
 * section's tone and about its height.
 */

/** Sections the studio may draw as a picture; every other stays live. */
export const designable: readonly BlockType[] = ['hero_product', 'hero_image']
/** The email's height at 600 wide, in CSS px. */
export const emailHeight = { min: 1_800, max: 2_400 }
/** A designed section's height, CSS px at 600 wide. */
export const designedHeight = { min: 200, max: 1_200 }
/** At most this share of the email's height is pictures. */
export const maxDesignedShare = 0.6

/** How tall each live block is (CSS px at 600 wide): usual, fewest, most. */
const live: Partial<Record<BlockType, [number, number, number]>> = {
  announcement_bar: [44, 30, 70],
  header_logo: [96, 60, 160],
  hero_product: [640, 400, 900],
  hero_image: [600, 400, 900],
  text: [260, 100, 600],
  offer_banner: [320, 200, 420],
  product_feature: [420, 300, 700],
  product_grid_2col: [560, 300, 900],
  product_grid_3col: [480, 260, 800],
  image_text: [420, 250, 700],
  review_strip: [300, 180, 500],
  founder_note: [360, 220, 600],
  steps: [360, 200, 600],
  faq: [360, 200, 700],
  ugc_grid: [480, 300, 800],
  category_tiles: [400, 250, 700],
  before_after: [480, 300, 800],
  cta: [120, 80, 180],
  signoff: [100, 60, 160],
  footer: [200, 140, 280]
}
const liveRange = (f: BlockType) => live[f] ?? [300, 80, 900]
/** Blocks whose height follows their content: the storyboard may stretch them. */
const flexible = new Set<BlockType>([
  'hero_product',
  'hero_image',
  'text',
  'offer_banner',
  'product_feature',
  'product_grid_2col',
  'product_grid_3col',
  'image_text',
  'review_strip',
  'founder_note',
  'steps',
  'faq',
  'ugc_grid',
  'category_tiles',
  'before_after'
])
/** The tone a live block always has (`features/blocks/render.ts`). */
export const liveTone = (f: BlockType): Tone =>
  f === 'announcement_bar' ? 'dark' : f === 'offer_banner' ? 'accent' : 'light'

export type Tone = 'light' | 'dark' | 'accent'
const tones = ['light', 'dark', 'accent'] as const
/** The product photo, the store's own photo, the product on a backdrop, none. */
const imagery = ['product', 'photo', 'backdrop', 'none'] as const
const space = ['tight', 'normal', 'airy'] as const

export type StoryboardInput = {
  mode: BuildMode
  slot: { emailType: EmailType; angle: string }
  /** Layer 1's sections, in order, with what each does and its products. */
  sections: {
    id: string
    family: BlockType
    purpose: string
    products: number
    /** Copy and Remix: the reference section it follows (index in `reference`). */
    ref?: number
  }[]
  /** Copy and Remix: the reference email's sections, top to bottom (CSS px at 600 wide). */
  reference?: { family: BlockType; tone: Tone; height: number }[]
}

/** A storyboard's shape (the Art director's answer, checked by zod). */
export const storyboardShape = z.strictObject({
  sections: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(40),
        render: z.enum(['designed', 'live']),
        tone: z.enum(tones),
        height: z.int(),
        focus: z.string().trim().min(3).max(80),
        imagery: z.enum(imagery),
        space: z.enum(space),
        note: z.string().trim().max(200)
      })
    )
    .min(1)
    .max(16)
})
export type Storyboard = z.infer<typeof storyboardShape> & {
  source: 'agent' | 'code'
}
export type StoryboardSection = Storyboard['sections'][number]

/** One line, describing the design only: no price, percent, code or link. */
const designWords = (text: string) =>
  !/[\r\n\u2028\u2029]/.test(text) &&
  !hiddenChars.test(text) &&
  !/\d\s*%|[$€£¥]|\b[A-Z]{2,}\d+[A-Z\d]*\b|\bhttps?:|www\.|\.(?:com|net|org|io|shop|store)\b/i.test(
    text
  )

/** Code's check of a storyboard; empty means it passed. */
export function storyboardProblems(
  board: Pick<Storyboard, 'sections'>,
  input: StoryboardInput
): string[] {
  const problems: string[] = []
  const byId = new Map(input.sections.map((s) => [s.id, s]))
  const ids = board.sections.map((s) => s.id)
  if (
    ids.length !== input.sections.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !byId.has(id))
  )
    problems.push('Use every section given, each once, and no other.')
  const family = (i: number) => byId.get(board.sections[i]?.id)?.family
  if (input.mode === 'copy') {
    if (ids.join('|') !== input.sections.map((s) => s.id).join('|'))
      problems.push('Copy mode keeps the sections in the order given.')
  } else {
    const first = family(0) === 'announcement_bar' ? family(1) : family(0)
    if (first !== 'header_logo')
      problems.push('The email must start with the logo header.')
    if (family(board.sections.length - 1) !== 'footer')
      problems.push('The email must end with the footer.')
  }
  board.sections.forEach((s, i) => {
    const given = byId.get(s.id)
    if (!given) return
    const where = `Section ${s.id} (${given.family})`
    const designed = s.render === 'designed'
    if (designed && !designable.includes(given.family))
      problems.push(
        `${where} stays live HTML: only a hero is a picture; buttons, products, the offer, words and the footer are never one.`
      )
    const [, min, max] = designed
      ? [0, designedHeight.min, designedHeight.max]
      : liveRange(given.family)
    if (!Number.isInteger(s.height) || s.height < min || s.height > max)
      problems.push(`${where} is ${min} to ${max} px tall.`)
    if (!designed && s.tone !== liveTone(given.family))
      problems.push(
        `${where} is live, so its tone is ${liveTone(given.family)}.`
      )
    if (!designWords(s.focus) || !designWords(s.note))
      problems.push(
        `${where}: its focus and note describe the design only, in one line, with no price, percent, code or link.`
      )
    if (
      (s.imagery === 'product' || s.imagery === 'backdrop') &&
      given.products === 0
    )
      problems.push(`${where} has no product to show.`)
    if (s.imagery === 'backdrop' && !designed)
      problems.push(
        `${where} is live: only a designed section puts its product on a backdrop.`
      )
    if (s.imagery === 'photo' && given.family !== 'hero_image')
      problems.push(
        `${where}: only the picture hero shows the store’s own photo.`
      )
    if (
      designed &&
      given.family === 'hero_product' &&
      s.imagery !== 'product' &&
      s.imagery !== 'backdrop'
    )
      problems.push(`${where} shows its product.`)
    if (designed && given.family === 'hero_image' && s.imagery !== 'photo')
      problems.push(`${where} shows the store’s own photo.`)
    if (i > 0 && s.tone === 'dark' && board.sections[i - 1].tone === 'dark')
      problems.push(
        `Sections ${board.sections[i - 1].id} and ${s.id} are both dark: put a light section between them.`
      )
    const ref =
      given.ref !== undefined ? input.reference?.[given.ref] : undefined
    if (input.mode === 'copy' && designed && ref) {
      if (s.tone !== ref.tone)
        problems.push(
          `${where} keeps the reference section’s tone (${ref.tone}).`
        )
      if (Math.abs(s.height - ref.height) > ref.height * 0.25)
        problems.push(
          `${where} keeps about the reference section’s height (${ref.height} px).`
        )
    }
  })
  if (
    input.sections.some((s) => designable.includes(s.family)) &&
    !board.sections.some((s) => s.render === 'designed')
  )
    problems.push('Design at least one hero.')
  const total = board.sections.reduce((n, s) => n + s.height, 0)
  if (total < emailHeight.min || total > emailHeight.max)
    problems.push(
      `The email is ${total} px tall; make it ${emailHeight.min} to ${emailHeight.max} px.`
    )
  const pictures = board.sections
    .filter((s) => s.render === 'designed')
    .reduce((n, s) => n + s.height, 0)
  if (pictures > total * maxDesignedShare)
    problems.push(
      `Pictures are ${Math.round((pictures / Math.max(total, 1)) * 100)}% of the email; keep them to ${maxDesignedShare * 100}% or less.`
    )
  return [...new Set(problems)]
}

/** Moves `delta` px into (or out of) the sections at `at`, within their ranges; returns what is left. */
function spread(
  sections: StoryboardSection[],
  ranges: [number, number][],
  at: number[],
  delta: number
) {
  for (let round = 0; round < 50 && delta !== 0; round++) {
    const room = at.filter((i) =>
      delta > 0
        ? sections[i].height < ranges[i][1]
        : sections[i].height > ranges[i][0]
    )
    if (!room.length) break
    const share = Math.trunc(delta / room.length) || Math.sign(delta)
    for (const i of room) {
      if (delta === 0) break
      const want = Math.abs(share) > Math.abs(delta) ? delta : share
      const next = Math.min(
        ranges[i][1],
        Math.max(ranges[i][0], sections[i].height + want)
      )
      delta -= next - sections[i].height
      sections[i].height = next
    }
  }
  return delta
}

/**
 * Code's own storyboard: layer 1's order, the heroes designed (a product
 * hero only with a product), the first dark unless Copy mode gives its
 * reference tone, every other section live in its own tone, heights from
 * the reference (Copy) or usual, fitted to the email's height and the
 * pictures' share. Null when the email has no hero to design, or when no
 * storyboard can fit it: it is then drawn with coded blocks.
 */
export function codeStoryboard(input: StoryboardInput): Storyboard | null {
  let dark = false
  const ranges: [number, number][] = []
  const sections: StoryboardSection[] = input.sections.map((s, i) => {
    const designed =
      (s.family === 'hero_product' && s.products > 0) ||
      s.family === 'hero_image'
    const ref =
      input.mode === 'copy' && s.ref !== undefined
        ? input.reference?.[s.ref]
        : undefined
    const [usual, min, max] = designed
      ? [
          designed && s.family === 'hero_image' ? 600 : 640,
          designedHeight.min,
          designedHeight.max
        ]
      : liveRange(s.family)
    ranges.push([min, max])
    let tone: Tone = designed
      ? (ref?.tone ?? (dark ? 'light' : 'dark'))
      : liveTone(s.family)
    const before =
      i > 0
        ? input.sections[i - 1].family === 'announcement_bar'
          ? 'dark'
          : null
        : null
    if (designed && tone === 'dark' && before === 'dark') tone = 'accent'
    // The first designed section is the dark one (live blocks keep their own).
    if (designed && tone === 'dark') dark = true
    return {
      id: s.id,
      render: designed ? 'designed' : 'live',
      tone,
      height: Math.min(max, Math.max(min, Math.round(ref?.height ?? usual))),
      focus:
        s.purpose
          .replace(/\s+/g, ' ')
          .replace(/[^\p{L}\p{N} ,.'’-]/gu, '')
          .trim()
          .slice(0, 80) || 'Its message',
      imagery: designed
        ? s.family === 'hero_image'
          ? 'photo'
          : 'product'
        : s.products > 0
          ? 'product'
          : 'none',
      space: 'normal',
      note: ''
    }
  })
  sections.forEach((s) => {
    if (s.focus.length < 3) s.focus = 'Its message'
  })
  const total = () => sections.reduce((n, s) => n + s.height, 0)
  const pictures = () =>
    sections
      .filter((s) => s.render === 'designed')
      .reduce((n, s) => n + s.height, 0)
  const designedAt = sections.flatMap((s, i) =>
    s.render === 'designed' ? [i] : []
  )
  const liveFlexible = sections.flatMap((s, i) =>
    s.render === 'live' && flexible.has(input.sections[i].family) ? [i] : []
  )
  const anyLive = sections.flatMap((s, i) => (s.render === 'live' ? [i] : []))
  // Copy mode keeps the designed sections' reference heights where it can.
  const stretchable =
    input.mode === 'copy'
      ? [...liveFlexible, ...anyLive, ...designedAt]
      : [...liveFlexible, ...designedAt, ...anyLive]
  if (total() < emailHeight.min)
    spread(
      sections,
      ranges,
      [...new Set(stretchable)],
      emailHeight.min - total()
    )
  if (total() > emailHeight.max)
    spread(
      sections,
      ranges,
      [...new Set([...designedAt, ...liveFlexible, ...anyLive])],
      emailHeight.max - total()
    )
  // Pictures to at most their share: shrink them, and grow live sections to keep the height.
  const over = pictures() - Math.floor(total() * maxDesignedShare)
  if (over > 0) {
    // `spread` gives back what it could not move: the rest was shrunk.
    const shrunk = over + spread(sections, ranges, designedAt, -over)
    spread(
      sections,
      ranges,
      [...new Set([...liveFlexible, ...anyLive])],
      shrunk
    )
  }
  const board: Storyboard = { sections, source: 'code' }
  // Nothing to design (no hero that can be one), or no fit: coded blocks.
  if (!designedAt.length || storyboardProblems(board, input).length) return null
  return board
}
