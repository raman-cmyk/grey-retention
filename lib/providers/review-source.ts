/**
 * What customers say about the brand (ONB-105, D19): the reviews on its
 * own product pages and the comments on its public social posts.
 *
 * `ReviewSource` and `SocialSource` are the ports: each answers with what
 * it read, or says why it could not. The sample sources serve recorded
 * samples for the synthetic brands (`*.example`) only; they never invent
 * a review for a real brand. A real brand's reviews are read from its own
 * product pages (the review data they publish, schema.org `Review`), the
 * live site only with the owner's `SITE_READER_MODE=live`; its social
 * comments are not read yet (which route is the owner's choice), so that
 * part of a read is logged and skipped (D16).
 */

export type ReadReview = {
  /** Stable within a read: `r1`, `r2`… in the order read. */
  id: string
  /** The name the review shows, as shown. */
  author: string
  text: string
  /** Stars, 1 to 5 (scaled from the review's own scale), when it gives them. */
  rating: number | null
  /** True when the review gives stars that could not be read (never quoted). */
  ratingUnclear: boolean
  /** The day it was written (YYYY-MM-DD), when known. */
  date: string | null
  /** The brand's own page it was read on. */
  url: string
  product: string | null
}

/**
 * A review app the brand's pages show (Judge.me, Yotpo…), named once on
 * the page. Its rating is not kept: a page's rating is one product's.
 */
export type PlatformRating = {
  name: string
  url: string
}

export type ReviewAnswer =
  | {
      ok: true
      reviews: ReadReview[]
      platforms: PlatformRating[]
      /** The pages read (whether or not they had reviews), each once. */
      pages: string[]
      /** False when a page meant to be read was not (cut off, unreadable). */
      complete: boolean
    }
  | {
      ok: false
      /**
       * `not_set_up`: nothing reads this brand; `no_pages`: no product
       * page was found to read; `unavailable`: try later.
       */
      code: 'not_set_up' | 'no_pages' | 'unavailable'
    }

export type SocialComment = {
  /** Stable within a read: `c1`, `c2`… */
  id: string
  platform: 'instagram' | 'facebook' | 'tiktok'
  /** The public post it was left on. */
  url: string
  author: string
  text: string
}

export type SocialAnswer =
  | { ok: true; comments: SocialComment[] }
  | { ok: false; code: 'not_set_up' | 'unavailable' }

export type ReviewQuery = {
  brandName: string
  /** The brand's own domain, lower case, without `www.`. */
  domain: string
  signal?: AbortSignal
}

export type ReviewSource = {
  /** False for the sample source: its reviews are not a real brand's. */
  live: boolean
  reviews(query: ReviewQuery): Promise<ReviewAnswer>
}
export type SocialSource = {
  live: boolean
  comments(query: ReviewQuery): Promise<SocialAnswer>
}

/** Reviews and comments one read keeps, and the length of each. */
export const maxReviews = 60
export const maxComments = 60
export const maxReviewText = 1_000

const synthetic = (domain: string) =>
  domain.trim().toLowerCase().endsWith('.example')

/**
 * Sample reviews for a synthetic brand: praise, a worry, a short line that
 * is no quote, one without an author, plus the shop's rating. A brand
 * named `quiet…` has no reviews.
 */
export function sampleReviews(domain: string): ReviewAnswer {
  const host = domain.trim().toLowerCase()
  const page = (path: string) => `https://${host}${path}`
  const knit = page('/products/weekend-knit')
  const shirt = page('/products/field-overshirt')
  if (host.startsWith('quiet'))
    return {
      ok: true,
      reviews: [],
      platforms: [],
      pages: [knit, shirt],
      complete: true
    }
  const review = (
    n: number,
    over: Partial<ReadReview> & Pick<ReadReview, 'text'>
  ): ReadReview => ({
    id: `r${n}`,
    author: 'Maya R.',
    rating: 5,
    ratingUnclear: false,
    date: '2026-10-0' + n,
    url: knit,
    product: 'Weekend Knit',
    ...over
  })
  return {
    ok: true,
    pages: [knit, shirt],
    complete: true,
    platforms: [{ name: 'Judge.me', url: knit }],
    reviews: [
      review(1, {
        text: 'So soft and warm, and it does not itch at all. I wear it every weekend.'
      }),
      review(2, {
        author: 'Jonas P.',
        text: 'Beautiful knit, but it runs a little large. Order a size down.',
        rating: 4
      }),
      review(3, {
        author: 'Lea K.',
        text: 'The overshirt feels soft from day one and the pockets are deep.',
        url: shirt,
        product: 'Field Overshirt'
      }),
      review(4, { author: 'Sam T.', text: 'Love it!', rating: 5 }),
      review(5, {
        author: '',
        text: 'Shipping took longer than I hoped, but the knit is lovely.',
        rating: 3
      })
    ]
  }
}

/** Sample comments on a synthetic brand's public posts. */
export function sampleComments(domain: string): SocialAnswer {
  const host = domain.trim().toLowerCase()
  if (host.startsWith('quiet')) return { ok: true, comments: [] }
  const post = 'https://www.instagram.com/p/SAMPLE01/'
  return {
    ok: true,
    comments: [
      {
        id: 'c1',
        platform: 'instagram',
        url: post,
        author: 'ana.layers',
        text: 'Does the knit come in a darker green?'
      },
      {
        id: 'c2',
        platform: 'instagram',
        url: post,
        author: 'weekend.walks',
        text: 'Mine still looks new after two winters.'
      }
    ]
  }
}

/** The sample sources: a synthetic brand's samples, nothing for any other. */
export const sampleReviewSource: ReviewSource = {
  live: false,
  async reviews({ domain }) {
    return synthetic(domain)
      ? sampleReviews(domain)
      : { ok: false, code: 'not_set_up' }
  }
}
export const sampleSocialSource: SocialSource = {
  live: false,
  async comments({ domain }) {
    return synthetic(domain)
      ? sampleComments(domain)
      : { ok: false, code: 'not_set_up' }
  }
}

/**
 * The social source a read uses, by its mode: the sample for a synthetic
 * brand; for a real brand none yet (`not_set_up`), until the owner
 * chooses how public social profiles are read.
 */
export function socialSourceFor(mode: 'sample' | 'live'): SocialSource {
  if (mode === 'sample') return sampleSocialSource
  return {
    live: true,
    async comments() {
      return { ok: false, code: 'not_set_up' }
    }
  }
}
