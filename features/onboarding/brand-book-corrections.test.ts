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
  schema: 2,
  facts: {
    freeShipping: null,
    deliveryDays: null,
    returnDays: 14,
    guaranteeDays: null,
    reviewsVerified: false
  } as Partial<BrandFacts>,
  unclear: [
    { topic: 'free_shipping', rule: 'x' },
    { topic: 'returns', rule: 'x' },
    { topic: 'guarantee', rule: 'x' },
    { topic: 'delivery_days', rule: 'x' }
  ],
  observed: {
    offering: ['Linen clothing.'],
    customers: { who: ['Women who travel.'], love: [], worries: [] },
    voice: ['Loud and bold.', 'Plain.'],
    marketing: ['Ads show the beach.']
  },
  sources: ['site']
})

describe('applyCorrections (ONB-058)', () => {
  it('removes, replaces and adds observed lines by their words, case and spacing aside', () => {
    const given = book()
    const out = applyCorrections(given, [
      c({
        section: 'voice',
        original: '  LOUD   and bold. ',
        action: 'replace',
        value: 'Calm and warm.'
      }),
      c({
        section: 'marketing',
        original: 'Ads show the beach.',
        action: 'remove'
      }),
      c({ section: 'offering', action: 'add', value: 'Made in Portugal.' }),
      c({
        section: 'customers.love',
        action: 'add',
        value: 'The soft fabric.'
      })
    ])
    expect(out.observed.voice).toEqual(['Calm and warm.', 'Plain.'])
    expect(out.observed.marketing).toEqual([])
    expect(out.observed.offering).toEqual([
      'Linen clothing.',
      'Made in Portugal.'
    ])
    expect(out.observed.customers.love).toEqual(['The soft fabric.'])
    expect(out.corrected).toEqual([
      'customers.love',
      'marketing',
      'offering',
      'voice'
    ])
    // Everything else is kept, and the book given is not changed.
    expect(out.sources).toEqual(['site'])
    expect(given.observed.voice).toEqual(['Loud and bold.', 'Plain.'])
    expect(given.observed.marketing).toEqual(['Ads show the beach.'])
  })

  it('applies corrections oldest first', () => {
    const out = applyCorrections(book(), [
      c({ section: 'offering', action: 'add', value: 'Made in Portugal.' }),
      c({
        section: 'offering',
        original: 'Made in Portugal.',
        action: 'replace',
        value: 'Made in Porto.'
      }),
      c({
        section: 'voice',
        original: 'Plain.',
        action: 'replace',
        value: 'Quiet.'
      }),
      c({ section: 'voice', original: 'Quiet.', action: 'remove' })
    ])
    expect(out.observed.offering).toEqual(['Linen clothing.', 'Made in Porto.'])
    expect(out.observed.voice).toEqual(['Loud and bold.'])
  })

  it('changes nothing it cannot find, and never makes a line twice', () => {
    const out = applyCorrections(book(), [
      c({ section: 'voice', original: 'Gone.', action: 'remove' }),
      c({ section: 'offering', action: 'add', value: 'linen clothing.' }),
      c({
        section: 'voice',
        original: 'Loud and bold.',
        action: 'replace',
        value: 'plain.'
      })
    ])
    expect(out.observed.offering).toEqual(['Linen clothing.'])
    expect(out.observed.voice).toEqual(['Plain.'])
    expect(out.corrected).toEqual(['voice'])
  })

  it('makes the owner’s facts the confirmed ones, no longer unclear', () => {
    const out = applyCorrections(book(), [
      c({ section: 'facts.returnDays', action: 'replace', value: '30' }),
      c({
        section: 'facts.freeShipping',
        action: 'replace',
        value: 'over 75'
      }),
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
    expect(out.corrected).toEqual([
      'facts.deliveryDays',
      'facts.freeShipping',
      'facts.guaranteeDays',
      'facts.returnDays'
    ])
  })

  it('ignores a fact whose words do not fit', () => {
    const out = applyCorrections(book(), [
      c({ section: 'facts.returnDays', action: 'replace', value: 'two weeks' })
    ])
    expect(out.facts.returnDays).toBe(14)
    expect(out.unclear).toHaveLength(4)
    expect(out.corrected).toEqual([])
  })
})

describe('factValue and correctedFacts (ONB-058)', () => {
  it('reads the owner’s facts exactly as the database takes them', () => {
    expect(factValue('freeShipping', 'always')).toBe('always')
    expect(factValue('freeShipping', 'never')).toBe('never')
    expect(factValue('freeShipping', 'over 75.50')).toEqual({ over: 75.5 })
    for (const refused of ['Never', 'over $75', 'over 075', 'Over 75'])
      expect([refused, factValue('freeShipping', refused)]).toEqual([
        refused,
        undefined
      ])
    expect(factValue('returnDays', '0')).toBe(0)
    expect(factValue('returnDays', '007')).toBeUndefined()
    expect(factValue('returnDays', '4000')).toBeUndefined()
    expect(factValue('deliveryDays', '3-7')).toEqual({ min: 3, max: 7 })
    for (const refused of ['7-3', '3-95', '0-0', '03-07'])
      expect([refused, factValue('deliveryDays', refused)]).toEqual([
        refused,
        undefined
      ])
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
    ).toEqual({ ...facts, freeShipping: 'always', guaranteeDays: null })
  })
})

describe('the commands and the read (ONB-058)', () => {
  function reader(answer: { data: unknown; error: unknown }) {
    const calls: [string, ...unknown[]][] = []
    const chain = {
      select: () => chain,
      eq: (...a: unknown[]) => (calls.push(['eq', ...a]), chain),
      is: (...a: unknown[]) => (calls.push(['is', ...a]), chain),
      order: (...a: unknown[]) => (calls.push(['order', ...a]), chain),
      limit: async (...a: unknown[]) => (calls.push(['limit', ...a]), answer)
    }
    return { db: { from: () => chain } as never, calls }
  }
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'c1',
    section: 'voice',
    original: 'Loud.',
    action: 'replace',
    value: 'Calm.',
    created_at: '2026-11-15T10:00:00Z',
    ...over
  })

  it('reads only this workspace’s live corrections, oldest first', async () => {
    const { db, calls } = reader({
      data: [row(), row({ id: 'c2', section: 'unknown' })],
      error: null
    })
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
      ['is', 'withdrawn_at', null],
      ['order', 'created_at', { ascending: true }],
      ['limit', 501]
    ])
  })

  it('throws on a failed read, and never drops corrections past what it reads', async () => {
    await expect(
      listCorrections(
        reader({ data: null, error: { code: '42501' } }).db,
        tenantId
      )
    ).rejects.toMatchObject({ code: '42501' })
    const many = Array.from({ length: 501 }, (_, i) => row({ id: `c${i}` }))
    await expect(
      listCorrections(reader({ data: many, error: null }).db, tenantId)
    ).rejects.toMatchObject({ code: 'too_many_corrections' })
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
    await correctBrandBook(db, tenantId, {
      section: 'voice',
      original: 'Loud.',
      action: 'remove',
      value: null
    })
    expect(rpc).toHaveBeenLastCalledWith('correct_brand_book', {
      t: tenantId,
      book_section: 'voice',
      book_original: 'Loud.',
      book_action: 'remove',
      book_value: ''
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
    ).rejects.toMatchObject({ code: '42501' })
  })
})
