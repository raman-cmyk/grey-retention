// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { SitePageKind } from '../findings'
import {
  aboutPage,
  firstPerson,
  introduced,
  onPage,
  personName,
  roleOf,
  wholeSentences
} from './founder'
import { readPage } from './pages'
import { checkedFindings, siteReader } from './reader'

const aboutHtml =
  '<h1>Our story</h1>' +
  '<p>Hi, I’m Maya Lee, founder of Cedar Lane. I started it in my spare room in 2016.</p>' +
  '<p>Every knit is made to last. Dr. Ames taught me to knit, e.g. the fisherman’s rib.</p>' +
  '<blockquote>“I still test every sample myself.” – Maya</blockquote>' +
  '<p>“I test every yarn myself.” It keeps me honest.</p>' +
  '<p>Maya founded the brand in 2016. She knits every day.</p>' +
  '<p>I started with one ball of wool… and a dream my mum laughed at.</p>' +
  '<p>I open the studio at 9 a.m. every day.</p>' +
  '<p>“I knit every day. I love it,” says Maya Lee.</p>' +
  '<p>Tom, our designer</p><p>I sketch every pattern by hand.</p>' +
  '<p>Maya here. Tom is our designer. I draw every pattern by hand.</p>' +
  '<p>Our team of five ships from Leeds.</p>'
const aboutUrl = 'https://cedar-lane.example/pages/about'
const about = (kind: SitePageKind = 'about', url = aboutUrl) =>
  readPage(`<main>${aboutHtml}</main>`, url, kind)
const text = about().text
const note = (quote: string) => wholeSentences(text, quote)?.note ?? null

describe('wholeSentences', () => {
  it('gives whole sentences in the page’s own letters, whatever the model’s capitals or quote marks', () => {
    expect(note("hi, i'm maya lee, founder of cedar lane.")).toBe(
      'Hi, I’m Maya Lee, founder of Cedar Lane.'
    )
    expect(
      note(
        "Hi, I'm Maya Lee, founder of Cedar Lane.  I started it in my spare room in 2016."
      )
    ).toBe(
      'Hi, I’m Maya Lee, founder of Cedar Lane. I started it in my spare room in 2016.'
    )
    // A sentence after another starts where that one stopped, and says
    // what comes before it in its block.
    expect(
      wholeSentences(text, 'I started it in my spare room in 2016.')
    ).toMatchObject({
      note: 'I started it in my spare room in 2016.',
      before: 'Hi, I’m Maya Lee, founder of Cedar Lane. ',
      after: ''
    })
    // The page's own marks around a quoted sentence belong to it; a dash
    // credit after it is not stored.
    expect(note('I test every yarn myself.')).toBe(
      '“I test every yarn myself.”'
    )
    expect(
      wholeSentences(text, 'I still test every sample myself.')
    ).toMatchObject({
      note: '“I still test every sample myself.”',
      after: ' – Maya'
    })
  })

  it('refuses a part-sentence: a cut start or end, a run-on heading, an abbreviation’s stop, half a quote', () => {
    for (const quote of [
      'I started it in my spare room',
      'started it in my spare room in 2016.',
      'founder of Cedar Lane. I started it in my spare room in 2016.',
      'Our story Hi, I’m Maya Lee, founder of Cedar Lane.',
      'Every knit is made to last. Dr.',
      'Ames taught me to knit, e.g.',
      'the fisherman’s rib.',
      'I started it in my spare room in 2016',
      'I started it in my attic in 2016.',
      // After its stop comes more of the sentence, not the next one.
      'I started with one ball of wool…',
      'I open the studio at 9 a.m.',
      // Half of a quote, its marks unbalanced.
      'I knit every day.',
      ''
    ])
      expect(note(quote), quote).toBeNull()
  })
})

describe('firstPerson', () => {
  it('takes a note in the first person singular, the founder named only where they introduce themself', () => {
    for (const quote of [
      'I started it in my spare room in 2016.',
      'Hi, I’m Maya Lee, founder of Cedar Lane.',
      'Dr. Ames taught me to knit.',
      'This shop is mine.',
      'Maya here, and I knit every sample.',
      'My name is Maya and I knit.'
    ])
      expect(firstPerson(quote, 'Maya Lee'), quote).toBe(true)
    // The brand's own name may hold theirs.
    expect(
      firstPerson('I started Maya’s Knits in 2016.', 'Maya Lee', [
        'Maya’s Knits'
      ])
    ).toBe(true)
    expect(firstPerson('I started Maya’s Knits in 2016.', 'Maya Lee')).toBe(
      false
    )
  })

  it('refuses a sentence about the founder or someone else, or with no one writing it', () => {
    for (const quote of [
      'Maya founded the brand in 2016.',
      'Every knit is made to last.',
      'We started in a small workshop.',
      'She knits every day, and I love it.',
      'Maya is the founder, and I love her work.',
      'Maya’s mother taught me to knit.',
      'MY SHOP.',
      'Maya taught me to knit in 2018.',
      'Our founder, Maya, taught me everything I know about wool.',
      'Maya and I started the shop in a tiny flat.',
      '“I wanted something that lasted,” says Maya.',
      'In her words: “I make things that last.”',
      'Maya Lee began knitting at ten. Her grandmother gave her my old needles.',
      'Maya Lee grew up in Leeds and they still call my shop home.',
      'He wrote to me: “I love my scarf.”'
    ])
      expect(firstPerson(quote, 'Maya Lee'), quote).toBe(false)
  })
})

describe('introduced', () => {
  const spot = (quote: string) => wholeSentences(text, quote)!
  const own = ['Cedar Lane']
  /** Whether a page's note is tied to Maya Lee, the store Cedar Lane. */
  const tied = (html: string, quote: string) => {
    const at = wholeSentences(
      readPage(`<main>${html}</main>`, aboutUrl, 'about').text,
      quote
    )
    return !!at && introduced(at, 'Maya Lee', own)
  }
  const started = 'I started Cedar Lane in my spare room in 2016.'

  it('ties the note to the founder by their own introduction: in it, or just before it in its block', () => {
    expect(
      introduced(
        spot('Hi, I’m Maya Lee, founder of Cedar Lane.'),
        'Maya Lee',
        own
      )
    ).toBe(true)
    expect(
      introduced(
        spot('I started it in my spare room in 2016.'),
        'Maya Lee',
        own
      )
    ).toBe(true)
  })

  it('ties it by an introduction in the block right before it, and never across another block, name or quote', () => {
    expect(tied(`<h2>Hi, I’m Maya!</h2><p>${started}</p>`, started)).toBe(true)
    expect(
      tied(
        `<p>Hi, I’m Maya Lee, founder of Cedar Lane.</p><p>${started}</p>`,
        started
      )
    ).toBe(true)
    for (const html of [
      // Another block between them.
      `<h2>Hi, I’m Maya!</h2><p>Every knit is made to last.</p><p>${started}</p>`,
      // Another name, or a quote, after the introduction.
      `<h2>Hi, I’m Maya! Tom is our designer.</h2><p>${started}</p>`,
      `<h2>Hi, I’m Maya, and Tom says hello!</h2><p>${started}</p>`,
      // The note not at the start of its block.
      `<h2>Hi, I’m Maya!</h2><p>Every knit is made to last. ${started}</p>`
    ])
      expect(tied(html, started), html).toBe(false)
  })

  it('ties it by a sign-off of their name in the block right after it', () => {
    for (const signoff of [
      '— Maya',
      '– Maya Lee',
      'Maya',
      'Love, Maya',
      'With love, Maya',
      'Thanks, Maya',
      'xx Maya',
      'Maya Lee, founder of Cedar Lane'
    ])
      expect(tied(`<p>${started}</p><p>${signoff}</p>`, started), signoff).toBe(
        true
      )
    for (const signoff of [
      '— Anna',
      'Love, Anna',
      'Anna',
      'xx Anna Ruiz',
      '— the team'
    ])
      expect(tied(`<p>${started}</p><p>${signoff}</p>`, started), signoff).toBe(
        false
      )
    // Only a note that ends its block: the rest of the block is no one's.
    expect(tied(`<p>${started} It was small.</p><p>— Maya</p>`, started)).toBe(
      false
    )
  })

  it('ties a quoted note by a dash and their name at its own end, never anyone else’s', () => {
    const quoted = (credit: string) =>
      tied(
        `<blockquote>“I test every sample myself.” ${credit}</blockquote>`,
        'I test every sample myself.'
      )
    expect(quoted('– Maya')).toBe(true)
    expect(quoted('— Maya Lee, founder')).toBe(true)
    for (const credit of [
      '– Anna',
      '– Anna, a customer',
      '– Maya and Tom',
      '- Tom'
    ])
      expect(quoted(credit), credit).toBe(false)
  })

  it('refuses a note no introduction of theirs gives them, or that someone else is named before or after', () => {
    // Another block's words: a team member's line under their name.
    expect(
      introduced(spot('I sketch every pattern by hand.'), 'Maya Lee', own)
    ).toBe(false)
    // Another sentence, about someone else, between the introduction and the note.
    expect(
      introduced(spot('I draw every pattern by hand.'), 'Maya Lee', own)
    ).toBe(false)
    // The store's name unknown: its words read as someone else's.
    expect(
      introduced(spot('I started it in my spare room in 2016.'), 'Maya Lee')
    ).toBe(false)
    // Given to someone else after it.
    for (const after of [' – Anna, a customer', ', says Tom.'])
      expect(
        introduced(
          { note: 'I’m Maya. I love wool.', at: 0, before: '', after },
          'Maya Lee'
        ),
        after
      ).toBe(false)
  })
})

describe('personName', () => {
  it('takes one person’s name, every word a capital and two letters or more', () => {
    for (const name of ['Maya Lee', 'Dr. Ana Ruiz', 'Mary-Jane O’Neil', 'Zoë'])
      expect(personName(name), name).toBe(true)
    for (const name of [
      'Founder',
      'Our story',
      'I',
      'Hi',
      'maya lee',
      'Maya J. Lee',
      'Maya 2',
      'The Cedar Lane team',
      'Dr.',
      'Ana Ruiz Dr.',
      'Maya Lee Ruiz Ames Smith',
      ''
    ])
      expect(personName(name), name).toBe(false)
  })
})

describe('aboutPage', () => {
  it('takes the About page by its address, never the reviews or a customer’s story', () => {
    for (const path of [
      '/pages/about',
      '/about-us',
      '/pages/our-story',
      '/en-gb/pages/about/'
    ])
      expect(aboutPage(`https://cedar-lane.example${path}`), path).toBe(true)
    for (const path of [
      '/pages/reviews',
      '/pages/testimonials',
      '/blogs/news/customer-story',
      '/pages/about/press',
      '/'
    ])
      expect(aboutPage(`https://cedar-lane.example${path}`), path).toBe(false)
    expect(aboutPage('not a url')).toBe(false)
  })
})

describe('roleOf and onPage', () => {
  it('keeps a role only from a block that names the founder, at most 60 characters', () => {
    expect(roleOf(text, 'Maya Lee', 'founder')).toBe('founder')
    expect(roleOf(text, 'Maya Lee', 'designer')).toBeUndefined()
    expect(roleOf(text, 'Maya Lee', 'CEO')).toBeUndefined()
    expect(roleOf(text, 'Maya Lee', undefined)).toBeUndefined()
    const long = `founder ${'and maker '.repeat(6)}`.trim()
    const page = `Hi, I’m Maya Lee, ${long}.`
    expect(roleOf(page, 'Maya Lee', long)).toBeUndefined()
  })

  it('finds a name word for word: case, whole words and all', () => {
    expect(onPage(text, 'Maya Lee')).toBe(true)
    expect(onPage(text, 'maya lee')).toBe(false)
    expect(onPage(text, 'Maya Leeds')).toBe(false)
    expect(onPage(text, 'Lee, founder')).toBe(true)
    expect(onPage(text, 'Jane Smith')).toBe(false)
    expect(onPage(text, ' ')).toBe(false)
  })
})

describe('checkedFindings: the founder', () => {
  const raw = (over: Record<string, unknown> = {}) => ({
    topic: 'founder' as const,
    statement: 'Maya Lee founded Cedar Lane and writes why.',
    quote: 'I started it in my spare room in 2016.',
    confidence: 0.8,
    name: 'Maya Lee',
    role: 'founder',
    ...over
  })
  const check = (
    page: ReturnType<typeof about>,
    raws: ReturnType<typeof raw>[],
    brand = 'Cedar Lane'
  ) => checkedFindings(page, raws, brand)

  it('keeps a note of whole sentences of the About page, marked whole, in the page’s own letters', () => {
    expect(
      check(about(), [
        raw({
          quote:
            "Hi, i'm Maya Lee, founder of Cedar Lane. I started it in my spare room in 2016."
        })
      ])
    ).toEqual({
      kept: [
        {
          topic: 'founder',
          statement: 'Maya Lee founded Cedar Lane and writes why.',
          value: { name: 'Maya Lee', role: 'founder' },
          evidence: {
            url: aboutUrl,
            quote:
              'Hi, I’m Maya Lee, founder of Cedar Lane. I started it in my spare room in 2016.',
            page: 'about',
            whole: true
          },
          confidence: 0.8
        }
      ],
      dropped: 0
    })
  })

  it('keeps one note a page, the first on it, and leaves out a role it cannot keep', () => {
    const { kept, dropped } = check(about(), [
      raw(),
      raw({ quote: "Hi, I'm Maya Lee, founder of Cedar Lane." })
    ])
    expect(kept.map((f) => 'quote' in f.evidence && f.evidence.quote)).toEqual([
      'Hi, I’m Maya Lee, founder of Cedar Lane.'
    ])
    expect(dropped).toBe(1)
    for (const role of ['CEO', 'designer', 'f'.repeat(61)])
      expect(
        check(about(), [raw({ role })]).kept.map((f) => f.value),
        role
      ).toEqual([{ name: 'Maya Lee' }])
  })

  it('drops a part-sentence, someone else’s words, a name that is no one’s or not on the page, another page and a note too long or short', () => {
    const long = readPage(
      `<main><p>Maya Lee here. ${'I knit wool and I love it. '.repeat(12)}</p></main>`,
      aboutUrl,
      'about'
    )
    const cases: [
      ReturnType<typeof about>,
      ReturnType<typeof raw>,
      string,
      string?
    ][] = [
      [about(), raw({ quote: 'I started it in my spare room' }), 'a fragment'],
      [
        about(),
        raw({ quote: 'started it in my spare room in 2016.' }),
        'a cut start'
      ],
      [
        about(),
        raw({ quote: 'Maya founded the brand in 2016.' }),
        'a third-person bio'
      ],
      [
        about(),
        raw({ quote: 'Every knit is made to last.' }),
        'no one writing'
      ],
      [
        about(),
        raw({ quote: 'I sketch every pattern by hand.' }),
        'a team member’s line'
      ],
      [
        about(),
        raw({ quote: 'I draw every pattern by hand.' }),
        'after someone else'
      ],
      [about(), raw(), 'the store’s name unknown', ''],
      [about(), raw({ name: 'Jane Smith' }), 'a name not on the page'],
      [about(), raw({ name: 'maya lee' }), 'the model’s capitals for the name'],
      [about(), raw({ name: 'Founder' }), 'a role for a name'],
      [about(), raw({ name: '' }), 'no name'],
      [about('home'), raw(), 'the home page'],
      [about('product'), raw(), 'a product page'],
      [
        about('about', 'https://cedar-lane.example/pages/reviews'),
        raw(),
        'the reviews read as About'
      ],
      [
        long,
        raw({ quote: 'I knit wool and I love it. '.repeat(12) }),
        'over 300 characters'
      ],
      [
        readPage('<p>Maya Lee here. I knit.</p>', aboutUrl, 'about'),
        raw({ quote: 'I knit.' }),
        'under a full few words'
      ]
    ]
    for (const [page, finding, why, brand] of cases)
      expect(check(page, [finding], brand).kept, why).toEqual([])
  })

  it('keeps a quoted note signed by a dash and their name, without the credit', () => {
    const { kept } = check(about(), [
      raw({ quote: 'I still test every sample myself.' })
    ])
    expect(kept.map((f) => 'quote' in f.evidence && f.evidence.quote)).toEqual([
      '“I still test every sample myself.”'
    ])
    const anna = readPage(
      '<main><blockquote>“I still test every sample myself.” – Anna</blockquote><p>Maya Lee</p></main>',
      aboutUrl,
      'about'
    )
    expect(
      check(anna, [raw({ quote: 'I still test every sample myself.' })]).kept
    ).toEqual([])
  })

  it('keeps every other topic as before, never marked whole', () => {
    const { kept } = check(about(), [
      {
        topic: 'offering',
        statement: 'Knitwear.',
        quote: 'every knit is made to last.',
        confidence: 0.8
      } as unknown as ReturnType<typeof raw>
    ])
    expect(kept.map((f) => f.evidence)).toEqual([
      { url: aboutUrl, quote: 'every knit is made to last.', page: 'about' }
    ])
  })

  it('asks the model for the founder’s own note on the About page only', () => {
    expect(siteReader.instructions).toMatch(/founder: on the About page only/)
    expect(JSON.stringify(siteReader.schema.definition)).toContain(
      '"name":{"type":"string"},"role":{"type":"string"}'
    )
  })
})
