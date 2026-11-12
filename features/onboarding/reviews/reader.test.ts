// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { AiRun, Ask } from '@/features/intelligence/passes'
import {
  sampleComments,
  sampleReviews,
  type ReadReview
} from '@/lib/providers/review-source'
import {
  analyseCustomers,
  checkedCustomerFindings,
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
      // Left over from the page's markup.
      { text: 'Lovely knit &amp; so warm, I wear it daily' },
      { text: 'Lovely knit <b>so warm</b>, I wear it daily' }
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
