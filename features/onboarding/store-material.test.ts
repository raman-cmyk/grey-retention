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

describe('storeMaterial: the founder’s own note (REL-ONB2 part d2)', () => {
  const note = 'I’m Maya Lee. I started Cedar Lane in my spare room in 2016.'
  const founder = (
    quote = note,
    value: Over = {},
    over: Over = {},
    evidence: Over = {}
  ) =>
    ({
      topic: 'founder',
      source: 'site',
      statement: 'Maya Lee writes why she started the store.',
      value: { name: 'Maya Lee', role: 'Founder', ...value },
      evidence: {
        url: `${site}/pages/about`,
        quote,
        page: 'about',
        whole: true,
        ...evidence
      },
      confidence: 0.8,
      pass: 'model',
      createdAt: '2026-11-17T08:00:00.000Z',
      ...over
    }) as unknown as Finding
  const allowed = (confirmed: ReturnType<typeof storeMaterial>) =>
    allowedBlockTypes({
      brief: { campaignType: 'story', goal: 'Our story' },
      products: [],
      codes: [],
      maxDiscountPercent: 0,
      sendAt: '2026-12-01T10:00:00Z',
      timezone: 'UTC',
      facts,
      confirmed
    })

  it('signs the note with the founder’s name and role, word for word, and allows the founder note', () => {
    const found = material([founder()])
    expect(found).toEqual({
      founder: { name: 'Maya Lee', role: 'Founder', note: [note] }
    })
    expect(allowed(found)).toContain('founder_note')
    // A greeting is no name; the founder's own name words are theirs.
    expect(
      material([founder('Hi, I’m Maya. I knit every sample myself.')])?.founder
        ?.note
    ).toEqual(['Hi, I’m Maya. I knit every sample myself.'])
    // Thanking the reader names no one; the brand's name may hold theirs.
    for (const kept of [
      'Thank you for supporting my small business!',
      'I started Maya’s Knits in my spare room in 2016.'
    ])
      expect(
        material([founder(kept)], { brandName: 'Maya’s Knits' })?.founder?.note,
        kept
      ).toEqual([kept])
    expect(
      material([founder('Thanks Tom, I could not have done it alone.')])
    ).toBeUndefined()
    // Without a role on the page, none.
    expect(material([founder(note, { role: undefined })])?.founder).toEqual({
      name: 'Maya Lee',
      note: [note]
    })
  })

  it('takes the newest note that passes', () => {
    const older = founder(
      'I knit every sample myself.',
      {},
      { createdAt: '2026-11-01T08:00:00.000Z' }
    )
    expect(material([older, founder()])?.founder?.note).toEqual([note])
    // The newest says an offer: the next one is the founder's own too.
    const offer = founder(
      'I wanted everyone to save, so use code WARM10.',
      {},
      { createdAt: '2026-11-18T08:00:00.000Z' }
    )
    expect(material([offer, older])?.founder?.note).toEqual([
      'I knit every sample myself.'
    ])
  })

  it.each([
    ['not marked whole', founder(note, {}, {}, { whole: undefined })],
    ['from another page', founder(note, {}, {}, { page: 'home' })],
    [
      'from another website',
      founder(note, {}, {}, { url: 'https://other.example/pages/about' })
    ],
    ['less sure than a fact', founder(note, {}, { confidence: 0.5 })],
    [
      'the sample rules’ in a live workspace',
      founder(note, {}, { pass: 'sample' })
    ],
    ['from another reader', founder(note, {}, { source: 'reviews' })],
    ['a bio, not their note', founder('Maya founded Cedar Lane in 2016.')],
    ['an offer', founder('I made it so you can get 20% off this winter.')],
    ['free shipping', founder('I ship every order for free myself.')],
    ['a code', founder('I love a deal, so use code WARM10.')],
    ['a price', founder('I priced my first scarf at $45.')],
    ['a claim', founder('I make the softest knit in the world.')],
    ['a result on the body', founder('My wool cured my eczema.')],
    ['spam words', founder('I say act now, my friends.')],
    ['another person', founder('Tom, my neighbour, taught me to knit.')],
    ['another person after a greeting', founder('Hi Tom, I knit every day.')],
    ['a link', founder('I post my knits at cedarlane.com every day.')],
    ['a name with digits', founder(note, { name: 'Maya 2016' })],
    ['a name with @', founder(note, { name: '@maya' })],
    ['a link for a name', founder(note, { name: 'maya.example' })],
    ['two people', founder(note, { name: 'Maya and Sam' })],
    ['a team', founder(note, { name: 'The Cedar Lane team' })],
    ['the brand for a name', founder(note, { name: 'Cedar Lane' })],
    // A role or a common word for a name (REL-ONB2 part d review).
    ['“Founder” for a name', founder(note, { name: 'Founder' })],
    ['“Our story” for a name', founder(note, { name: 'Our story' })],
    ['“I” for a name', founder(note, { name: 'I' })],
    // The founder written about, or someone else quoted.
    ['the founder teaching', founder('Maya taught me to knit in 2018.')],
    [
      'the founder named by a third person',
      founder('Our founder, Maya, taught me everything I know about wool.')
    ],
    [
      'the founder and someone',
      founder('Maya and I started the shop in a tiny flat.')
    ],
    [
      'the founder quoted',
      founder('“I wanted something that lasted,” says Maya.')
    ],
    ['in her words', founder('In her words: “I make things that last.”')],
    [
      'a bio with her',
      founder(
        'Maya Lee began knitting at ten. Her grandmother gave her my old needles.'
      )
    ],
    [
      'a bio with they',
      founder('Maya Lee grew up in Leeds and they still call my shop home.')
    ]
  ])('leaves the note out: %s', (_why, finding) => {
    expect(material([finding])).toBeUndefined()
  })

  it('leaves out a role it could not show, never the note', () => {
    for (const role of [
      'Free spirit',
      'Founder, the best in town',
      'r'.repeat(61)
    ])
      expect(material([founder(note, { role })])?.founder).toEqual({
        name: 'Maya Lee',
        note: [note]
      })
  })

  it('never gives a sample workspace a founder', () => {
    expect(material([founder()], { live: false })).toBeUndefined()
    expect(
      material([founder(note, {}, { pass: 'sample' })], { live: false })
    ).toBeUndefined()
  })

  it('passes copy QA with the store’s facts as the block shows it', () => {
    const shown = material([founder()])!.founder!
    expect(
      checkCopy({
        draft: {
          subject: '',
          preview: '',
          blocks: [
            {
              id: 'founder',
              text: [...shown.note!, shown.name, shown.role].join('\n')
            }
          ]
        },
        facts,
        maxDiscountPercent: null,
        codes: [],
        productNames: [],
        sendAt: '2026-12-01T10:00:00.000Z'
      }).pass
    ).toBe(true)
  })
})

describe('storeMaterial: customers’ own photos (REL-ONB2 part e)', () => {
  const imgix = 'https://judgeme.imgix.net/cedar'
  const folder = 'https://cdn.shopify.com/s/files/1/0123/4567/8901/files'
  const shot = (url: string, value: Over = {}, over: Over = {}) =>
    ({
      topic: 'customer_photo',
      source: 'reviews',
      statement: 'A photo a customer posted with their review.',
      value: { url, page: `${site}/p/1`, product: 'Weekend Knit', ...value },
      evidence: { ref: `review-data:${site}/p/1` },
      confidence: 0.9,
      pass: 'code',
      ...over
    }) as unknown as Finding
  const three = [1, 2, 3].map((n) => shot(`${imgix}/${n}.jpg`))
  const photos = (findings: Finding[], over: Partial<MaterialParts> = {}) =>
    material(findings, { catalogImages: [`${folder}/knit.jpg`], ...over })
      ?.customerPhotos
  const grid = (findings: Finding[]) =>
    allowedBlockTypes({
      brief: { campaignType: 'launch', goal: 'New knit' },
      products: [],
      codes: [],
      maxDiscountPercent: 0,
      sendAt: '2026-12-01T10:00:00Z',
      timezone: 'UTC',
      facts,
      confirmed: material(findings, { catalogImages: [`${folder}/knit.jpg`] })
    }).includes('ugc_grid')

  it('gives the photo grid three or more, described in neutral words, never the reviewer’s', () => {
    expect(
      photos([
        three[0]!,
        shot(`${imgix}/2.jpg`, { product: ' weekend  KNIT ' }),
        shot(`${folder}/3.png`, { product: undefined }),
        shot(`${imgix}/4.jpg`, { product: 'Jordan’s favourite knit' })
      ])
    ).toEqual([
      { image: `${imgix}/1.jpg`, alt: "A customer's photo of Weekend Knit" },
      { image: `${imgix}/2.jpg`, alt: "A customer's photo of Weekend Knit" },
      { image: `${folder}/3.png`, alt: "A customer's photo" },
      { image: `${imgix}/4.jpg`, alt: "A customer's photo" }
    ])
    expect(grid(three)).toBe(true)
  })

  it('gives none with fewer than three, so the grid stays off', () => {
    expect(photos(three.slice(0, 2))).toBeUndefined()
    expect(grid(three.slice(0, 2))).toBe(false)
    // A catalog picture at another size, and the same photo twice, count once.
    const repeated = [
      three[0]!,
      shot(`${imgix}/1.jpg?width=400`),
      shot(`${folder}/knit_800x.jpg`)
    ]
    expect(photos(repeated)).toBeUndefined()
    expect(grid(repeated)).toBe(false)
    expect(photos([...repeated, three[1]!, three[2]!])).toHaveLength(3)
  })

  it('never takes a photo from a sample workspace, another website, a host off the list or a model', () => {
    expect(photos(three, { live: false })).toBeUndefined()
    expect(grid(three.map((f) => ({ ...f, pass: 'sample' })))).toBe(false)
    for (const [value, over] of [
      [{ page: 'https://other.example/p/1' }, {}],
      [{ url: 'https://images.example-cdn.com/1.jpg' }, {}],
      [{ url: 'https://loox.io/uploads/1.jpg' }, {}],
      [{ url: 'https://cdn.shopify.com/assets/1.jpg' }, {}],
      [{ url: `${imgix}/1.webp` }, {}],
      [{ url: 'http://judgeme.imgix.net/cedar/9.jpg' }, {}],
      [{}, { pass: 'sample' }],
      [{}, { pass: 'model' }],
      [{}, { confidence: 0.5 }],
      [{}, { source: 'site' }]
    ] as [Over, Over][])
      expect(
        photos([shot(`${imgix}/9.jpg`, value, over), three[0]!, three[1]!]),
        JSON.stringify([value, over])
      ).toBeUndefined()
  })

  it('names a product only as the catalog writes it, in words that pass as the store’s', () => {
    const alt = (product: string, productNames?: string[]) =>
      photos(
        three.map((f) => shot((f.value as { url: string }).url, { product })),
        productNames ? { productNames } : {}
      )?.[0]?.alt
    expect(alt('Weekend Knit')).toBe("A customer's photo of Weekend Knit")
    expect(alt('So soft, Jordan loves it')).toBe("A customer's photo")
    const long = `Knit ${'x'.repeat(150)}`
    expect(alt(long, [long])).toBe("A customer's photo")
  })

  it('keeps at most 12', () => {
    const many = Array.from({ length: 15 }, (_, n) =>
      shot(`${imgix}/${n + 1}.jpg`)
    )
    expect(photos(many)).toHaveLength(12)
  })

  it('counts one picture once at any imgix size, and never the hero, a Site reader photo or a catalog picture at the other Shopify address', () => {
    // One photo at three imgix sizes is one: no grid.
    expect(
      photos([
        shot(`${imgix}/1.jpg?w=200`),
        shot(`${imgix}/1.jpg?w=800`),
        shot(`${imgix}/1.jpg?w=1200&dpr=2`)
      ])
    ).toBeUndefined()
    const hero = `${folder}/hero-lifestyle.jpg`
    const both = material([...three, shot(hero), shot(`${folder}/4.jpg`)], {
      catalogImages: [
        `${folder}/knit.jpg`,
        // The same Shopify file as `${folder}/4.jpg`, on the store's address.
        `${site}/cdn/shop/files/4.jpg`
      ],
      photos: [{ url: `${hero}?width=1600`, kind: 'lifestyle', alt: null }]
    })
    expect(both?.lifestylePhoto?.image).toBe(`${hero}?width=1600`)
    expect(both?.customerPhotos?.map((p) => p.image)).toEqual(
      three.map((f) => (f.value as { url: string }).url)
    )
  })

  it('takes Shopify CDN photos only in the catalog’s own folder, and Judge.me photos of one folder', () => {
    expect(
      photos([
        three[0]!,
        three[1]!,
        shot('https://cdn.shopify.com/s/files/1/9999/9999/files/x.jpg')
      ])
    ).toBeUndefined()
    expect(
      photos([
        ...three,
        shot('https://judgeme.imgix.net/other-shop/1.jpg')
      ])?.map((p) => p.image)
    ).toEqual(three.map((f) => (f.value as { url: string }).url))
  })
})
