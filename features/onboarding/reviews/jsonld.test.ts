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
const exact = (ratingValue: unknown, more: Record<string, unknown> = {}) =>
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
  ).reviews[0]?.ratingExact

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
        ratingExact: true,
        date: '2026-10-01',
        url,
        product: 'Weekend Knit'
      },
      {
        author: 'Jonas P.',
        text: 'Runs large.',
        rating: 4,
        ratingUnclear: false,
        ratingExact: true,
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

  it('reads every kind of product and leaves out a review naming the shop among its items', () => {
    const found = pageReviews(
      page([
        {
          '@type': 'IndividualProduct',
          name: 'Knit, one of a kind',
          review: { author: 'A', reviewBody: 'One.' }
        },
        {
          '@type': 'ProductModel',
          review: { author: 'B', reviewBody: 'Two.' }
        },
        {
          '@type': 'Review',
          author: 'C',
          reviewBody: 'Three.',
          itemReviewed: [{ '@type': 'Organization', name: 'Cedar Lane' }]
        },
        {
          '@type': 'Review',
          author: 'D',
          reviewBody: 'Four.',
          itemReviewed: [{ name: 'Weekend Knit' }]
        }
      ]),
      url,
      now
    )
    expect(found.reviews.map((r) => [r.author, r.product])).toEqual([
      ['A', 'Knit, one of a kind'],
      ['B', null],
      ['D', 'Weekend Knit']
    ])
  })

  it('never keeps half of a character pair, from an entity or a cut', () => {
    const found = pageReviews(
      page([
        product([
          {
            author: 'Ann',
            reviewBody: 'Love the colour &#xD83D; and the fit too'
          },
          { author: `${'a'.repeat(79)}😀`, reviewBody: 'Fine.' },
          { author: 'Bo', reviewBody: 'Escaped \ud83d half.' }
        ])
      ]).replace('Escaped \\ud83d', 'Escaped \ud83d'),
      url,
      now
    )
    const broken =
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
    for (const r of found.reviews) {
      expect(broken.test(r.text), r.text).toBe(false)
      expect(broken.test(r.author), r.author).toBe(false)
    }
    expect(found.reviews[0]?.text).toBe(
      'Love the colour \uFFFD and the fit too'
    )
    expect(found.reviews[1]?.author).toBe(`${'a'.repeat(79)}\uFFFD`)
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
    // Only a plain decimal: "0x5" is no five.
    expect(stars('0x5')).toEqual([null, true])
    expect(stars(' 4.5 ')).toEqual([5, false])
    // Rounded ratings are said to be rounded (REL-ONB2 part b: an email
    // shows only the page's own stars).
    expect(exact(' 4.5 ')).toBe(false)
    expect(exact(3.5)).toBe(false)
    expect(exact('3.5/5')).toBe(false)
    expect(exact(9, { bestRating: 10 })).toBe(false)
    expect(exact(8, { bestRating: 10 })).toBe(false)
    expect(exact('5')).toBe(true)
    expect(exact('4 / 5')).toBe(true)
    expect(exact(10, { bestRating: '10', worstRating: 0 })).toBe(true)
    expect(exact(0, { bestRating: 10, worstRating: 0 })).toBe(true)
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
        ratingExact: true,
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

describe("a review's own photos (REL-ONB2 part e)", () => {
  // A public host: an email never shows a picture on `.example`.
  const shopPage = 'https://cedar.myshopify.com/products/weekend-knit'
  const folder = 'https://cdn.shopify.com/s/files/1/0123/4567/8901'
  const judgeme = '<script src="https://cdn.judge.me/widget.js"></script>'
  const photos = (
    image: unknown,
    more: Record<string, unknown> = {},
    extra = judgeme
  ) =>
    pageReviews(
      page(
        [
          product(
            [{ author: 'Maya R.', reviewBody: 'So soft.', image, ...more }],
            { image: [`${folder}/products/knit.jpg`] }
          )
        ],
        extra
      ),
      shopPage,
      now,
      'cedar.myshopify.com'
    ).reviews[0]?.photos
  // Judge.me's folder is the store's Shopify name.
  const imgix = 'https://judgeme.imgix.net/cedar/1700000000__photo.jpg'

  it('keeps photos on the store’s own hosts, its review app’s and its own folder on Shopify’s CDN', () => {
    expect(
      photos(
        [
          '/cdn/shop/files/knit-1.jpg',
          { '@type': 'ImageObject', contentUrl: `${imgix}?auto=format&w=800` }
        ],
        {
          associatedMedia: [
            { '@type': 'ImageObject', url: `${folder}/files/knit-2.png` },
            'https://www.cedar.myshopify.com/knit-3.JPG'
          ]
        }
      )
    ).toEqual([
      'https://cedar.myshopify.com/cdn/shop/files/knit-1.jpg',
      // Imgix's `auto` is taken out: it may serve WebP or AVIF.
      `${imgix}?w=800`,
      `${folder}/files/knit-2.png`,
      'https://www.cedar.myshopify.com/knit-3.JPG'
    ])
  })

  it('refuses any other host, http, a format an email cannot show, a video, the product’s own picture and the reviewer’s name', () => {
    for (const image of [
      'https://images.example-cdn.com/knit-1.jpg',
      'https://cedar.myshopify.com.evil.com/knit-1.jpg',
      // Host tricks: a browser reads `\` as `/`; an escaped host is no host.
      'https://evil.example\\.cedar.myshopify.com/m.jpg',
      'https://evil.example%2f.cedar.myshopify.com/m.jpg',
      'https://evilcedar.myshopify.com/m.jpg',
      'https://judgeme.imgix.net.evil.example/m.jpg',
      'https://cedar.myshopify.com@evil.example/m.jpg',
      'https://user@cedar.myshopify.com/m.jpg',
      'http://cedar.myshopify.com/knit-1.jpg',
      'https://cedar.myshopify.com/knit-1.webp',
      'https://cdn.shopify.com/s/files/1/9999/8888/7777/files/knit-1.jpg',
      // Another store's folder on Judge.me's host.
      'https://judgeme.imgix.net/other-shop/1__photo.jpg',
      {
        '@type': 'VideoObject',
        contentUrl: 'https://cedar.myshopify.com/v.jpg'
      },
      // The product's own picture, at another size or on the store's address.
      `${folder}/products/knit_800x.jpg`,
      'https://cedar.myshopify.com/cdn/shop/products/knit.jpg?v=2',
      `https://cedar.myshopify.com/${'m'.repeat(500)}.jpg`,
      // The reviewer's name or an email address in it.
      'https://cedar.myshopify.com/1__maya_rodriguez__original.jpg',
      'https://cedar.myshopify.com/r.jpg?reviewer=Maya%20Rodriguez',
      'https://cedar.myshopify.com/maya.rodriguez@gmail.com.jpg',
      'https://cedar.myshopify.com/r.jpg?by=jo%40mail.example'
    ])
      expect(photos(image), JSON.stringify(image)).toBeUndefined()
    // Never the reviewer's own picture.
    expect(
      photos(undefined, {
        author: { '@type': 'Person', name: 'Maya R.', image: imgix }
      })
    ).toBeUndefined()
  })

  it('takes a review app’s host only when the page’s own scripts or styles load it, never its words', () => {
    for (const [extra, kept] of [
      [judgeme, true],
      ['<link rel="stylesheet" href="https://cdn.judge.me/w.css">', true],
      ['', false],
      ['<script src="https://loox.io/widget/loox.js"></script>', false],
      ['<meta itemprop="reviewBody" content="Loved by judge.me fans">', false],
      ['<script type="application/json">{"body":"judgeme"}</script>', false],
      ['<img alt="judgeme fan" src="/a.png">', false],
      ['<script>var src = "https://cdn.judge.me/widget.js"</script>', false]
    ] as [string, boolean][])
      expect(photos(imgix, {}, extra), extra).toEqual(
        kept ? [imgix] : undefined
      )
  })

  it('keeps a Judge.me photo only in the folder of the store’s Shopify name, as Shopify’s own script says it', () => {
    const custom = (script: string, image: string) =>
      pageReviews(
        page(
          [product([{ author: 'A', reviewBody: 'Fine.', image }])],
          `${judgeme}${script}`
        ),
        'https://north-studio.com/products/a',
        now,
        'north-studio.com'
      ).reviews[0]?.photos
    const own = 'https://judgeme.imgix.net/north-studio/1__photo.jpg'
    const shop = '<script>Shopify.shop = "north-studio.myshopify.com";</script>'
    expect(custom(shop, own)).toEqual([own])
    expect(custom(shop, imgix)).toBeUndefined()
    // No word of the store's Shopify name: no folder is the store's.
    expect(custom('', own)).toBeUndefined()
  })

  it('keeps photos only of a review of a product, never a testimonial of nothing', () => {
    const review = (itemReviewed: unknown) =>
      pageReviews(
        page(
          [
            {
              '@type': 'Review',
              author: 'A',
              reviewBody: 'Fine.',
              image: 'https://cedar.myshopify.com/hero-lifestyle.jpg',
              ...(itemReviewed ? { itemReviewed } : {})
            }
          ],
          judgeme
        ),
        shopPage,
        now
      ).reviews[0]
    expect(review(undefined)?.photos).toBeUndefined()
    expect(review({ name: 'Weekend Knit' })?.photos).toBeUndefined()
    expect(
      review({ '@type': 'Product', name: 'Weekend Knit' })?.photos
    ).toEqual(['https://cedar.myshopify.com/hero-lifestyle.jpg'])
  })

  it('keeps one picture once, at any imgix size and at either Shopify address, and at most five a review', () => {
    expect(
      photos([`${imgix}?w=200`, `${imgix}?w=800`], {
        associatedMedia: `${imgix}?w=1200&dpr=2`
      })
    ).toEqual([`${imgix}?w=200`])
    expect(
      photos([
        'https://cedar.myshopify.com/cdn/shop/files/knit-1.jpg',
        `${folder}/files/knit-1_400x.jpg`
      ])
    ).toEqual(['https://cedar.myshopify.com/cdn/shop/files/knit-1.jpg'])
    const own = (n: number) => `https://cedar.myshopify.com/r${n}.jpg`
    expect(
      photos([own(1), `${own(1)}?width=400`, ...[2, 3, 4, 5, 6].map(own)])
    ).toEqual([own(1), own(2), own(3), own(4), own(5)])
  })

  it('reads a page of thousands of product pictures and reviews in time, and markup nested deep', () => {
    const variants = Array.from({ length: 8_000 }, (_, n) => ({
      '@type': 'Product',
      image: `https://cedar.myshopify.com/v/${n}.jpg`
    }))
    const reviews = Array.from({ length: 3_000 }, (_, n) => ({
      author: `R${n}`,
      reviewBody: 'Fine.',
      image: `https://cedar.myshopify.com/r/${n}.jpg`
    }))
    const html = page([
      { '@type': 'ProductGroup', hasVariant: variants, review: reviews }
    ])
    expect(html.length).toBeLessThan(1_000_000)
    const started = performance.now()
    const found = pageReviews(html, shopPage, now)
    expect(performance.now() - started).toBeLessThan(3_000)
    expect(found.reviews).toHaveLength(3_000)
    // Only the first 100 reviews with a photo are looked at.
    expect(found.reviews.filter((r) => r.photos).length).toBe(100)
    // Deeper than a recursive walk can go (it overflows at 8,000 here);
    // the HTML parser itself is slow on deeper markup (a known limit).
    const deep = `<html><body>${'<div>'.repeat(8_000)}${judgeme}</body></html>`
    expect(() => pageReviews(deep, shopPage, now)).not.toThrow()
  }, 20_000)
})

describe('the words a reader sees', () => {
  it('decodes each entity once and takes out whole tags only', () => {
    expect(fold('Soft &amp;quot;knit&amp;quot;')).toBe('Soft &quot;knit&quot;')
    expect(fold('It&#8217;s warm &#x2014; &rsquo;really&rsquo;')).toBe(
      'It’s warm — ’really’'
    )
    expect(fold('<b>Nice</b><br/>fit')).toBe('Nice fit')
    expect(fold('I <3 it, size < 10')).toBe('I <3 it, size < 10')
    // Each half of a character pair written as an entity is no character
    // (as a browser shows it), and a raw half is replaced too.
    expect(fold('&#xD83D;&#xDE00; and &#128512;')).toBe('\uFFFD\uFFFD and 😀')
    expect(fold('a \uD83D b')).toBe('a \uFFFD b')
    // Only HTML's own tags: text between two signs stays.
    expect(fold('S<M and M>L fit')).toBe('S<M and M>L fit')
    expect(fold('<p class="x">Nice</p><span>fit</span>')).toBe('Nice fit')
    // HTML's Latin-1 names, each with its own capitals.
    expect(fold('Tr&egrave;s belle qualit&eacute; &Eacute;t&eacute;')).toBe(
      'Très belle qualité Été'
    )
    expect(fold('So​ soft\u0007\n\n here')).toBe('So soft here')
  })
})
