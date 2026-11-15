import { describe, expect, it } from 'vitest'
import { offerTracker } from './offer-tracker'

const email = (
  sentAt: string,
  offer: { kind: string; value: number | null; code: string | null } = {
    kind: 'none',
    value: null,
    code: null
  }
) => ({
  facts: {
    version: 2,
    subject: 'Hello',
    preview: null,
    offer,
    angle: 'sale',
    cta: 'Shop',
    sentAt,
    blockSequence: ['hero_image'],
    textRatio: 0.2,
    sections: 3
  }
})
const pct = (value: number, code: string | null = null) => ({
  kind: 'percent',
  value,
  code
})
// Sunday 15 November 2026, 10:00 in New York.
const now = Date.parse('2026-11-15T15:00:00Z')
const ny = { now, timezone: 'America/New_York', weeks: 3 }

describe('offerTracker (CMP-049)', () => {
  it('lists each brand’s offers week by week, Monday first', () => {
    const t = offerTracker(
      [
        {
          domain: 'a.example',
          label: 'Brand A',
          rows: [
            email('2026-11-10T15:00:00Z', pct(20, 'save20')),
            email('2026-11-11T15:00:00Z', pct(30, 'SAVE30')),
            email('2026-11-12T15:00:00Z', {
              kind: 'free_shipping',
              value: null,
              code: null
            }),
            email('2026-11-03T15:00:00Z')
          ]
        },
        {
          domain: 'b.example',
          label: 'Brand B',
          rows: [
            email('2026-11-09T15:00:00Z', pct(10)),
            email('2026-10-27T15:00:00Z', {
              kind: 'amount',
              value: 15,
              code: 'TAKE15'
            })
          ]
        }
      ],
      ny
    )!
    expect(t.weeks).toEqual(['2026-10-26', '2026-11-02', '2026-11-09'])
    expect(t.brands[0]!.byWeek).toEqual([
      { emails: 0, offers: [], deepestPercent: null, codes: [] },
      { emails: 1, offers: [], deepestPercent: null, codes: [] },
      {
        emails: 3,
        offers: [
          { kind: 'percent', emails: 2 },
          { kind: 'free_shipping', emails: 1 }
        ],
        deepestPercent: 30,
        codes: ['SAVE20', 'SAVE30']
      }
    ])
    // The median is a percent the brand ran (20 and 30: 20), as the brand summary.
    expect(t.brands[0]).toMatchObject({ offerWeeks: 0.5, usualPercent: 20 })
    expect(t.brands[1]!.byWeek[0]).toEqual({
      emails: 1,
      offers: [{ kind: 'amount', emails: 1 }],
      deepestPercent: null,
      codes: ['TAKE15']
    })
    expect(t.overall).toEqual([
      { brandsWithOffer: 1, usualPercent: null },
      { brandsWithOffer: 0, usualPercent: null },
      { brandsWithOffer: 2, usualPercent: 10 }
    ])
  })

  it('puts an email in its week in the reader’s timezone', () => {
    // 03:00 UTC on Monday 9 November is still Sunday 8 November in New York.
    const t = offerTracker(
      [
        {
          domain: 'a.example',
          label: 'A',
          rows: [email('2026-11-09T03:00:00Z', pct(10))]
        }
      ],
      ny
    )!
    expect(t.brands[0]!.byWeek[1]!.emails).toBe(1)
    expect(t.brands[0]!.byWeek[2]!.emails).toBe(0)
  })

  it('skips broken, future and older rows, and a brand with no emails', () => {
    const t = offerTracker(
      [
        {
          domain: 'a.example',
          label: 'A',
          rows: [
            { facts: { version: 2 } },
            email('2026-11-20T15:00:00Z', pct(50)),
            email('2026-09-01T15:00:00Z', pct(50)),
            email('2026-11-10T15:00:00Z', pct(0))
          ]
        },
        { domain: 'b.example', label: 'B', rows: [] }
      ],
      ny
    )!
    expect(t.brands[0]!.byWeek.map((w) => w.emails)).toEqual([0, 0, 1])
    // "0% off" is no offer.
    expect(t.brands[0]).toMatchObject({ usualPercent: null, offerWeeks: 0 })
    expect(t.brands[1]).toMatchObject({ offerWeeks: null, usualPercent: null })
    expect(offerTracker([], { now, timezone: 'Nowhere/Land' })).toBeNull()
    expect(offerTracker([], { now, timezone: 'UTC' })!.weeks).toHaveLength(12)
  })

  it('keeps codes from emails whose offer was not recognised', () => {
    const t = offerTracker(
      [
        {
          domain: 'a.example',
          label: 'A',
          rows: [
            email('2026-11-10T15:00:00Z', {
              kind: 'none',
              value: null,
              code: 'tenoff'
            })
          ]
        }
      ],
      ny
    )!
    expect(t.brands[0]!.byWeek[2]).toEqual({
      emails: 1,
      offers: [],
      deepestPercent: null,
      codes: ['TENOFF']
    })
    expect(t.brands[0]!.offerWeeks).toBe(1)
    expect(t.overall[2]!.brandsWithOffer).toBe(1)
  })

  it('never fails on an odd send time, a bad time or a bad week count', () => {
    const rows = [
      email('0999-01-01T00:00:00Z', pct(10)),
      email('0001-01-01T00:00:00Z', pct(10)),
      email('2026-11-10T15:00:00Z', pct(10))
    ]
    const t = offerTracker([{ domain: 'a.example', label: 'A', rows }], ny)!
    expect(t.brands[0]!.byWeek.map((w) => w.emails)).toEqual([0, 0, 1])
    expect(offerTracker([], { now: Number.NaN, timezone: 'UTC' })).toBeNull()
    expect(
      offerTracker([], { now, timezone: 'UTC', weeks: 200 })!.weeks
    ).toHaveLength(104)
    expect(
      offerTracker([], { now, timezone: 'UTC', weeks: 0 })!.weeks
    ).toHaveLength(1)
  })

  it('crosses the new year east of UTC', () => {
    // Sydney, Thursday 1 January 2026 at 14:00.
    const t = offerTracker(
      [
        {
          domain: 'a.example',
          label: 'A',
          rows: [email('2025-12-29T00:30:00Z', pct(15))]
        }
      ],
      {
        now: Date.parse('2026-01-01T03:00:00Z'),
        timezone: 'Australia/Sydney',
        weeks: 3
      }
    )!
    expect(t.weeks).toEqual(['2025-12-15', '2025-12-22', '2025-12-29'])
    expect(t.brands[0]!.byWeek[2]!.deepestPercent).toBe(15)
  })
})
