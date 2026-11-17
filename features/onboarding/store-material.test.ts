import { describe, expect, it } from 'vitest'
import { allowedBlockTypes, unknownFacts } from '@/features/assembly/inputs'
import { checkCopy } from '@/features/copy-qa/check'
import type { Finding } from './findings'
import {
  maxQuote,
  reviewerName,
  storeMaterial,
  type MaterialParts
} from './store-material'

const site = 'https://shop.example'
const warm = 'Warm without being bulky, I wear it all weekend.'
const cosy = 'So cosy on cold mornings, and it washes well.'
const solid = 'The colour is lovely and the knit feels solid.'
const scarf = 'So soft, my 100% Merino Scarf goes with everything.'
type Over = Record<string, unknown>
const review = (quote: string, value: Over = {}, over: Over = {}) =>
  ({
    topic: 'quotable_review',
    source: 'reviews',
    statement: 'A review an email may quote.',
    value: { author: 'Jordan Smith', url: `${site}/p/1`, rating: 5, ...value },
    evidence: { url: `${site}/p/1`, quote },
    confidence: 0.9,
    pass: 'code',
    ...over
  }) as unknown as Finding
const on = (url: string) => ({ evidence: { url, quote: warm } })
const verified = {
  topic: 'review_platform',
  source: 'reviews',
  value: { name: 'Judge.me', verified: true }
} as unknown as Finding
const facts = { ...unknownFacts, reviewsVerified: true }
const parts = (over: Partial<MaterialParts> = {}): MaterialParts => ({
  brandName: 'Cedar Lane',
  host: 'shop.example',
  live: true,
  findings: [],
  facts,
  productNames: ['Weekend Knit', '100% Merino Scarf'],
  ...over
})
const material = (findings: Finding[], over: Partial<MaterialParts> = {}) =>
  storeMaterial(parts({ findings, ...over }))

describe('reviewerName (REL-ONB2)', () => {
  it.each([
    ['Jordan Smith', 'Jordan S.'],
    ['  Jordan   smith ', 'Jordan S.'],
    ['Jordan S.', 'Jordan S.'],
    ['jordan', 'jordan'],
    ['Mary Ann O’Neil', 'Mary O.'],
    ['J. Smith', 'J. S.'],
    ['Dr. Jane Smith', 'Jane S.'],
    ['Mrs Ann Lee', 'Ann L.'],
    ['Ines Andersson', 'Ines A.'],
    ['Jordan V.', 'Jordan V.'],
    ['Zoë Ångström', 'Zoë Å.']
  ])('names %j as %j', (author, shown) => {
    expect(reviewerName(author)).toBe(shown)
  })
  it.each([
    '',
    'Dr.',
    'Verified Buyer',
    'Store Customer',
    'user123',
    'jo@example.com',
    '@jordan',
    'Jordan & Sam',
    'Kate and Sam',
    'Jordan from Leeds',
    'Sarah in London',
    'Jordan Smith Jr.',
    'John Smith III',
    'John Smith V',
    'John Smith PhD',
    'Jane Smith MD',
    'Ann Lee DDS',
    'Sam Ray Esq.',
    'Kim Park DVM',
    'Lee Chan RN',
    'Al Bent CPA',
    'One Two Three Four Five',
    'Abcdefghijklmnopqrstuvwxyzabcdefg'
  ])('names no one for %j (never an initial made up)', (author) => {
    expect(reviewerName(author)).toBeNull()
  })
})

describe('storeMaterial (REL-ONB2 part a)', () => {
  it('allows the review strip exactly when there are reviews, and no other material block', () => {
    const allowed = (confirmed: ReturnType<typeof storeMaterial>) =>
      allowedBlockTypes({
        brief: { campaignType: 'launch', goal: 'New knits' },
        products: [],
        codes: [],
        maxDiscountPercent: 0,
        sendAt: '2026-12-01T10:00:00Z',
        timezone: 'UTC',
        facts,
        confirmed
      })
    const none = material([])
    expect(none).toBeUndefined()
    expect(allowed(none)).not.toContain('review_strip')
    const some = allowed(material([verified, review(warm)]))
    expect(some).toContain('review_strip')
    for (const type of ['founder_note', 'ugc_grid', 'hero_image'])
      expect(some).not.toContain(type)
  })

  it('quotes the reviews word for word with their own stars, best and newest first, at most 3, each once, by first name and initial', () => {
    const got = material([
      verified,
      review(warm, { rating: 4, date: '2026-10-01' }),
      review(cosy, { author: 'Priya', date: '2026-09-01' }),
      review(solid, { author: 'Sam Lee', date: '2026-10-10' }),
      review('Bought a second one for my sister straight away.', {
        rating: 4,
        date: '2026-08-01'
      }),
      review(cosy, { author: 'Priya', date: '2026-09-01' })
    ])
    expect(got).toEqual({
      reviews: [
        { quote: solid, author: 'Sam L.', rating: 5 },
        { quote: cosy, author: 'Priya', rating: 5 },
        { quote: warm, author: 'Jordan S.', rating: 4 }
      ]
    })
    // Each passes the Brand inspector's copy QA in an email that places
    // no product (it masks only the products an email places).
    for (const r of got!.reviews!)
      expect(
        checkCopy({
          draft: {
            subject: '',
            preview: '',
            blocks: [
              {
                id: '1-review_strip',
                text: `${r.quote}\n${r.author}\nRated ${r.rating} out of 5`
              }
            ]
          },
          facts,
          maxDiscountPercent: 0,
          codes: [],
          productNames: [],
          sendAt: '2026-12-01T10:00:00Z'
        }).pass
      ).toBe(true)
  })

  it('carries the store’s own reviews without a verified review source, and still leaves out one whose words claim stars (REL-ONB2 part b)', () => {
    expect(material([review(warm)], { facts: unknownFacts })?.reviews).toEqual([
      { quote: warm, author: 'Jordan S.', rating: 5 }
    ])
    // Stars in the words themselves are a rating copy QA refuses without a
    // verified review source; only the strip's own stars pass the inspector.
    expect(
      material([review('So warm and soft, 5 stars from me.')], {
        facts: unknownFacts
      })
    ).toBeUndefined()
    expect(
      material([review('So warm and soft, 5 stars from me.')])?.reviews
    ).toHaveLength(1)
  })

  it('leaves out every review it would have to change or that an email may not say', () => {
    const long = `${'Warm and soft. '.repeat(14)}Lovely.`
    expect(long.length).toBeGreaterThan(maxQuote)
    const left = [
      review(warm, { rating: undefined }), // no stars of its own
      review(long), // never cut
      review(warm, { author: 'Verified Buyer' }),
      review(warm, { author: 'Jordan from Leeds' }),
      review(warm, { author: 'Natural Sam' }), // copy QA reads the name too
      review(warm, {}, on('https://other.example/p/1')),
      review(warm, {}, { pass: 'sample' }), // in a live workspace
      review(warm, {}, { confidence: 0.55 }), // less sure than a fact
      // Someone named: the reviewer, another customer, the staff.
      review('Jordan Smith here, I wear this jumper every weekend.'),
      review('jordan here, and it is so warm on cold days.'),
      review('Sarah Jones in the shop helped me choose the colour.'),
      review('Maria helped me pick the size and it fits well.'),
      // A first name first: before a comma, a place word or a verb.
      review('Ordered for my mum. Linda adores the colour and wears it daily.'),
      review('Lovely knit. Tom at the market stall recommended it.'),
      review('So warm… Priya, my neighbour, wants one now.'),
      // What copy QA refuses, a claim, a result, the body, spam, a code, a link.
      review('Arrived fast and free shipping too, love it.'),
      review('The best jumper I have ever owned, honestly.'),
      review('This cured my eczema in a week, amazing.'),
      review('My skin feels so much better in this wool.'),
      review('Act now, click here, it is amazing and so warm.'),
      review('Use code SAVE20 at checkout for 20% off.'),
      review('Read more at https://blog.example now.'),
      // A catalog title is no excuse: the email may not place it.
      review(scarf)
    ]
    expect(material([verified, ...left])).toBeUndefined()
  })

  it('keeps honest reviews whose sentences start with an ordinary word, “I” or a product’s name', () => {
    const honest = [
      'It is so soft and it washes well.',
      'Lovely, soft knit that keeps its shape.',
      'Ordered the green one. Colour looks just like the photos.',
      'Quality feels solid and it keeps me warm.',
      'I wear it every weekend. Weekend Knit fits well too.',
      'Arrived quickly. Sizing runs true and the sleeves are long.'
    ]
    for (const quote of honest)
      expect(material([verified, review(quote)])?.reviews, quote).toHaveLength(
        1
      )
  })

  it('reads only the store’s own website or its subdomains, never its parent or a sibling', () => {
    const store = { host: 'cedar.myshopify.com' }
    const at = (url: string) =>
      material([verified, review(warm, {}, on(url))], store)?.reviews ?? []
    expect(at('https://cedar.myshopify.com/p/1')).toHaveLength(1)
    expect(at('https://www.cedar.myshopify.com/p/1')).toHaveLength(1)
    expect(at('https://reviews.cedar.myshopify.com/p/1')).toHaveLength(1)
    expect(at('https://myshopify.com/p/1')).toEqual([])
    expect(at('https://other.myshopify.com/p/1')).toEqual([])
    expect(at('https://cedar.myshopify.com.evil.example/p/1')).toEqual([])
  })

  it('uses the sample rules’ findings only in a sample workspace', () => {
    const sample = [verified, review(warm, {}, { pass: 'sample' })]
    expect(material(sample, { live: false })?.reviews).toHaveLength(1)
    expect(material(sample)).toBeUndefined()
  })

  const cdn = 'https://cdn.shopify.com/s/files/1'
  const photo = (url: string, over: Record<string, unknown> = {}) => ({
    url,
    kind: 'lifestyle',
    alt: 'A walk in the hills at dusk',
    ...over
  })
  const withPhotos = (
    photos: ReturnType<typeof photo>[],
    over: Partial<MaterialParts> = {}
  ) =>
    storeMaterial(
      parts({ catalogImages: [`${cdn}/knit.jpg`], photos, ...over })
    )

  it('heads the email with the first lifestyle photo of the store’s own pages an email can show (REL-ONB2 part c)', () => {
    expect(
      withPhotos([
        // A catalog picture at another size, one an email cannot show, a
        // product's photo: none is a lifestyle photo for the hero.
        photo(`${cdn}/knit_800x.jpg`),
        photo(`${cdn}/hills.webp`),
        photo(`${cdn}/shelf.jpg`, { kind: 'product' }),
        photo(`${cdn}/hills.jpg`),
        photo(`${cdn}/beach.jpg`)
      ])
    ).toEqual({
      lifestylePhoto: {
        image: `${cdn}/hills.jpg`,
        alt: 'A walk in the hills at dusk'
      }
    })
    // Its own words only when they pass as the store's; else the brand's:
    // none, too long, a file's name, one word or a claim.
    for (const alt of [
      null,
      ' ',
      'Our organic wool, naturally',
      'x'.repeat(161),
      'IMG_2034',
      'banner_1_desktop',
      'woman-in-sweater.jpg',
      'Jordan'
    ])
      expect(
        withPhotos([photo(`${cdn}/hills.jpg`, { alt })])?.lifestylePhoto?.alt,
        String(alt)
      ).toBe('Cedar Lane')
    // A price, a discount or an offer in its words: it has them drawn in
    // (copy QA cannot read a picture), so it never heads the email.
    for (const alt of [
      'Only $25 this week',
      'Black Friday 50% off everything',
      'Get 20 percent off',
      'Our winter sale is on',
      'Free shipping on knits',
      'Use code WARM10'
    ])
      expect(
        withPhotos([photo(`${cdn}/hills.jpg`, { alt })]),
        alt
      ).toBeUndefined()
    // The next photo is taken instead.
    expect(
      withPhotos([
        photo(`${cdn}/sale.jpg`, { alt: 'Winter sale' }),
        photo(`${cdn}/hills.jpg`)
      ])?.lifestylePhoto?.image
    ).toBe(`${cdn}/hills.jpg`)
    // Never a social card (often a logo or words), never another website's
    // picture than the store's own hosts and its catalog's.
    expect(
      withPhotos([
        photo(`${cdn}/card.jpg`, { source: 'share' }),
        photo('https://images.pexels.com/photos/1/stock.jpeg'),
        photo('https://otherbrand.com/press/feature.jpg'),
        photo(`${cdn}/hills.jpg`, { source: 'page' })
      ])?.lifestylePhoto?.image
    ).toBe(`${cdn}/hills.jpg`)
    // The brand's name is used only when it passes as the store's words.
    expect(
      withPhotos([photo(`${cdn}/hills.jpg`, { alt: null })], {
        brandName: 'Save $5 Shop'
      })
    ).toBeUndefined()
    // A sample workspace never gets a live read's photo; none kept, none.
    expect(
      withPhotos([photo(`${cdn}/hills.jpg`)], { live: false })
    ).toBeUndefined()
    expect(withPhotos([])).toBeUndefined()
    expect(storeMaterial(parts())).toBeUndefined()
  })

  it('carries reviews and the photo together, and allows exactly their blocks', () => {
    const both = withPhotos([photo(`${cdn}/hills.jpg`)], {
      findings: [review(warm)]
    })
    expect(both?.reviews).toHaveLength(1)
    expect(both?.lifestylePhoto?.image).toBe(`${cdn}/hills.jpg`)
    const allowed = allowedBlockTypes({
      brief: { campaignType: 'story', goal: 'Our story' },
      products: [],
      codes: [],
      maxDiscountPercent: 0,
      sendAt: '2026-12-01T10:00:00Z',
      timezone: 'UTC',
      facts,
      confirmed: both
    })
    expect(allowed).toEqual(
      expect.arrayContaining(['review_strip', 'hero_image'])
    )
    expect(allowed).not.toContain('founder_note')
    expect(allowed).not.toContain('ugc_grid')
  })
})
