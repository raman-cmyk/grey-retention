// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { SitePageKind } from '../findings'
import { firstPerson, onPage, wholeSentences } from './founder'
import { readPage } from './pages'
import { checkedFindings, siteReader } from './reader'

const aboutHtml =
  '<h1>Our story</h1>' +
  '<p>Hi, I’m Maya Lee, founder of Cedar Lane. I started it in my spare room in 2016.</p>' +
  '<p>Every knit is made to last. Dr. Ames taught me to knit, e.g. the fisherman’s rib.</p>' +
  '<blockquote>“I still test every sample myself.” – Maya</blockquote>' +
  '<p>Maya founded the brand in 2016. She knits every day.</p>' +
  '<p>Our team of five ships from Leeds.</p>'
const about = (kind: SitePageKind = 'about') =>
  readPage(
    `<main>${aboutHtml}</main>`,
    'https://cedar-lane.example/pages/about',
    kind
  )

describe('wholeSentences', () => {
  const text = about().text

  it('gives whole sentences in the page’s own letters, whatever the model’s capitals or quote marks', () => {
    expect(
      wholeSentences(text, "hi, i'm maya lee, founder of cedar lane.")
    ).toBe('Hi, I’m Maya Lee, founder of Cedar Lane.')
    expect(
      wholeSentences(
        text,
        "Hi, I'm Maya Lee, founder of Cedar Lane.  I started it in my spare room in 2016."
      )
    ).toBe(
      'Hi, I’m Maya Lee, founder of Cedar Lane. I started it in my spare room in 2016.'
    )
    // A sentence after another starts where that one stopped.
    expect(wholeSentences(text, 'I started it in my spare room in 2016.')).toBe(
      'I started it in my spare room in 2016.'
    )
    // The page's own marks around a quoted sentence belong to it.
    expect(wholeSentences(text, 'I still test every sample myself.')).toBe(
      '“I still test every sample myself.”'
    )
  })

  it('refuses a fragment: a cut start, a cut end, a run-on heading or an abbreviation’s stop', () => {
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
      ''
    ])
      expect(wholeSentences(text, quote), quote).toBeNull()
  })
})

describe('firstPerson', () => {
  it('takes a note in the first person singular', () => {
    for (const quote of [
      'I started it in my spare room in 2016.',
      'Hi, I’m Maya Lee, founder of Cedar Lane.',
      'Dr. Ames taught me to knit.',
      'This shop is mine.'
    ])
      expect(firstPerson(quote, 'Maya Lee'), quote).toBe(true)
  })

  it('refuses a sentence about the founder, or with no one writing it', () => {
    for (const quote of [
      'Maya founded the brand in 2016.',
      'Every knit is made to last.',
      'We started in a small workshop.',
      'She knits every day, and I love it.',
      'Maya is the founder, and I love her work.',
      'Maya’s mother taught me to knit.',
      'MY SHOP.'
    ])
      expect(firstPerson(quote, 'Maya Lee'), quote).toBe(false)
  })
})

describe('onPage', () => {
  it('finds a name word for word: case, whole words and all', () => {
    const text = about().text
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

  it('keeps a note of whole sentences of the About page, marked whole, in the page’s own letters', () => {
    expect(
      checkedFindings(about(), [
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
            url: 'https://cedar-lane.example/pages/about',
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

  it('leaves out a role the page does not write', () => {
    expect(
      checkedFindings(about(), [raw({ role: 'CEO' })]).kept.map((f) => f.value)
    ).toEqual([{ name: 'Maya Lee' }])
  })

  it('drops a fragment, a third-person bio, a name not on the page, another page and a note too long or short', () => {
    const long = readPage(
      `<main><p>Maya Lee here.</p><p>${'I knit wool and I love it. '.repeat(12)}</p></main>`,
      'https://cedar-lane.example/pages/about',
      'about'
    )
    for (const [page, finding, why] of [
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
        raw({ quote: 'Maya founded the brand in 2016. She knits every day.' }),
        'with she'
      ],
      [
        about(),
        raw({ quote: 'Every knit is made to last.' }),
        'no one writing'
      ],
      [about(), raw({ name: 'Jane Smith' }), 'a name not on the page'],
      [about(), raw({ name: 'maya lee' }), 'the model’s capitals for the name'],
      [about(), raw({ name: '' }), 'no name'],
      [about('home'), raw(), 'the home page'],
      [about('product'), raw(), 'a product page'],
      [
        long,
        raw({ quote: 'I knit wool and I love it. '.repeat(12) }),
        'over 300 characters'
      ],
      [
        readPage(
          '<p>Maya Lee</p><p>I knit.</p>',
          'https://cedar-lane.example/pages/about',
          'about'
        ),
        raw({ quote: 'I knit.' }),
        'under a full few words'
      ]
    ] as const)
      expect(checkedFindings(page, [finding]).kept, why).toEqual([])
  })

  it('keeps every other topic as before, never marked whole', () => {
    const { kept } = checkedFindings(about(), [
      {
        topic: 'offering',
        statement: 'Knitwear.',
        quote: 'every knit is made to last.',
        confidence: 0.8
      }
    ])
    expect(kept.map((f) => f.evidence)).toEqual([
      {
        url: 'https://cedar-lane.example/pages/about',
        quote: 'every knit is made to last.',
        page: 'about'
      }
    ])
  })

  it('asks the model for the founder’s own note on the About page only', () => {
    expect(siteReader.instructions).toMatch(/founder: on the About page only/)
    expect(JSON.stringify(siteReader.schema.definition)).toContain(
      '"name":{"type":"string"},"role":{"type":"string"}'
    )
  })
})
