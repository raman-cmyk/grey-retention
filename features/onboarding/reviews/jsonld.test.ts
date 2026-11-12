// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { fold, pageReviews } from './jsonld'

const url = 'https://cedar-lane.example/products/weekend-knit'
const now = Date.UTC(2026, 10, 12, 12)
const page = (data: unknown[], extra = '') =>
  `<!doctype html><html><head>${data
    .map(
      (d) =>
        `<script type="application/ld+json">${typeof d === 'string' ? d : JSON.stringify(d)}</script>`
    )
    .join('')}${extra}</head><body><h1>Weekend Knit</h1></body></html>`
const product = (review: unknown[], more: Record<string, unknown> = {}) => ({
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: 'Weekend Knit',
  review,
  ...more
})
const stars = (ratingValue: unknown, more: Record<string, unknown> = {}) =>
  pageReviews(
    page([
      product([
        {
          author: 'B',
          reviewBody: 'Fine.',
          reviewRating: { ratingValue, ...more }
        }
      ])
    ]),
    url,
    now
  ).reviews.map((r) => [r.rating, r.ratingUnclear])[0]

describe('the review data a product page publishes', () => {
  it('reads each review with its author, words, stars and day, and names the app', () => {
    const found = pageReviews(
      page(
        [
          product(
            [
              {
                '@type': 'Review',
                author: { '@type': 'Person', name: 'Maya R.' },
                reviewBody: 'So soft &amp; warm.<br>It does not itch.',
                reviewRating: { ratingValue: '5' },
                datePublished: '2026-10-01T10:00:00Z'
              },
              {
                '@type': 'Review',
                author: 'Jonas P.',
                description: 'Runs large.',
                reviewRating: { ratingValue: 4 }
              }
            ],
            {
              aggregateRating: {
                '@type': 'AggregateRating',
                ratingValue: '4.84',
                reviewCount: 212
              }
            }
          )
        ],
        '<script src="https://cdn.judge.me/widget.js"></script>'
      ),
      url,
      now
    )
    expect(found.reviews).toEqual([
      {
        author: 'Maya R.',
        text: 'So soft & warm. It does not itch.',
        rating: 5,
        ratingUnclear: false,
        date: '2026-10-01',
        url,
        product: 'Weekend Knit'
      },
      {
        author: 'Jonas P.',
        text: 'Runs large.',
        rating: 4,
        ratingUnclear: false,
        date: null,
        url,
        product: 'Weekend Knit'
      }
    ])
    // The app by name only: a page's rating is one product's.
    expect(found.platform).toEqual({ name: 'Judge.me', url })
  })

  it('opens a graph and reads a review on its own', () => {
    const found = pageReviews(
      page([
        {
          '@graph': [
            { '@type': 'WebPage' },
            {
              '@type': 'Review',
              author: 'Lea K.',
              reviewBody: 'Deep pockets.',
              itemReviewed: { name: 'Field Overshirt' }
            }
          ]
        }
      ]),
      url,
      now
    )
    expect(found.reviews.map((r) => [r.author, r.product])).toEqual([
      ['Lea K.', 'Field Overshirt']
    ])
    // No app named on the page: no platform said.
    expect(found.platform).toBeNull()
  })

  it('reads product groups, main entities, variants and schema.org addresses', () => {
    const found = pageReviews(
      page([
        {
          '@type': 'ItemPage',
          mainEntity: {
            '@type': 'ProductGroup',
            name: 'Weekend Knit',
            review: [{ author: 'A', reviewBody: 'One.' }],
            hasVariant: [
              {
                '@type': 'http://schema.org/Product',
                name: 'Weekend Knit, oat',
                review: { author: 'B', reviewBody: 'Two.' }
              }
            ]
          }
        },
        {
          '@type': ['https://schema.org/Product'],
          name: 'Field Overshirt',
          review: [{ author: 'C', reviewBody: 'Three.' }]
        }
      ]),
      url,
      now
    )
    expect(found.reviews.map((r) => [r.author, r.product])).toEqual([
      ['A', 'Weekend Knit'],
      ['B', 'Weekend Knit, oat'],
      ['C', 'Field Overshirt']
    ])
  })

  it('leaves out reviews of the shop itself and reads a repeated review once', () => {
    const same = { author: 'Maya R.', reviewBody: 'So soft.' }
    const found = pageReviews(
      page([
        {
          '@type': 'Review',
          author: 'Sam',
          reviewBody: 'Fast shipping.',
          itemReviewed: { '@type': 'Organization', name: 'Cedar Lane' }
        },
        product([same, { ...same, author: 'maya r.' }]),
        { '@type': 'Review', ...same }
      ]),
      url,
      now
    )
    expect(found.reviews.map((r) => r.author)).toEqual(['Maya R.'])
  })

  it('scales stars to five and marks stars it cannot read as unclear', () => {
    expect(stars('5')).toEqual([5, false])
    expect(stars(8, { bestRating: 10 })).toEqual([4, false])
    expect(stars('4 / 5')).toEqual([4, false])
    expect(stars(10, { bestRating: '10', worstRating: 0 })).toEqual([5, false])
    expect(stars(0, { bestRating: 10, worstRating: 0 })).toEqual([1, false])
    // Out of its scale, not a number, or a scale that is no scale.
    expect(stars(9)).toEqual([null, true])
    expect(stars(0)).toEqual([null, true])
    expect(stars('great')).toEqual([null, true])
    expect(stars(3, { bestRating: 1 })).toEqual([null, true])
    // No stars given at all is not unclear.
    expect(
      pageReviews(
        page([product([{ author: 'B', reviewBody: 'Fine.' }])]),
        url,
        now
      ).reviews[0]
    ).toMatchObject({ rating: null, ratingUnclear: false })
  })

  it('leaves out broken data and reviews with no words', () => {
    const found = pageReviews(
      page([
        '{not json',
        {
          '@type': 'Product',
          review: [
            { author: 'A', reviewBody: '   ' },
            { author: 'A2', reviewBody: '<p></p>' },
            { author: 'B', reviewBody: 'Fine.' }
          ]
        }
      ]),
      url,
      now
    )
    expect(found.reviews).toEqual([
      {
        author: 'B',
        text: 'Fine.',
        rating: null,
        ratingUnclear: false,
        date: null,
        url,
        product: null
      }
    ])
  })

  it('keeps only a real day, not later than tomorrow', () => {
    const days = pageReviews(
      page([
        product(
          ['2026-10-01', '2026-02-30', '2027-01-01', 'yesterday', 20261001].map(
            (datePublished, i) => ({
              author: `A${i}`,
              reviewBody: 'Fine.',
              datePublished
            })
          )
        )
      ]),
      url,
      now
    ).reviews.map((r) => r.date)
    expect(days).toEqual(['2026-10-01', null, null, null, null])
  })

  it('names the review app only when the page loads exactly one', () => {
    const data = [product([{ author: 'A', reviewBody: 'Fine.' }])]
    const app = (extra: string) => pageReviews(page(data, extra), url, now)
    expect(
      app('<div class="yotpo yotpo-main-widget"></div>').platform?.name
    ).toBe('Yotpo')
    expect(
      app('<script src="https://loox.io/widget/loox.js"></script>').platform
        ?.name
    ).toBe('Loox')
    expect(
      app(
        '<script src="https://cdn.judge.me/w.js"></script><script src="https://widget.trustpilot.com/x.js"></script>'
      ).platform
    ).toBeNull()
    // A word that is only part of another word is no app.
    expect(app('<p>Our yotpoint deals</p>').platform).toBeNull()
  })

  it('never reads a script that is not review data', () => {
    expect(
      pageReviews(
        `<html><script>var r = {"@type":"Review","reviewBody":"fake"}</script></html>`,
        url,
        now
      ).reviews
    ).toEqual([])
  })
})

describe('the words a reader sees', () => {
  it('decodes each entity once and takes out whole tags only', () => {
    expect(fold('Soft &amp;quot;knit&amp;quot;')).toBe('Soft &quot;knit&quot;')
    expect(fold('It&#8217;s warm &#x2014; &rsquo;really&rsquo;')).toBe(
      'It’s warm — ’really’'
    )
    expect(fold('<b>Nice</b><br/>fit')).toBe('Nice fit')
    expect(fold('I <3 it, size < 10')).toBe('I <3 it, size < 10')
    expect(fold('So​ soft\u0007\n\n here')).toBe('So soft here')
  })
})
