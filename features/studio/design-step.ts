import { z } from 'zod'
import {
  parseBlock,
  type Block,
  type BlockType
} from '@/features/blocks/catalog'
import type { BlockBrand } from '@/features/blocks/brand'
import type { EmailType } from '@/features/strategy/plan'
import type { SectionBrief } from './designer'
import {
  heroPicture,
  studioRound,
  studioWork,
  type StudioPorts
} from './rounds'
import {
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
  }[]
  /** The copy step's draft blocks, one per section. */
  blocks: readonly Block[]
  brand: BlockBrand
  /** The design step's saved work (`progress.work.design`), if any. */
  saved: unknown
}

export type StudioStepPorts = StudioPorts & {
  /** The Art director (`storyboardFor`): null when no storyboard fits. */
  storyboard: (input: StoryboardInput) => Promise<Storyboard | null>
  /**
   * A long-lived https link to a drawn render of this build, its tag
   * checked; null when it cannot be made.
   */
  sign: (render: string) => Promise<string | null>
}

export type StudioStepOutcome =
  /** Save `work` as the design step's work and wait (`wait_email_round`). */
  | { waiting: { work: object; seconds: number } }
  /** The blocks to draw: heroes with their pictures, the rest coded. */
  | { blocks: Block[]; pictures: number }

/** The studio's part of the design step's work. */
const savedStep = z.object({
  studio: z.object({
    /** The storyboard, once made; null when none fitted. */
    storyboard: storyboardShape
      .extend({ source: z.enum(['agent', 'code']) })
      .nullable(),
    rounds: z.unknown().optional()
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
  board: Storyboard['sections'][number],
  i: number
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
  return {
    mode: 'scratch',
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
    fonts: []
  }
}

/**
 * One claim of the design step with the studio. The storyboard is made on
 * the first claim and kept; an email the storyboard designs nothing in,
 * or whose layer 1 and draft disagree, is drawn coded at once.
 */
export async function studioDesignStep(
  input: StudioStepInput,
  ports: StudioStepPorts
): Promise<StudioStepOutcome> {
  const coded = { blocks: [...input.blocks], pictures: 0 }
  if (input.sections.length !== input.blocks.length) return coded
  const saved = savedStep.safeParse(input.saved)
  let storyboard: Storyboard | null
  if (saved.success) {
    storyboard = saved.data.studio.storyboard
  } else {
    storyboard = await ports.storyboard({
      mode: 'scratch',
      slot: input.slot,
      sections: input.sections.map((s, i) => ({
        id: sectionId(i),
        family: s.family,
        purpose: s.purpose,
        products: s.products.length
      }))
    })
  }
  const designed = (storyboard?.sections ?? []).flatMap((board) => {
    if (board.render !== 'designed') return []
    const i = Number(/^s(\d+)$/.exec(board.id)?.[1] ?? 0) - 1
    const brief = i >= 0 ? briefFor(input, board, i) : null
    return brief ? [{ i, brief }] : []
  })
  if (!designed.length) return coded
  const out = await studioRound(
    designed.map((d) => d.brief),
    saved.success ? saved.data.studio.rounds : undefined,
    ports
  )
  if ('wait' in out || 'paused' in out) {
    const rounds = 'wait' in out ? out.wait : out.paused
    return {
      waiting: {
        work: { studio: { storyboard, rounds } },
        seconds: out.seconds
      }
    }
  }
  const blocks = [...input.blocks]
  let pictures = 0
  for (const [n, s] of studioWork.parse(out.done).sections.entries()) {
    if (s.state !== 'done' || !s.render) continue
    const { i } = designed[n]!
    const src = await ports.sign(s.render)
    const picture = src ? heroPicture(s, src) : null
    const block = blocks[i]!
    const parsed = picture
      ? parseBlock(block.type, { ...(block.content as object), picture })
      : null
    if (parsed?.ok) {
      blocks[i] = parsed.block
      pictures++
    } else await ports.coded(s.id, 'picture_unusable')
  }
  return { blocks, pictures }
}
