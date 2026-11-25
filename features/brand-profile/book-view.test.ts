import { describe, expect, it } from 'vitest'
import type { BrandBookContent } from '@/features/onboarding/brand-book'
import { brandBookView, factWords } from './book-view'

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
      'Free shipping over 75 USD',
      'Delivery in 3 to 5 days',
      'Returns within 30 days'
    ])
    // The owner's approved words, without empty ones.
    expect(view.owner).toEqual([
      { label: 'Positioning', text: 'Quiet layers for long weekends.' },
      { label: 'How your emails sound', text: 'Calm and plain.' }
    ])
    expect(view.unclear).toEqual(['Money-back guarantee'])
    expect(view.seen).toEqual([
      { label: 'What you sell', lines: ['Outdoor layers made to last'] },
      {
        label: 'Who your customers are',
        lines: ['People who walk every weekend']
      },
      {
        label: 'What customers worry about',
        lines: ['Whether the size runs small']
      },
      { label: 'How you sound', lines: ['Short, warm sentences'] }
    ])
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
    expect(view.facts.join(' ')).not.toMatch(/weekend/i)
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
    expect(view.facts).toEqual(['Free shipping on every order'])
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
