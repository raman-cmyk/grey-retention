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
    expect(read('20,000 AUD next month', aud)).toEqual({
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
  })

  it('reads a plain $ as the store’s dollar, and a code says which', () => {
    expect(read('$20k', aud)?.currency).toBe('AUD')
    expect(
      read('$20k', { currency: 'EUR', today: '2026-11-15' })?.currency
    ).toBe('USD')
    expect(read('$20k USD', aud)?.currency).toBe('USD')
    expect(read('AU$20k')?.currency).toBe('AUD')
    expect(read('nz$ 4,000')?.currency).toBe('NZD')
    expect(
      read('20k', { currency: 'GBP', today: '2026-11-15' })?.currency
    ).toBe('GBP')
  })

  it('a month name means its next time, never a past month', () => {
    expect(read('20k in November')?.month).toBe('2026-11-01')
    expect(read('20k in October')?.month).toBe('2027-10-01')
    expect(read('20k in October 2026')).toBeNull()
    expect(read('20k for Sept')?.month).toBe('2027-09-01')
  })

  it('refuses what it cannot read for sure', () => {
    for (const text of [
      '',
      'a lot this month',
      '20k or 30k',
      '£20k EUR',
      '$20k EUR',
      '20k this month and next month',
      '20k in March and April',
      '0 this month',
      '2 billion',
      '20k 2027',
      '3 bn',
      '12,34,567',
      'x'.repeat(201)
    ])
      expect(read(text), text).toBeNull()
    expect(
      parseRevenueGoal('$20k', { currency: 'USD', today: 'today' })
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
