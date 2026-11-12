// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { pageReviews } from './jsonld'

const url = 'https://cedar-lane.example/products/weekend-knit'
const page = (data: unknown[], extra = '') =>
  `<!doctype html><html><head>${data
    .map(
      (d) =>
        `<script type="application/ld+json">${typeof d === 'string' ? d : JSON.stringify(d)}</script>`
    )
    .join('')}${extra}</head><body><h1>Weekend Knit</h1></body></html>`

describe('the review data a product page publishes', () => {
  it('reads each review with its author, words, stars and day, and the app’s rating', () => {
    const found = pageReviews(
      page(
        [
          {
            '@context': 'https://schema.org',
            '@type': 'Product',
            name: 'Weekend Knit',
            aggregateRating: {
              '@type': 'AggregateRating',
              ratingValue: '4.84',
              reviewCount: 212
            },
            review: [
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
            ]
          }
        ],
        '<script src="https://cdn.judge.me/widget.js"></script>'
      ),
      url
    )
    expect(found.reviews).toEqual([
      {
        author: 'Maya R.',
        text: 'So soft & warm. It does not itch.',
        rating: 5,
        date: '2026-10-01',
        url,
        product: 'Weekend Knit'
      },
      {
        author: 'Jonas P.',
        text: 'Runs large.',
        rating: 4,
        date: null,
        url,
        product: 'Weekend Knit'
      }
    ])
    expect(found.platform).toEqual({
      name: 'Judge.me',
      rating: 4.8,
      count: 212,
      url
    })
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
      url
    )
    expect(found.reviews.map((r) => [r.author, r.product])).toEqual([
      ['Lea K.', 'Field Overshirt']
    ])
    // No app named on the page: no platform said.
    expect(found.platform).toBeNull()
  })

  it('leaves out broken data, reviews with no words, and stars that are not stars', () => {
    const found = pageReviews(
      page([
        '{not json',
        {
          '@type': 'Product',
          review: [
            { author: 'A', reviewBody: '   ' },
            {
              author: 'B',
              reviewBody: 'Fine.',
              reviewRating: { ratingValue: 9 }
            }
          ]
        }
      ]),
      url
    )
    expect(found.reviews).toEqual([
      {
        author: 'B',
        text: 'Fine.',
        rating: null,
        date: null,
        url,
        product: null
      }
    ])
  })

  it('never reads a script that is not review data', () => {
    expect(
      pageReviews(
        `<html><script>var r = {"@type":"Review","reviewBody":"fake"}</script></html>`,
        url
      ).reviews
    ).toEqual([])
  })
})
