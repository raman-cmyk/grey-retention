import { headlineLimits, type Draft } from '@/features/assembly/assemble'
import type { BlockType } from '@/features/blocks/catalog'
import type { Finding } from './inspect'

/**
 * DST-PIC #20 ("Copy must fit the design") and the rest of #11 (length
 * limits on headlines): a written headline short enough for its section,
 * so a design never shrinks the type to fit it. A hero's headline is drawn
 * large (32 px across a coded hero: 45 characters is about two lines), so
 * it gets at most 45 characters; every other heading at most 60
 * (`headlineLimits`, which the Copywriter is told in its guide and rules).
 * A written draft over one is sent back with the reason. Only the
 * Copywriter's own drafts are held to it: the plain copy's words are
 * fixed facts (the block schemas still limit every headline to 80).
 *
 * The writer may not shorten a product's title ("name a product only by
 * its title as given"), so a headline that is long because of a title is
 * told to leave the title out, and a heading that is just the title (the
 * writer's, or the one code puts in when the writer gave none) is told to
 * be a shorter one of its own.
 */
export { headlineLimits }

const heroes = new Set<BlockType>(['hero_product', 'hero_image'])

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
/** A headline's length as a reader counts it: what they see, spaces trimmed. */
export const seenLength = (text: string) =>
  [...graphemes.segment(text.trim())].length

const plain = (text: string) =>
  text.replace(/…$/, '').replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * A written draft's headlines over their limit, as findings for the
 * Copywriter. `titles` are the store's product titles.
 */
export function headlineFindings(
  draft: Pick<Draft, 'blocks'>,
  titles: readonly string[] = []
): Finding[] {
  const own = titles.map(plain).filter(Boolean)
  return draft.blocks.flatMap((block, i) => {
    const content = (block.content ?? {}) as {
      headline?: unknown
      heading?: unknown
    }
    const hero = heroes.has(block.type)
    const text = hero ? content.headline : content.heading
    if (typeof text !== 'string') return []
    const most = hero ? headlineLimits.hero : headlineLimits.heading
    const n = seenLength(text)
    if (n <= most) return []
    const word = hero ? 'headline' : 'heading'
    const seen = plain(text)
    // The title itself, or the start of it that code clipped.
    const isTitle = own.some(
      (t) => t === seen || (text.trim().endsWith('…') && t.startsWith(seen))
    )
    // A title that is what makes it too long.
    const title = own.find((t) => seen.includes(t) && n - seenLength(t) <= most)
    const shows =
      block.type === 'product_feature'
        ? ' (it shows under the heading)'
        : block.type === 'hero_product' || block.type === 'image_text'
          ? ' (the picture shows the product)'
          : ''
    return [
      {
        by: 'code' as const,
        rule: 'headline_too_long',
        field: `${i + 1}-${block.type}`,
        reason: isTitle
          ? `The ${word} is the product’s title, ${n} characters; at most ${most}. Write a shorter ${word} of your own${shows}.`
          : title
            ? `The ${word} is ${n} characters with the product’s title in it; at most ${most}. Leave the title out${shows} and write about the product in a few words.`
            : hero
              ? `The headline is ${n} characters; a hero’s is at most ${most}. Use fewer, shorter words, never a smaller size.`
              : `The heading is ${n} characters; at most ${most}. Use fewer, shorter words.`
      }
    ]
  })
}
