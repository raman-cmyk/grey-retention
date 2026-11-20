// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { AiRun, Ask } from '@/features/intelligence/passes'
import {
  sampleComments,
  sampleReviews,
  type ReadReview
} from '@/lib/providers/review-source'
import { maxReviewPhotos } from './photos'
import {
  analyseCustomers,
  checkedCustomerFindings,
  customerPhotos,
  maxQuotable,
  platformFindings,
  quotableReviews
} from './reader'

const domain = 'cedar-lane.example'
const sample = sampleReviews(domain)
const reviews = sample.ok ? sample.reviews : []
const platforms = sample.ok ? sample.platforms : []
const social = sampleComments(domain)
const comments = social.ok ? social.comments : []
const review = (over: Partial<ReadReview>): ReadReview => ({
  ...reviews[0]!,
  ...over
})
const askWith = (run: AiRun) => vi.fn(async () => run) as unknown as Ask
const gemini = (content: unknown): AiRun => ({
  ok: true,
  content,
  provider: 'gemini',
  model: 'gemini-2.5-flash'
})
const raw = (over: Record<string, unknown>) => ({
  topic: 'review_theme' as const,
  statement: 'Customers love how soft the knit feels.',
  from: 'reviews' as const,
  ids: ['r1'],
  quote: 'it does not itch at all',
  confidence: 0.8,
  ...over
})

describe('the reviews an email may quote (chosen by code)', () => {
  it('keeps real reviews with their author, page and exact words, best and newest first', () => {
    const quotable = quotableReviews(reviews)
    expect(
      quotable.map((f) => [f.value, 'quote' in f.evidence && f.evidence.quote])
    ).toEqual([
      [
        {
          author: 'Lea K.',
          url: 'https://cedar-lane.example/products/field-overshirt',
          rating: 5,
          date: '2026-10-03'
        },
        'The overshirt feels soft from day one and the pockets are deep.'
      ],
      [
        {
          author: 'Maya R.',
          url: 'https://cedar-lane.example/products/weekend-knit',
          rating: 5,
          date: '2026-10-01'
        },
        'So soft and warm, and it does not itch at all. I wear it every weekend.'
      ],
      [
        {
          author: 'Jonas P.',
          url: 'https://cedar-lane.example/products/weekend-knit',
          rating: 4,
          date: '2026-10-02'
        },
        'Beautiful knit, but it runs a little large. Order a size down.'
      ]
    ])
    // Each cites the page it is on.
    for (const f of quotable)
      expect('url' in f.evidence && f.evidence.url).toBe(f.value.url)
  })

  it('never quotes a review with no author, too few words, three stars or less, or a link, address, handle or phone', () => {
    for (const over of [
      { author: '' },
      { author: 'maya@example.com' },
      { text: 'Love it!' },
      { text: 'x'.repeat(301) },
      { rating: 3 },
      { text: 'Lovely knit, see more at https://other.example/deal' },
      { text: 'Lovely knit, write to me at maya@example.com please' },
      { text: 'Lovely knit, follow me on @maya.layers for more' },
      { text: 'Lovely knit, call me at +1 555 123 4567 today' },
      { text: 'Lovely knit, send another to 12 Elm Street please' },
      // A name that is no one's.
      { author: 'Verified Buyer' },
      { author: 'anonymous' },
      { author: '   ' },
      { author: 'Amazon Customer' },
      { author: 'Verified Purchaser' },
      { author: 'Anonymous User' },
      // Left over from the page's markup.
      { text: 'Lovely knit &amp; so warm, I wear it daily' },
      { text: 'Lovely knit <b>so warm</b>, I wear it daily' },
      { author: 'Maya &amp; Jo' }
    ])
      expect(quotableReviews([review(over)]), JSON.stringify(over)).toEqual([])
    expect(
      quotableReviews(
        Array.from({ length: 9 }, (_, n) => review({ id: `r${n + 1}` }))
      )
    ).toHaveLength(maxQuotable)
  })

  it('names the review app the pages show, by name only, citing the page’s review data', () => {
    expect(platformFindings(platforms)).toEqual([
      {
        topic: 'review_platform',
        statement: 'Product pages show reviews from Judge.me.',
        value: { name: 'Judge.me', verified: false },
        evidence: {
          ref: 'review-data:https://cedar-lane.example/products/weekend-knit'
        },
        confidence: 0.8,
        source: 'reviews'
      }
    ])
  })

  it('quotes ordinary words with numbers that are no address', () => {
    for (const text of [
      'Five stars, 5 stars all the way, I love it',
      'I have worn it 100 times on the way to work',
      'Got 2 for the way home, lovely and warm',
      'My 3 st bernards love lying on it',
      'Took 4 of them on road trips, all lovely'
    ])
      expect(quotableReviews([review({ text })]), text).toHaveLength(1)
  })

  it('quotes a review with no stars given, but never one whose stars are unclear', () => {
    expect(quotableReviews([review({ rating: null })])[0]?.value).toEqual({
      author: 'Maya R.',
      url: 'https://cedar-lane.example/products/weekend-knit',
      date: '2026-10-01'
    })
    expect(
      quotableReviews([review({ rating: null, ratingUnclear: true })])
    ).toEqual([])
  })

  it('never quotes stars the page did not give: a rating rounded to whole stars is left out (REL-ONB2 part b)', () => {
    // 3.5 or 4.5 stars, 8 of 10: rounded, so not the page's own stars.
    expect(
      quotableReviews([review({ rating: 4, ratingExact: false })])
    ).toEqual([])
    expect(
      quotableReviews([review({ rating: 5, ratingExact: false })])
    ).toEqual([])
    expect(
      quotableReviews([review({ rating: 5, ratingExact: true })])
    ).toHaveLength(1)
  })
})

describe('the photos customers posted with their reviews (REL-ONB2 part e)', () => {
  const shot = (n: number, query = '') =>
    `https://judgeme.imgix.net/cedar/${n}__photo.jpg${query}`
  const urls = (found: ReturnType<typeof customerPhotos>) =>
    found.map((f) => (f.value as { url: string }).url)

  it('keeps each photo on its own with its page and product, never the reviewer’s name or words', () => {
    const found = customerPhotos([review({ photos: [shot(1)] })])
    expect(found).toEqual([
      {
        topic: 'customer_photo',
        statement:
          "A photo a customer posted with their review on the store's own page.",
        value: {
          url: shot(1),
          page: 'https://cedar-lane.example/products/weekend-knit',
          product: 'Weekend Knit'
        },
        evidence: {
          ref: 'review-data:https://cedar-lane.example/products/weekend-knit'
        },
        confidence: 0.9,
        source: 'reviews'
      }
    ])
    expect(JSON.stringify(found)).not.toMatch(/Maya|soft/)
  })

  it('never keeps a photo of a review left out: no stars, three stars or less, no one’s name, rounded stars', () => {
    for (const over of [
      // A photo shows the product: only a happy customer's, with stars.
      { rating: null },
      { rating: 3 },
      { rating: 1 },
      { author: 'Verified Buyer' },
      { ratingUnclear: true },
      { rating: 5, ratingExact: false },
      { text: 'Love it!' }
    ])
      expect(
        customerPhotos([review({ ...over, photos: [shot(1)] })]),
        JSON.stringify(over)
      ).toEqual([])
  })

  it('keeps the best rated and newest reviews’ photos first, each once at any size, at most 12', () => {
    expect(
      urls(
        customerPhotos([
          review({ id: 'r1', rating: 4, photos: [shot(1)] }),
          review({ id: 'r2', photos: [shot(2), shot(3, '?width=400')] }),
          review({ id: 'r3', photos: [shot(3), shot(2, '?width=200')] })
        ])
      )
    ).toEqual([shot(2), shot(3, '?width=400'), shot(1)])
    const many = Array.from({ length: 4 }, (_, n) =>
      review({
        id: `r${n + 1}`,
        photos: [1, 2, 3, 4, 5].map((k) => shot(n * 10 + k))
      })
    )
    expect(customerPhotos(many)).toHaveLength(maxReviewPhotos)
  })

  it('keeps a photo once at any size or address, and Shopify CDN and Judge.me photos of one folder each, as the database does', () => {
    const cdn = (folder: string, n: number) =>
      `https://cdn.shopify.com/s/files/1/${folder}/files/${n}.jpg`
    expect(
      urls(
        customerPhotos([
          review({
            photos: [
              shot(1, '?w=200'),
              shot(1, '?w=1200&dpr=2&fit=crop'),
              cdn('0123/4567/8901', 2),
              // The same Shopify file on the store's own address.
              'https://cedar-lane.example/cdn/shop/files/2.jpg',
              cdn('9999/9999', 3),
              cdn('0123/4567/8901', 4),
              'https://judgeme.imgix.net/other-shop/5__photo.jpg'
            ]
          })
        ])
      )
    ).toEqual([
      shot(1, '?w=200'),
      cdn('0123/4567/8901', 2),
      cdn('0123/4567/8901', 4)
    ])
  })

  it('leaves the product out rather than the photo when the value would be too long', () => {
    const found = customerPhotos([
      review({
        photos: [`https://judgeme.imgix.net/${'p'.repeat(440)}.jpg`],
        url: `https://cedar-lane.example/products/${'k'.repeat(340)}`,
        product: 'Weekend Knit '.repeat(9).trim()
      })
    ])
    expect(found).toHaveLength(1)
    expect(found[0]!.value).not.toHaveProperty('product')
  })
})

describe('what the reader says about customers', () => {
  it('keeps a theme, a worry and customers’ words citing what they rest on, under its source', () => {
    const { kept, dropped } = checkedCustomerFindings(reviews, comments, [
      raw({}),
      raw({
        topic: 'objection',
        statement: 'Some customers find the knit runs large.',
        ids: ['r2'],
        quote: 'it runs a little large'
      }),
      raw({
        topic: 'customer_words',
        statement: 'Customers ask about more colours.',
        from: 'comments',
        ids: ['c1'],
        quote: 'come in a darker green'
      })
    ])
    expect(dropped).toBe(0)
    expect(kept.map((f) => [f.source, f.topic, f.evidence])).toEqual([
      [
        'reviews',
        'review_theme',
        {
          url: 'https://cedar-lane.example/products/weekend-knit',
          quote: 'it does not itch at all'
        }
      ],
      [
        'reviews',
        'objection',
        {
          url: 'https://cedar-lane.example/products/weekend-knit',
          quote: 'it runs a little large'
        }
      ],
      [
        'social',
        'customer_words',
        {
          url: 'https://www.instagram.com/p/SAMPLE01/',
          quote: 'come in a darker green'
        }
      ]
    ])
  })

  it('never keeps an invented quote, a review it was not given, or numbers and claims', () => {
    const cases = [
      raw({ ids: ['r99'] }),
      raw({ ids: ['r1', 'r99'] }),
      // A comment's id cited as a review.
      raw({ ids: ['c1'] }),
      raw({ quote: 'the softest sweater I ever owned' }),
      raw({ quote: 'itch' }),
      // Words from another review than the first cited.
      raw({ ids: ['r2'], quote: 'it does not itch at all' }),
      raw({ statement: 'Customers give it 5 stars.' }),
      raw({ statement: 'Customers call it the best knit in the world.' }),
      // Part of a word is not the review's words.
      raw({ quote: 'oes not itch at al' })
    ]
    const { kept, dropped } = checkedCustomerFindings(reviews, comments, cases)
    expect(kept).toEqual([])
    expect(dropped).toBe(cases.length)
  })
})

describe('the words the reader quotes', () => {
  it('keeps a quote as the review writes it', () => {
    const { kept } = checkedCustomerFindings(reviews, comments, [
      raw({ quote: 'IT DOES NOT ITCH  AT ALL' })
    ])
    expect(kept.map((f) => 'quote' in f.evidence && f.evidence.quote)).toEqual([
      'it does not itch at all'
    ])
  })

  it('never quotes markup or half of a character pair', () => {
    const own = [
      review({ id: 'r1', text: 'So soft &lt;br&gt; and warm 😀 all winter' })
    ]
    const { kept } = checkedCustomerFindings(own, comments, [
      raw({ quote: 'So soft &lt;br&gt; and' }),
      raw({ quote: 'and warm \uD83D' })
    ])
    expect(kept).toEqual([])
  })

  it('never quotes a person’s details, nor a claim as customers’ words', () => {
    const own = [
      review({
        id: 'r1',
        text: 'Lovely knit, write to me at maya@example.com, it feels so natural and soft on the skin.'
      })
    ]
    const { kept } = checkedCustomerFindings(own, comments, [
      raw({ quote: 'write to me at maya@example.com' }),
      raw({ topic: 'customer_words', quote: 'so natural and soft' }),
      // The same words as a theme (the statement is checked, not the quote).
      raw({ quote: 'so natural and soft' })
    ])
    expect(kept.map((f) => f.topic)).toEqual(['review_theme'])
  })
})

describe('asking the Reviews + social reader', () => {
  it('says nothing with the fake AI (themes need a model)', async () => {
    expect(
      await analyseCustomers(
        'Cedar Lane',
        reviews,
        comments,
        askWith({ ok: true, content: null, provider: 'fake', model: 'fake' }),
        'k'
      )
    ).toEqual({
      answered: true,
      findings: [],
      dropped: 0,
      pass: 'sample',
      model: null
    })
  })

  it('keeps a model’s findings only when they hold up', async () => {
    const read = await analyseCustomers(
      'Cedar Lane',
      reviews,
      comments,
      askWith(gemini({ findings: [raw({}), raw({ ids: ['r99'] })] })),
      'k'
    )
    expect(read).toMatchObject({ answered: true, pass: 'model', dropped: 1 })
  })

  it('leaves out an unusable answer or a spent budget, and tries again on an outage', async () => {
    for (const [run, reason] of [
      [{ ok: false, code: 'invalid_output' }, 'model_unusable'],
      [{ ok: false, code: 'refused' }, 'model_refused'],
      [{ ok: false, code: 'incomplete' }, 'answer_too_long'],
      [{ ok: false, code: 'cap_reached' }, 'budget_spent'],
      [gemini({ findings: 'none' }), 'model_unusable']
    ] as const)
      expect(
        await analyseCustomers(
          'Cedar Lane',
          reviews,
          comments,
          askWith(run as AiRun),
          'k'
        )
      ).toEqual({ answered: false, reason })
    await expect(
      analyseCustomers(
        'Cedar Lane',
        reviews,
        comments,
        askWith({ ok: false, code: 'rate_limited' }),
        'k'
      )
    ).rejects.toMatchObject({ name: 'TagError', retryable: true })
  })
})
