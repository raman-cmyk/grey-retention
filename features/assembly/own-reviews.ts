import type { ConfirmedReview } from './inputs'
import { blockWords, copyDraftOf, type Draft } from './assemble'

/**
 * REL-ONB2 part b: the store's own reviews show their own stars without a
 * verified review source. These read a draft the way the checks that
 * judge stars must (the Brand inspector's copy QA and its AI, the golden
 * checks, release QA): a review strip that shows exactly the store's
 * confirmed reviews keeps its words, never its star lines.
 */

/** A confirmed review as one key: its words, its name and its stars. */
const reviewKey = (r: unknown) => {
  const { quote, author, rating } = (r ?? {}) as Record<string, unknown>
  return typeof quote === 'string' &&
    typeof author === 'string' &&
    typeof rating === 'number'
    ? JSON.stringify([quote, author, rating])
    : null
}

/**
 * The reviews a review strip shows when they are all the store's own
 * confirmed reviews (REL-ONB2 part b), or null: any other block, an empty
 * strip, or one with a review that is not the store's.
 */
export function ownStripReviews(
  block: Draft['blocks'][number] | undefined,
  own: readonly ConfirmedReview[]
): ConfirmedReview[] | null {
  const reviews = (block?.content as { reviews?: unknown } | undefined)?.reviews
  const keys = new Set(own.map(reviewKey))
  return block?.type === 'review_strip' &&
    Array.isArray(reviews) &&
    reviews.length > 0 &&
    reviews.every((r) => keys.has(reviewKey(r)))
    ? (reviews as ConfirmedReview[])
    : null
}

/**
 * The draft as copy QA reads it (`copyDraftOf`), without the stars of a
 * review strip that shows only the store's own confirmed reviews (REL-ONB2
 * part b): those stars are the reviews' own, read word for word from the
 * store's pages, never a rating the writer claims. Every other word is
 * judged, the strip's heading, quotes and names included, and a strip
 * showing any other review (or any other words, author or stars) keeps its
 * stars, so copy QA still refuses them without a verified review source.
 */
export function brandCopyDraft(draft: Draft, own: readonly ConfirmedReview[]) {
  const copy = copyDraftOf(draft)
  return {
    ...copy,
    blocks: copy.blocks.map((block, i) => {
      const b = draft.blocks[i]
      // Its words only (`copyDraftOf` adds nothing else to a strip but
      // its reviews' star lines), so no other line is ever left out.
      return b && ownStripReviews(b, own)
        ? { ...block, text: blockWords(b).join('\n') }
        : block
    })
  }
}
