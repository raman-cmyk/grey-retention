import type { Draft } from '@/features/assembly/assemble'
import type { BlockType } from '@/features/blocks/catalog'
import type { Finding } from './inspect'

/**
 * DST-PIC #20 ("Copy must fit the design") and the rest of #11 (length
 * limits on headlines): a written headline short enough for its section,
 * so a design never shrinks the type to fit it. A hero's headline is drawn
 * large (in the studio's picture, at least 23 px, PIC-16), so it gets
 * about two lines; every other heading a little more. The Copywriter is
 * told the limits (`writerRules`); a written draft over one is sent back
 * to use fewer, shorter words. Only the Copywriter's own drafts are held
 * to it: the plain copy's words are fixed facts (the block schemas still
 * limit every headline to 60 to 80 characters).
 */
export const headlineLimits = { hero: 45, heading: 60 } as const

const heroes = new Set<BlockType>(['hero_product', 'hero_image'])

/** A headline as the reader counts it: its characters, spaces trimmed. */
const length = (text: string) => [...text.trim()].length

/** A written draft's headlines over their limit, as findings for the Copywriter. */
export function headlineFindings(draft: Pick<Draft, 'blocks'>): Finding[] {
  return draft.blocks.flatMap((block, i) => {
    const content = (block.content ?? {}) as {
      headline?: unknown
      heading?: unknown
    }
    const hero = heroes.has(block.type)
    const text = hero ? content.headline : content.heading
    if (typeof text !== 'string') return []
    const most = hero ? headlineLimits.hero : headlineLimits.heading
    const n = length(text)
    if (n <= most) return []
    return [
      {
        by: 'code' as const,
        rule: 'headline_too_long',
        field: `${i + 1}-${block.type}`,
        reason: hero
          ? `The headline is ${n} characters; a hero’s is at most ${most}, about two lines in its design. Use fewer, shorter words, never a smaller size.`
          : `The heading is ${n} characters; at most ${most}. Use fewer, shorter words.`
      }
    ]
  })
}
