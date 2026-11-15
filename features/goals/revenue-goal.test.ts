// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { parseRevenueGoal, readRevenueGoals } from './revenue-goal'

const usd = { currency: 'USD', today: '2026-11-15' }
const aud = { currency: 'AUD', today: '2026-11-15' }
const read = (text: string, store = usd) => parseRevenueGoal(text, store)

describe('parseRevenueGoal (PLN-033a)', () => {
  it('reads the owner’s words', () => {
    expect(read('$20k this month')).toEqual({
      month: '2026-11-01',
      amount: 20000,
      currency: 'USD'
    })
    expect(read('Goal: 20,000 AUD next month', aud)).toEqual({
      month: '2026-12-01',
      amount: 20000,
      currency: 'AUD'
    })
    expect(read('€5,000 for December')).toEqual({
      month: '2026-12-01',
      amount: 5000,
      currency: 'EUR'
    })
    expect(read('1.5m in March 2027')).toEqual({
      month: '2027-03-01',
      amount: 1500000,
      currency: 'USD'
    })
    expect(read('I want 12500.50')).toEqual({
      month: '2026-11-01',
      amount: 12500.5,
      currency: 'USD'
    })
    expect(read('£8 thousand in jan')).toEqual({
      month: '2027-01-01',
      amount: 8000,
      currency: 'GBP'
    })
    expect(read('next month 20K.')?.month).toBe('2026-12-01')
    expect(read('USD 20k')?.currency).toBe('USD')
    expect(read('20k for Sept 2027')?.month).toBe('2027-09-01')
  })

  it('reads a plain $ as the store’s dollar, and a code says which', () => {
    expect(read('$20k', aud)?.currency).toBe('AUD')
    expect(
      read('$20k', { currency: 'MXN', today: '2026-11-15' })?.currency
    ).toBe('MXN')
    expect(read('$20k USD', aud)?.currency).toBe('USD')
    expect(read('AU$20k')?.currency).toBe('AUD')
    expect(read('nz$ 4,000')?.currency).toBe('NZD')
    expect(
      read('20k', { currency: 'GBP', today: '2026-11-15' })?.currency
    ).toBe('GBP')
    expect(read('¥200000', { currency: 'JPY', today: '2026-11-15' })).toEqual({
      month: '2026-11-01',
      amount: 200000,
      currency: 'JPY'
    })
    // Not sure which currency: refused.
    for (const [text, currency] of [
      ['$20k', 'EUR'],
      ['¥20k', 'USD'],
      ['$20k EUR', 'USD'],
      ['£20k EUR', 'USD'],
      ['¥20.5', 'JPY']
    ])
      expect(
        read(text!, { currency: currency!, today: '2026-11-15' }),
        text
      ).toBeNull()
  })

  it('a month name is this year’s, or next year’s when close; never a guess', () => {
    expect(read('20k in November')?.month).toBe('2026-11-01')
    expect(read('20k in April')?.month).toBe('2027-04-01')
    // The month just gone (or far ahead without a year): refused.
    expect(read('20k in October')).toBeNull()
    expect(read('20k in June')).toBeNull()
    expect(read('20k in June 2027')?.month).toBe('2027-06-01')
    expect(read('20k in October 2026')).toBeNull()
    expect(read('20k in november 2029')).toBeNull()
    // In December, January is next month.
    const december = { currency: 'USD', today: '2026-12-10' }
    expect(read('20k in january', december)?.month).toBe('2027-01-01')
    expect(read('20k next month', december)?.month).toBe('2027-01-01')
    expect(read('20k in december', december)?.month).toBe('2026-12-01')
  })

  it('refuses what it cannot read for sure', () => {
    for (const text of [
      '',
      'a lot this month',
      'max discount 20% this month',
      '20% off this month',
      '20-30k',
      '$20-25k',
      '20k-30k',
      '20k/30k',
      '20k+5k',
      '20k or 30k',
      '20.000',
      '€1.500 for December',
      '20 grand',
      '20 thousands',
      '20k CNY',
      '20k euros',
      '20k€',
      '20k in AUD',
      'I may want 20k',
      'may be 20k',
      'Jan said 20k',
      '20k last month',
      '20k next year',
      '20k this year',
      '20k for Q4',
      '5k a day',
      '20k in jan27',
      'cancel the 20k goal',
      "don't set 20k",
      'about 20k',
      'at least 20k',
      '20k orders',
      'I made 15k',
      '20k this month and next month',
      '20k in March and April',
      '0 this month',
      '2 billion',
      '1.005',
      '20k 2027',
      '12,34,567',
      'x'.repeat(121)
    ])
      expect(read(text), text).toBeNull()
    expect(
      parseRevenueGoal('$20k', { currency: 'USD', today: 'today' })
    ).toBeNull()
    expect(
      parseRevenueGoal('20k next month', {
        currency: 'USD',
        today: '2026-13-01'
      })
    ).toBeNull()
  })
})

const tenant = '00000000-0000-4000-8000-000000000101'
function fakeDb(result: { data: unknown[] | null; error: unknown }) {
  const asked: unknown[] = []
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn((c: string, v: string) => {
      asked.push([c, v])
      return chain
    }),
    in: vi.fn(async (c: string, v: string[]) => {
      asked.push([c, v])
      return result
    })
  }
  return { db: { from: vi.fn(() => chain) } as never, asked }
}

describe('readRevenueGoals (PLN-033a)', () => {
  it('gives each month asked for its goal and revision', async () => {
    const { db, asked } = fakeDb({
      data: [
        {
          month: '2026-11-01',
          amount: '20000.00',
          currency: 'USD',
          revision: 2
        },
        { month: '2026-12-01', amount: null, currency: null, revision: 3 }
      ],
      error: null
    })
    expect(
      await readRevenueGoals(db, tenant, [
        '2027-01-01',
        '2026-12-01',
        '2026-11-01',
        '2026-11-01',
        '2026-11-15'
      ])
    ).toEqual([
      {
        month: '2026-11-01',
        revision: 2,
        goal: { month: '2026-11-01', amount: 20000, currency: 'USD' }
      },
      { month: '2026-12-01', revision: 3, goal: null },
      { month: '2027-01-01', revision: 0, goal: null }
    ])
    expect(asked).toEqual([
      ['tenant_id', tenant],
      ['month', ['2027-01-01', '2026-12-01', '2026-11-01']]
    ])
  })

  it('is null when the read fails, never a guess', async () => {
    expect(
      await readRevenueGoals(
        fakeDb({ data: null, error: { code: '42501' } }).db,
        tenant,
        ['2026-11-01']
      )
    ).toBeNull()
    const thrown = {
      from: () => {
        throw new Error('down')
      }
    } as never
    expect(await readRevenueGoals(thrown, tenant, ['2026-11-01'])).toBeNull()
    expect(
      await readRevenueGoals(fakeDb({ data: [], error: null }).db, 'nope', [
        '2026-11-01'
      ])
    ).toBeNull()
    expect(
      await readRevenueGoals(fakeDb({ data: [], error: null }).db, tenant, [])
    ).toEqual([])
  })
})
