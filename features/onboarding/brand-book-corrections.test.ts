import { describe, expect, it, vi } from 'vitest'
import type { BrandFacts } from '@/features/copy-qa/check'
import {
  applyCorrections,
  correctBrandBook,
  correctedFacts,
  factValue,
  listCorrections,
  withdrawCorrection,
  type Correction
} from './brand-book-corrections'

const tenantId = '00000000-0000-4000-8000-000000000101'
let n = 0
const c = (over: Partial<Correction>): Correction => ({
  id: `c${++n}`,
  section: 'voice',
  original: null,
  action: 'add',
  value: null,
  createdAt: '2026-11-15T10:00:00Z',
  ...over
})
const book = () => ({
  schema: 1,
  facts: {
    freeShipping: null,
    deliveryDays: null,
    returnDays: 14,
    guaranteeDays: null,
    reviewsVerified: false
  } as Partial<BrandFacts>,
  unclear: [
    { topic: 'returns', said: ['30-day returns.', '14-day returns.'] },
    { topic: 'delivery_days', said: ['2-5 days.', '3-7 days.'] }
  ],
  offering: ['Linen clothing.'],
  customers: { who: ['Women who travel.'], love: [], worries: [] },
  voice: ['Loud and bold.', 'Plain.'],
  marketing: ['Runs a summer sale.'],
  sources: ['site']
})

describe('applyCorrections (ONB-058)', () => {
  it('removes, replaces and adds lines by their words', () => {
    const out = applyCorrections(book(), [
      c({
        section: 'voice',
        original: 'loud and bold.',
        action: 'replace',
        value: 'Calm and warm.'
      }),
      c({
        section: 'marketing',
        original: 'Runs a summer sale.',
        action: 'remove'
      }),
      c({ section: 'offering', action: 'add', value: 'Made in Portugal.' }),
      c({ section: 'customers.love', action: 'add', value: 'The soft fabric.' })
    ])
    expect(out.voice).toEqual(['Calm and warm.', 'Plain.'])
    expect(out.marketing).toEqual([])
    expect(out.offering).toEqual(['Linen clothing.', 'Made in Portugal.'])
    expect(out.customers.love).toEqual(['The soft fabric.'])
    expect(out.corrected).toEqual([
      'customers.love',
      'marketing',
      'offering',
      'voice'
    ])
    // Everything else is kept, and the book itself is not changed.
    expect(out.sources).toEqual(['site'])
    expect(book().voice).toEqual(['Loud and bold.', 'Plain.'])
  })

  it('leaves a correction alone when its line is gone, and adds a line once', () => {
    const out = applyCorrections(book(), [
      c({
        section: 'voice',
        original: 'A line no longer there.',
        action: 'remove'
      }),
      c({ section: 'offering', action: 'add', value: 'linen clothing.' })
    ])
    expect(out.voice).toEqual(['Loud and bold.', 'Plain.'])
    expect(out.offering).toEqual(['Linen clothing.'])
    expect(out.corrected).toEqual(['offering'])
  })

  it('makes the owner’s facts the confirmed ones, no longer unclear', () => {
    const out = applyCorrections(book(), [
      c({ section: 'facts.returnDays', action: 'replace', value: '30' }),
      c({ section: 'facts.freeShipping', action: 'replace', value: 'over 75' }),
      c({ section: 'facts.deliveryDays', action: 'replace', value: '3-7' }),
      c({ section: 'facts.guaranteeDays', action: 'remove' })
    ])
    expect(out.facts).toMatchObject({
      returnDays: 30,
      freeShipping: { over: 75 },
      deliveryDays: { min: 3, max: 7 },
      guaranteeDays: null
    })
    expect(out.unclear).toEqual([])
  })

  it('ignores a fact whose words do not fit', () => {
    const out = applyCorrections(book(), [
      c({ section: 'facts.returnDays', action: 'replace', value: 'two weeks' })
    ])
    expect(out.facts.returnDays).toBe(14)
    expect(out.unclear).toHaveLength(2)
    expect(out.corrected).toEqual([])
  })
})

describe('factValue and correctedFacts (ONB-058)', () => {
  it('reads the owner’s facts as copy QA holds them', () => {
    expect(factValue('freeShipping', 'always')).toBe('always')
    expect(factValue('freeShipping', 'Never')).toBe('never')
    expect(factValue('freeShipping', 'over 75.50')).toEqual({ over: 75.5 })
    expect(factValue('freeShipping', 'over $75')).toBeUndefined()
    expect(factValue('returnDays', '0')).toBe(0)
    expect(factValue('returnDays', '4000')).toBeUndefined()
    expect(factValue('deliveryDays', '7-3')).toBeUndefined()
    expect(factValue('deliveryDays', '3-120')).toBeUndefined()
    expect(factValue('guaranteeDays', null)).toBeNull()
  })

  it('puts the owner’s facts on top of copy QA’s', () => {
    const facts: BrandFacts = {
      freeShipping: null,
      deliveryDays: { min: 2, max: 5 },
      returnDays: null,
      guaranteeDays: 30,
      approvedClaims: ['100% linen'],
      bannedPhrases: ['cheap'],
      reviewsVerified: true
    }
    expect(
      correctedFacts(facts, [
        c({
          section: 'facts.freeShipping',
          action: 'replace',
          value: 'always'
        }),
        c({ section: 'facts.guaranteeDays', action: 'remove' }),
        c({ section: 'voice', action: 'add', value: 'Plain.' })
      ])
    ).toEqual({
      ...facts,
      freeShipping: 'always',
      guaranteeDays: null
    })
  })
})

describe('the commands and the read (ONB-058)', () => {
  it('reads only this workspace’s live corrections', async () => {
    const calls: [string, ...unknown[]][] = []
    const chain = {
      select: () => chain,
      eq: (...a: unknown[]) => (calls.push(['eq', ...a]), chain),
      is: (...a: unknown[]) => (calls.push(['is', ...a]), chain),
      order: () => chain,
      limit: async () => ({
        data: [
          {
            id: 'c1',
            section: 'voice',
            original: 'Loud.',
            action: 'replace',
            value: 'Calm.',
            created_at: '2026-11-15T10:00:00Z'
          },
          {
            id: 'c2',
            section: 'unknown',
            original: null,
            action: 'add',
            value: 'x',
            created_at: '2026-11-15T10:00:00Z'
          }
        ],
        error: null
      })
    }
    const db = { from: () => chain } as never
    expect(await listCorrections(db, tenantId)).toEqual([
      {
        id: 'c1',
        section: 'voice',
        original: 'Loud.',
        action: 'replace',
        value: 'Calm.',
        createdAt: '2026-11-15T10:00:00Z'
      }
    ])
    expect(calls).toEqual([
      ['eq', 'tenant_id', tenantId],
      ['is', 'withdrawn_at', null]
    ])
  })

  it('calls the commands, and throws what they refuse', async () => {
    const rpc = vi.fn(async () => ({ data: 'c9', error: null }))
    const db = { rpc } as never
    expect(
      await correctBrandBook(db, tenantId, {
        section: 'facts.returnDays',
        original: null,
        action: 'replace',
        value: '30'
      })
    ).toBe('c9')
    expect(rpc).toHaveBeenCalledWith('correct_brand_book', {
      t: tenantId,
      book_section: 'facts.returnDays',
      book_original: '',
      book_action: 'replace',
      book_value: '30'
    })
    await withdrawCorrection(db, tenantId, 'c9')
    expect(rpc).toHaveBeenLastCalledWith('withdraw_brand_book_correction', {
      t: tenantId,
      correction: 'c9'
    })
    const refused = {
      rpc: async () => ({ data: null, error: { code: '42501' } })
    } as never
    await expect(
      correctBrandBook(refused, tenantId, {
        section: 'voice',
        original: null,
        action: 'add',
        value: 'x'
      })
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      withdrawCorrection(refused, tenantId, 'c9')
    ).rejects.toMatchObject({
      code: '42501'
    })
  })
})
