import { describe, expect, it } from 'vitest'
import type { BrandBookContent } from '@/features/onboarding/brand-book'
import type { Correction } from '@/features/onboarding/brand-book-corrections'
import { brandBookView, factWords } from './book-view'

const theirs = (text: string) => ({ text, own: false })

/** A Cedar Lane book as the readers and the strategist write it. */
const cedarBook: BrandBookContent = {
  schema: 2,
  sample: false,
  brand: {
    name: 'Cedar Lane',
    site: 'https://cedarlane.example',
    industry: 'apparel',
    timezone: 'America/New_York',
    currency: 'USD'
  },
  facts: {
    freeShipping: { over: 75 },
    deliveryDays: { min: 3, max: 5 },
    returnDays: 30,
    guaranteeDays: null,
    reviewsVerified: false
  },
  owner: {
    positioning: 'Quiet layers for long weekends.',
    voice: 'Calm and plain.',
    prohibitions: ''
  },
  unclear: [{ topic: 'guarantee', rule: 'Sources disagree.' }],
  observed: {
    offering: ['Outdoor layers made to last'],
    customers: {
      who: ['People who walk every weekend'],
      love: [],
      worries: ['Whether the size runs small']
    },
    voice: ['Short, warm sentences'],
    marketing: [],
    sending: {
      sendsPerWeek: 2,
      usualSendTime: '10:00',
      audiences: ['Newsletter']
    }
  },
  products: {
    count: 12,
    bestsellers: ['Field overshirt'],
    newArrivals: []
  },
  avoid: ['Medical claims are off limits for clothing.'],
  sources: ['site', 'klaviyo_history'],
  corrected: ['customers.worries'],
  strategy: {
    by: 'brand-strategist@1',
    basedOn: 'abc',
    positioning: 'Layers for people who are outside every weekend.',
    customers: ['Weekend walkers'],
    heroProducts: ['Field overshirt'],
    angles: ['Made to last'],
    care: ['Do not promise a fit'],
    voice: {
      tone: ['calm', 'warm'],
      use: ['made to last'],
      avoid: ['hype'],
      style: 'Short sentences, one idea each.'
    }
  }
}

const row = (content: unknown, written_by = 'brand-strategist@1') => ({
  version: 5,
  content,
  written_by,
  created_at: '2026-11-24T10:00:00Z'
})

describe('brandBookView', () => {
  it('is null without a book', () => {
    expect(brandBookView(null)).toBeNull()
  })

  it('keeps the confirmed parts, what was seen and the reading apart', () => {
    const view = brandBookView(row(cedarBook))!
    expect(view.version).toBe(5)
    expect(view.byStrategist).toBe(true)
    expect(view.brandName).toBe('Cedar Lane')
    expect(view.facts).toEqual([
      theirs('Free shipping over 75 USD'),
      theirs('Delivery in 3 to 5 days'),
      theirs('Returns within 30 days')
    ])
    // The words the owner edits in Correct facts.
    expect(view.factTexts).toEqual({
      freeShipping: 'over 75',
      returnDays: '30',
      guaranteeDays: '',
      deliveryDays: '3 to 5'
    })
    // The owner's approved words, without empty ones.
    expect(view.owner).toEqual([
      { label: 'Positioning', text: 'Quiet layers for long weekends.' },
      { label: 'How your emails sound', text: 'Calm and plain.' }
    ])
    expect(view.unclear).toEqual(['Money-back guarantee'])
    expect(view.seen).toEqual([
      {
        label: 'What you sell',
        section: 'offering',
        lines: [theirs('Outdoor layers made to last')]
      },
      {
        label: 'Who your customers are',
        section: 'customers.who',
        lines: [theirs('People who walk every weekend')]
      },
      {
        label: 'What customers worry about',
        section: 'customers.worries',
        lines: [theirs('Whether the size runs small')]
      },
      {
        label: 'How you sound',
        section: 'voice',
        lines: [theirs('Short, warm sentences')]
      }
    ])
    expect(view.corrections).toEqual([])
    expect(view.sending).toBe(
      'About 2 emails a week, usually at 10:00, to Newsletter'
    )
    expect(view.sources).toEqual(['Your website', 'Your past Klaviyo emails'])
    expect(view.corrected).toEqual(['What customers worry about'])
    expect(view.reading).toEqual({
      positioning: 'Layers for people who are outside every weekend.',
      parts: [
        { label: 'Who to write for', lines: ['Weekend walkers'] },
        { label: 'Products to lead with', lines: ['Field overshirt'] },
        { label: 'Reasons to buy to lead with', lines: ['Made to last'] },
        { label: 'What to be careful about', lines: ['Do not promise a fit'] }
      ],
      voice: [
        { label: 'Tone', lines: ['calm', 'warm'] },
        { label: 'Words to reuse', lines: ['made to last'] },
        { label: 'Words to avoid', lines: ['hype'] }
      ],
      style: 'Short sentences, one idea each.'
    })
    // The reading never becomes a fact or the owner's words.
    expect(view.facts.map((f) => f.text).join(' ')).not.toMatch(/weekend/i)
  })

  it('says the owner has not approved, and the strategist has not read', () => {
    const rest = { ...cedarBook, owner: null }
    delete rest.strategy
    const view = brandBookView(row(rest, 'brand-book@2'))!
    expect(view.owner).toBeNull()
    expect(view.reading).toBeNull()
    expect(view.byStrategist).toBe(false)
  })

  it('shows what a broken or old book has, inventing nothing', () => {
    const view = brandBookView(
      row(
        { facts: { returnDays: 'thirty', freeShipping: 'always' }, avoid: [3] },
        'brand-book@1'
      )
    )!
    expect(view.facts).toEqual([theirs('Free shipping on every order')])
    expect(view.owner).toBeNull()
    expect(view.seen).toEqual([])
    expect(view.sending).toBeNull()
    expect(view.avoid).toEqual([])
    expect(view.products).toEqual({
      count: null,
      bestsellers: [],
      newArrivals: []
    })
    expect(brandBookView(row('not a book'))!.facts).toEqual([])
  })
})

/** UI-BRAND-2: the owner's corrections in the book. */
describe('brandBookView with the owner’s corrections', () => {
  const correction = (
    c: Partial<Correction> & Pick<Correction, 'section' | 'action'>
  ): Correction => ({
    id: `c-${c.section}-${c.action}`,
    original: null,
    value: null,
    createdAt: '2026-11-24T09:00:00Z',
    ...c
  })
  // The book as written after his corrections (ONB-058b applied them).
  const corrected: BrandBookContent = {
    ...cedarBook,
    facts: { ...cedarBook.facts, returnDays: 14 },
    observed: {
      ...cedarBook.observed,
      voice: ['Calm and plain'],
      offering: ['Outdoor layers made to last', 'Linen shirts made in Porto']
    }
  }
  const corrections = [
    correction({
      section: 'voice',
      action: 'replace',
      original: 'Short, warm sentences',
      value: 'Calm   and PLAIN'
    }),
    correction({
      section: 'offering',
      action: 'add',
      value: 'Linen shirts made in Porto'
    }),
    correction({
      section: 'marketing',
      action: 'remove',
      original: 'Runs a summer sale'
    }),
    correction({ section: 'facts.returnDays', action: 'replace', value: '14' }),
    correction({
      section: 'facts.freeShipping',
      action: 'replace',
      value: 'always',
      // Made after this version: the book does not hold it yet.
      createdAt: '2026-11-24T11:00:00Z'
    }),
    correction({ section: 'facts.guaranteeDays', action: 'remove' })
  ]

  it('marks the lines and facts in his own words, case and spacing aside', () => {
    const view = brandBookView(row(corrected), corrections)!
    expect(view.seen.find((g) => g.section === 'voice')!.lines).toEqual([
      { text: 'Calm and plain', own: true }
    ])
    expect(view.seen.find((g) => g.section === 'offering')!.lines).toEqual([
      theirs('Outdoor layers made to last'),
      { text: 'Linen shirts made in Porto', own: true }
    ])
    expect(view.facts).toEqual([
      // His free shipping is not in this version yet: not marked.
      theirs('Free shipping over 75 USD'),
      theirs('Delivery in 3 to 5 days'),
      { text: 'Returns within 14 days', own: true }
    ])
  })

  it('lists his corrections in words, saying which this version does not hold yet', () => {
    const view = brandBookView(row(corrected), corrections)!
    expect(view.corrections).toEqual([
      {
        id: 'c-voice-replace',
        label: 'How you sound',
        text: 'Changed “Short, warm sentences” to “Calm   and PLAIN”',
        pending: false
      },
      {
        id: 'c-offering-add',
        label: 'What you sell',
        text: 'Added “Linen shirts made in Porto”',
        pending: false
      },
      {
        id: 'c-marketing-remove',
        label: 'What works in your marketing',
        text: 'Removed “Runs a summer sale”',
        pending: false
      },
      {
        id: 'c-facts.returnDays-replace',
        label: 'Returns',
        text: 'Returns within 14 days',
        pending: false
      },
      {
        id: 'c-facts.freeShipping-replace',
        label: 'Free shipping',
        text: 'Free shipping on every order',
        pending: true
      },
      {
        id: 'c-facts.guaranteeDays-remove',
        label: 'Money-back guarantee',
        text: 'Not known, so no email claims it',
        pending: false
      }
    ])
  })

  it('names the sections he corrected in words', () => {
    const view = brandBookView(
      row({ ...corrected, corrected: ['facts.returnDays', 'voice'] })
    )!
    expect(view.corrected).toEqual(['Returns', 'How you sound'])
  })

  it('shows every part to the owner, empty ones too, so he can add a line', () => {
    const view = brandBookView(row(cedarBook), [], { allParts: true })!
    expect(view.seen.map((g) => [g.section, g.lines.length])).toEqual([
      ['offering', 1],
      ['customers.who', 1],
      ['customers.love', 0],
      ['customers.worries', 1],
      ['voice', 1],
      ['marketing', 0]
    ])
    // Staff see only the parts with lines.
    expect(brandBookView(row(cedarBook))!.seen).toHaveLength(4)
  })
})

describe('factWords', () => {
  it('says none plainly and leaves unknown facts out', () => {
    expect(
      factWords(
        {
          freeShipping: 'never',
          deliveryDays: { min: 2, max: 2 },
          returnDays: 0,
          guaranteeDays: 0,
          reviewsVerified: true
        },
        null
      )
    ).toEqual([
      'No free shipping',
      'Delivery in 2 days',
      'No returns',
      'No money-back guarantee',
      'Reviews come from a checked review source'
    ])
    expect(factWords({ freeShipping: null, returnDays: null }, 'USD')).toEqual(
      []
    )
  })
})
