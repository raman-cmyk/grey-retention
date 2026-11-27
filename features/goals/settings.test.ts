// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { goalMoney, goalMonths, goalSettings, monthLabel } from './settings'

const tenantId = '00000000-0000-4000-8000-000000000101'

function database(answers: {
  goals?: { data: unknown; error: unknown }
  currency?: { data: unknown; error: unknown }
}) {
  const asked: unknown[][] = []
  const from = (table: string) => {
    const chain = {
      select: () => chain,
      eq: (...a: unknown[]) => (asked.push([table, 'eq', ...a]), chain),
      in: async (...a: unknown[]) => (
        asked.push([table, 'in', ...a]),
        answers.goals ?? { data: [], error: null }
      ),
      maybeSingle: async () =>
        answers.currency ?? { data: { currency: 'USD' }, error: null }
    }
    return chain
  }
  return { db: { from } as never, asked }
}

describe('the revenue goal in Settings (owner pick #33)', () => {
  it('works with this month and next month of the store’s calendar', () => {
    expect(goalMonths('2026-11-30')).toEqual(['2026-11-01', '2026-12-01'])
    expect(goalMonths('2026-12-31')).toEqual(['2026-12-01', '2027-01-01'])
    expect(monthLabel('2027-01-01')).toBe('January 2027')
    expect(goalMoney({ amount: 20_000, currency: 'USD' })).toBe('$20,000')
    expect(goalMoney({ amount: 12_500.5, currency: 'EUR' })).toBe('€12,500.50')
  })

  it('reads both months’ goals and revisions, and the store’s currency, in the store’s time', async () => {
    const { db, asked } = database({
      goals: {
        data: [
          {
            month: '2026-12-01',
            amount: '25000',
            currency: 'USD',
            revision: 3
          }
        ],
        error: null
      }
    })
    // 20:00 on 30 November in New York is 1 December in UTC.
    const read = await goalSettings(
      db,
      { tenantId, timezone: 'America/New_York' },
      new Date('2026-12-01T01:00:00Z')
    )
    expect(read).toEqual({
      currency: 'USD',
      today: '2026-11-30',
      months: [
        {
          month: '2026-11-01',
          label: 'November 2026',
          goal: null,
          revision: 0
        },
        {
          month: '2026-12-01',
          label: 'December 2026',
          goal: { month: '2026-12-01', amount: 25_000, currency: 'USD' },
          revision: 3
        }
      ]
    })
    expect(asked).toContainEqual(['revenue_goals', 'eq', 'tenant_id', tenantId])
    expect(asked).toContainEqual([
      'catalog_status',
      'eq',
      'tenant_id',
      tenantId
    ])
  })

  it('is null when the goals cannot be read, and has no currency when the catalog’s is unread or odd', async () => {
    expect(
      await goalSettings(
        database({ goals: { data: null, error: { code: '42501' } } }).db,
        { tenantId, timezone: 'UTC' }
      )
    ).toBeNull()
    for (const currency of [
      { data: null, error: { code: 'XX000' } },
      { data: { currency: 'usd' }, error: null },
      { data: null, error: null }
    ])
      expect(
        (
          await goalSettings(database({ currency }).db, {
            tenantId,
            timezone: 'Not/AZone'
          })
        )?.currency
      ).toBeNull()
  })
})
