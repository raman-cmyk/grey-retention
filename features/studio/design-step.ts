import { z } from 'zod'
import {
  parseBlock,
  type Block,
  type BlockType
} from '@/features/blocks/catalog'
import type { BlockBrand } from '@/features/blocks/brand'
import type { EmailType } from '@/features/strategy/plan'
import type { SectionBrief } from './designer'
import type { EmailViewPorts } from './email-check'
import type { BuildRender } from './waits'
import { isPicturePath, plannedReference } from './reference'
import { heroPicture, studioRound, type StudioPorts } from './rounds'
import {
  codeStoryboard,
  designable,
  storyboardShape,
  type Storyboard,
  type StoryboardInput
} from './storyboard'

/**
 * DST-006c part 2a: the design step with the design studio (D25), on
 * ports. The Art director storyboards the email once (kept in the work);
 * its designed heroes go through the studio's rounds (`studioRound`); a
 * hero whose picture passed gets it (DST-006a's `picture`, through a
 * long-lived signed link), every other block stays coded. The caller draws
 * the email from the blocks this returns (design A), or waits as asked.
 * Part 2b gives it the real ports behind `DESIGN_STUDIO=on`.
 */

/** What the design step has: the slot, layer 1 as locked, the draft, the brand. */
export type StudioStepInput = {
  slot: { emailType: EmailType; angle: string }
  /** Layer 1 as the content step locked it, in the draft's order. */
  sections: {
    family: BlockType
    purpose: string
    products: { title: string }[]
    /** Copy (DST-002b): its place in the reference email, when it follows one. */
    source?: number
  }[]
  /** The copy step's draft blocks, one per section. */
  blocks: readonly Block[]
  brand: BlockBrand
  /** The design step's saved work (`progress.work.design`), if any. */
  saved: unknown
  /**
   * DST-002b: the inbox email the sections step picked for Copy or Remix
   * (`SectionsOutput.reference`); missing for Scratch.
   */
  reference?: {
    mode: 'copy' | 'remix'
    reference: NonNullable<StoryboardInput['reference']>
    refIndex: readonly (number | null)[]
    /** DST-004b: each reference section's stored picture, for the match score. */
    images?: readonly (string | null)[]
  }
}

export type StudioStepPorts = StudioPorts & {
  /** Current workspace's collected web fonts, loaded once before briefs are hashed. */
  fonts?: () => Promise<SectionBrief['fonts']>
  /** The Art director (`storyboardFor`): null when no storyboard fits. */
  storyboard: (input: StoryboardInput) => Promise<Storyboard | null>
  /**
   * A long-lived https link to this drawn render of the build (read from
   * `renders`), its tag checked; null when it cannot be made.
   */
  sign: (
    render: Extract<BuildRender, { state: 'drawn' }>
  ) => Promise<string | null>
  /**
   * DST-006d: the whole-email check's ports (its views and the critic on
   * the whole email); without them a studio email is stored unjudged as a
   * whole.
   */
  email?: EmailViewPorts
}

export type StudioStepOutcome =
  /** Save `work` as the design step's work and wait (`wait_email_round`). */
  | { waiting: { work: object; seconds: number } }
  /**
   * The blocks to draw: heroes with their pictures, the rest coded. With
   * pictures, `work` is the studio's work to save should the step wait
   * again (DST-006d: for the email's views), with the links it signed, and
   * `budget` the studio's time and waits so far.
   */
  | {
      blocks: Block[]
      pictures: number
      work?: object
      budget?: { until: number; waits: number }
    }

/** The studio's part of the design step's work. */
const savedStep = z.object({
  studio: z.object({
    /** The storyboard, once made; null when none fitted. */
    storyboard: storyboardShape
      .extend({ source: z.enum(['agent', 'code']) })
      .nullable(),
    rounds: z.unknown().optional(),
    /**
     * DST-006d: each picture's signed link, once made: the email is drawn
     * the same on every claim, so its views are of the email stored.
     */
    signed: z
      .record(z.string(), z.object({ render: z.uuid(), src: z.string() }))
      .optional()
  })
})

/** The section ids the storyboard uses: one per block, in order. */
const sectionId = (i: number) => `s${i + 1}`

const https = (url: unknown): url is string => {
  if (typeof url !== 'string') return false
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && !u.username && !u.password
  } catch {
    return false
  }
}

/** The brief for one designed hero, in a fixed shape (its digest is its JSON). */
function briefFor(
  input: StudioStepInput,
  story: StoryboardInput,
  board: Storyboard['sections'][number],
  i: number,
  fonts: SectionBrief['fonts']
): SectionBrief | null {
  const block = input.blocks[i]
  if (!block || !designable.includes(block.type)) return null
  const c = block.content as {
    eyebrow?: string
    headline: string
    sub?: string
    image: string
    alt?: string
  }
  if (!https(c.image)) return null
  const words =
    block.type === 'hero_product'
      ? {
          ...(c.eyebrow ? { eyebrow: c.eyebrow } : {}),
          headline: c.headline,
          ...(c.sub ? { sub: c.sub } : {})
        }
      : { headline: c.headline, ...(c.sub ? { sub: c.sub } : {}) }
  const title = input.sections[i]?.products[0]?.title ?? c.alt
  const b = input.brand
  // Copy: the reference section's tone and height, as the storyboard keeps them.
  const ref = story.sections[i]?.ref
  const kept =
    story.mode === 'copy' && ref !== undefined
      ? story.reference?.[ref]
      : undefined
  // Pictures only in step with the reference: never another section's.
  const images =
    input.reference?.images?.length === input.reference?.reference.length
      ? input.reference?.images
      : undefined
  const picture = ref === undefined ? undefined : images?.[ref]
  return {
    mode: story.mode,
    slot: { emailType: input.slot.emailType, angle: input.slot.angle },
    board,
    family: block.type as SectionBrief['family'],
    words,
    image: { url: c.image, ...(c.alt ? { alt: c.alt } : {}) },
    ...(block.type === 'hero_product' && title ? { product: { title } } : {}),
    brand: {
      name: b.name,
      font: b.font,
      ink: b.ink,
      background: b.background,
      accent: b.accent,
      dark: b.dark,
      radius: b.radius
    },
    fonts,
    ...(kept
      ? {
          reference: {
            tone: kept.tone,
            height: kept.height,
            // DST-004b: its stored picture, for the match score and (DST-004c)
            // the designer's and critic's look at it.
            ...(isPicturePath(picture) ? { image: picture } : {})
          }
        }
      : {})
  }
}

/**
 * The storyboard's input: layer 1's sections, and in Copy and Remix the
 * reference each follows (`plannedReference`). A Copy whose reference
 * heights no storyboard can keep (code's own cannot fit them) is
 * storyboarded from scratch in the copied order, rather than drawn coded.
 */
function storyInput(input: StudioStepInput): {
  story: StoryboardInput
  unfit: boolean
} {
  const sections = input.sections.map((s, i) => ({
    id: sectionId(i),
    family: s.family,
    purpose: s.purpose,
    products: s.products.length,
    // DST-007: its height is the block it is drawn as (plain copy
    // draws steps and questions as text).
    ...(input.blocks[i]!.type !== s.family
      ? { drawn: input.blocks[i]!.type }
      : {})
  }))
  const scratch: StoryboardInput = {
    mode: 'scratch',
    slot: input.slot,
    sections
  }
  if (!input.reference) return { story: scratch, unfit: false }
  const planned = plannedReference(input.reference, input.sections)
  const story: StoryboardInput = {
    mode: input.reference.mode,
    slot: input.slot,
    sections: sections.map((s, i) => {
      const ref = planned.refs[i]
      return ref === undefined ? s : { ...s, ref }
    }),
    reference: planned.reference
  }
  if (
    story.mode === 'copy' &&
    !codeStoryboard(story) &&
    codeStoryboard(scratch)
  )
    return { story: scratch, unfit: true }
  return { story, unfit: false }
}

/** Plain copy draws a steps or FAQ section as text (ASM-002). */
const drawnAs = (family: BlockType, block: BlockType) =>
  family === block ||
  (block === 'text' && (family === 'steps' || family === 'faq'))

/** The section's background, as the storyboard's tone gives it. */
function backgroundOf(tone: string, brand: BlockBrand) {
  const colour =
    tone === 'dark'
      ? brand.dark
      : tone === 'accent'
        ? brand.accent
        : brand.background
  return typeof colour === 'string' &&
    /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(colour.trim())
    ? colour.trim()
    : undefined
}

/**
 * One claim of the design step with the studio. The storyboard is made on
 * the first claim and kept; an email the storyboard designs nothing in is
 * drawn coded, and one whose layer 1 and draft disagree is drawn coded and
 * logged. The blocks keep layer 1's order, the one the copy was checked
 * in (the Art director's order in Scratch is DST-006e).
 */
export async function studioDesignStep(
  input: StudioStepInput,
  ports: StudioStepPorts
): Promise<StudioStepOutcome> {
  const coded = { blocks: [...input.blocks], pictures: 0 }
  if (
    input.sections.length !== input.blocks.length ||
    input.sections.some((s, i) => !drawnAs(s.family, input.blocks[i]!.type))
  ) {
    await ports.coded('email', 'layout_changed')
    return coded
  }
  const saved = savedStep.safeParse(input.saved)
  // The build's limits are kept even when the rest of the work is not.
  const rounds = (input.saved as { studio?: { rounds?: unknown } } | null)
    ?.studio?.rounds
  // The same input on every claim: the briefs are made from it again.
  const { story: board, unfit } = storyInput(input)
  let storyboard: Storyboard | null
  if (saved.success) {
    storyboard = saved.data.studio.storyboard
  } else {
    if (unfit) await ports.coded('email', 'reference_unfit')
    storyboard = await ports.storyboard(board)
    // The copy was checked in layer 1's order: a storyboard that moves the
    // sections is replaced by code's own, which keeps it (DST-006e).
    if (
      storyboard &&
      storyboard.sections.some((b, i) => b.id !== sectionId(i))
    ) {
      await ports.coded('email', 'storyboard_reordered')
      storyboard = codeStoryboard(board)
    }
  }
  const designed: { i: number; brief: SectionBrief }[] = []
  let fonts: SectionBrief['fonts'] | undefined
  for (const b of storyboard?.sections ?? []) {
    if (b.render !== 'designed') continue
    fonts ??= (await ports.fonts?.()) ?? []
    const i = Number(/^s(\d+)$/.exec(b.id)?.[1] ?? 0) - 1
    const brief = i >= 0 ? briefFor(input, board, b, i, fonts) : null
    if (brief) designed.push({ i, brief })
    else await ports.coded(b.id, 'not_designable')
  }
  if (!designed.length) return coded
  const out = await studioRound(
    designed.map((d) => d.brief),
    rounds,
    ports
  )
  if ('wait' in out || 'paused' in out) {
    const work = 'wait' in out ? out.wait : out.paused
    return {
      waiting: {
        work: { studio: { storyboard, rounds: work } },
        seconds: out.seconds
      }
    }
  }
  const blocks = [...input.blocks]
  let pictures = 0
  let renders: BuildRender[] | undefined
  const kept = saved.success ? (saved.data.studio.signed ?? {}) : {}
  const signed: Record<string, { render: string; src: string }> = {}
  for (const s of out.done.sections) {
    if (s.state !== 'done' || !s.render) continue
    const d = designed.find((x) => x.brief.board.id === s.id)
    if (!d) continue
    // Only a picture this build's renders still hold as drawn, at its height.
    renders ??= await ports.renders()
    const drawn = renders.find(
      (r): r is Extract<BuildRender, { state: 'drawn' }> =>
        r.id === s.render && r.state === 'drawn' && r.height === s.height
    )
    // The link signed on an earlier claim for this same picture, else a new one.
    const before = kept[s.id]
    const src = drawn
      ? before?.render === drawn.id && https(before.src)
        ? before.src
        : await ports.sign(drawn)
      : null
    if (drawn && src) signed[s.id] = { render: drawn.id, src }
    const picture = src ? heroPicture(s, src) : null
    const bg = backgroundOf(d.brief.board.tone, input.brand)
    const block = blocks[d.i]!
    const parsed = picture
      ? parseBlock(block.type, {
          ...(block.content as object),
          picture: { ...picture, ...(bg ? { bg } : {}) }
        })
      : null
    if (parsed?.ok) {
      blocks[d.i] = parsed.block
      pictures++
    } else await ports.coded(s.id, 'picture_unusable')
  }
  if (!pictures) return { blocks, pictures }
  return {
    blocks,
    pictures,
    work: { studio: { storyboard, rounds: out.done, signed } },
    budget: { until: out.done.until, waits: out.done.waits }
  }
}
