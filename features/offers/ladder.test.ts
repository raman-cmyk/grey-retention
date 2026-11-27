import { describe, expect, it } from 'vitest'
import { offerSpacingDays } from '@/features/strategy/plan'
import {
  carriedSalePercent,
  ladderStepsDown,
  offerLadder,
  saleGapDays,
  type LadderOffer
} from './ladder'

const offer = (
  code: string,
  percent: number,
  until: string | null = null
): LadderOffer => ({ id: `offer:${code}`, code, percent, until })
const codes = [offer('BIG25', 25), offer('TEN', 10), offer('MID15', 15)]
const ladder = (dates: string[], offers: LadderOffer[], start?: number) =>
  offerLadder(dates, offers, start).map(
    (s) =>
      `${s.date} ${s.offer ? `${s.offer.code} ${s.offer.percent}%` : 'none'}`
  )
const week = ['2026-11-17', '2026-11-24', '2026-12-01']

describe('offerLadder (PLN-040)', () => {
  it('steps up from 10% to the highest code, answering in the order given', () => {
    expect(ladder(['2026-11-24', '2026-11-17', '2026-11-20'], codes)).toEqual([
      '2026-11-24 BIG25 25%',
      '2026-11-17 TEN 10%',
      '2026-11-20 MID15 15%'
    ])
    expect(offerLadder(['2026-11-24', '2026-11-17'], codes)[0]).toMatchObject({
      index: 0,
      date: '2026-11-24'
    })
  })

  it('gives one offer email the starting code, not the max', () => {
    expect(ladder(['2026-11-17'], codes)).toEqual(['2026-11-17 TEN 10%'])
  })

  it('gives emails on the same day the same code', () => {
    expect(
      ladder(
        ['2026-11-17', '2026-11-17'],
        [offer('TEN', 10), offer('BIG25', 25)]
      )
    ).toEqual(['2026-11-17 TEN 10%', '2026-11-17 TEN 10%'])
    expect(
      ladder(
        ['2026-11-17', '2026-11-17', '2026-11-24'],
        [offer('TEN', 10), offer('BIG25', 25)]
      )
    ).toEqual([
      '2026-11-17 TEN 10%',
      '2026-11-17 TEN 10%',
      '2026-11-24 BIG25 25%'
    ])
  })

  it('rounds middle steps down, toward the smaller discount', () => {
    expect(ladder(week, [offer('TEN', 10), offer('TWENTY', 20)])).toEqual([
      '2026-11-17 TEN 10%',
      '2026-11-24 TEN 10%',
      '2026-12-01 TWENTY 20%'
    ])
    const four = [10, 15, 20, 25].map((p) => offer(`P${p}`, p))
    expect(ladder(week, four)).toEqual([
      '2026-11-17 P10 10%',
      '2026-11-24 P15 15%',
      '2026-12-01 P25 25%'
    ])
    // 5% is below the start; two emails go from 10% to the highest.
    const five = [5, 10, 15, 20, 25].map((p) => offer(`P${p}`, p))
    expect(ladder(['2026-11-17', '2026-11-24'], five)).toEqual([
      '2026-11-17 P10 10%',
      '2026-11-24 P25 25%'
    ])
  })

  it('does not step up to a code that ends before a later offer email', () => {
    expect(
      ladder(week, [offer('TEN', 10), offer('TWENTY', 20, '2026-11-24')])
    ).toEqual([
      '2026-11-17 TEN 10%',
      '2026-11-24 TEN 10%',
      '2026-12-01 TEN 10%'
    ])
    expect(
      ladder(week, [
        offer('TEN', 10),
        offer('MID15', 15, '2026-11-24'),
        offer('BIG25', 25, '2026-11-24')
      ])
    ).toEqual([
      '2026-11-17 TEN 10%',
      '2026-11-24 TEN 10%',
      '2026-12-01 TEN 10%'
    ])
  })

  it('steps up past a code that has ended', () => {
    expect(
      ladder(
        ['2026-11-17', '2026-11-20', '2026-11-24'],
        [
          offer('TEN', 10, '2026-11-17'),
          offer('MID15', 15, '2026-11-19'),
          offer('BIG25', 25)
        ]
      )
    ).toEqual([
      '2026-11-17 TEN 10%',
      '2026-11-20 BIG25 25%',
      '2026-11-24 BIG25 25%'
    ])
    // Nothing works on the 24th without stepping down: that day gets none.
    expect(
      ladder(
        ['2026-11-17', '2026-11-20', '2026-11-24'],
        [offer('TEN', 10, '2026-11-17'), offer('MID15', 15, '2026-11-20')]
      )
    ).toEqual(['2026-11-17 TEN 10%', '2026-11-20 MID15 15%', '2026-11-24 none'])
  })

  it('counts only codes that work on an offer day', () => {
    // BIG25 has ended by the only offer day: FIVE is the lowest code left.
    expect(
      ladder(
        ['2026-11-24'],
        [offer('FIVE', 5), offer('BIG25', 25, '2026-11-17')]
      )
    ).toEqual(['2026-11-24 FIVE 5%'])
    expect(
      ladder(
        ['2026-11-24'],
        [offer('EIGHT', 8), offer('TEN', 10, '2026-11-17')]
      )
    ).toEqual(['2026-11-24 EIGHT 8%'])
  })

  it('starts at the lowest code when all are below 10%, or at another start', () => {
    expect(
      ladder(
        ['2026-11-17', '2026-11-24'],
        [offer('EIGHT', 8), offer('FIVE', 5)]
      )
    ).toEqual(['2026-11-17 FIVE 5%', '2026-11-24 EIGHT 8%'])
    expect(ladder(['2026-11-17', '2026-11-24'], codes, 15)).toEqual([
      '2026-11-17 MID15 15%',
      '2026-11-24 BIG25 25%'
    ])
  })

  it('picks the longest-lasting of codes with the same percent, then by code', () => {
    expect(
      ladder(
        ['2026-11-17'],
        [
          offer('A10', 10, '2026-11-30'),
          offer('C10', 10),
          offer('B10', 10, '2026-12-31')
        ]
      )
    ).toEqual(['2026-11-17 C10 10%'])
    expect(
      ladder(
        ['2026-11-17'],
        [offer('A10', 10, '2026-11-30'), offer('B10', 10, '2026-12-31')]
      )
    ).toEqual(['2026-11-17 B10 10%'])
    expect(
      ladder(['2026-11-17'], [offer('SALE_10', 10), offer('SALE-10', 10)])
    ).toEqual(['2026-11-17 SALE-10 10%'])
  })

  it('gives none without usable codes or a real day', () => {
    expect(ladder(['2026-11-17'], [])).toEqual(['2026-11-17 none'])
    expect(
      ladder(['2026-11-17'], [offer('ZERO', 0), offer('HALF', 10.5)])
    ).toEqual(['2026-11-17 none'])
    expect(ladder(['2026-11-17T09:00', '2026-11-17'], codes)).toEqual([
      '2026-11-17T09:00 none',
      '2026-11-17 TEN 10%'
    ])
    expect(offerLadder([], codes)).toEqual([])
  })
})

describe('ladderStepsDown (PLN-040)', () => {
  it('finds offer emails lower than one sent earlier', () => {
    expect(
      ladderStepsDown([
        { date: '2026-11-24', percent: 10 },
        { date: '2026-11-17', percent: 25 },
        { date: '2026-11-20', percent: null },
        { date: '2026-11-21', percent: 25 }
      ])
    ).toEqual([0])
  })

  it('compares by time within a day; the same moment is not a step down', () => {
    expect(
      ladderStepsDown([
        { date: '2026-11-17', time: '09:00', percent: 25 },
        { date: '2026-11-17', time: '18:00', percent: 10 }
      ])
    ).toEqual([1])
    expect(
      ladderStepsDown([
        { date: '2026-11-17', time: '10:00', percent: 25 },
        { date: '2026-11-17', time: '10:00', percent: 10 },
        { date: '2026-11-20', time: '10:00', percent: 15 },
        { date: '2026-11-24', time: '10:00', percent: 25 }
      ])
    ).toEqual([2])
    expect(ladderStepsDown([])).toEqual([])
  })

  it('counts offer emails already planned', () => {
    // An existing 25% email on the 18th, then the new plan's 10% on the 25th.
    expect(
      ladderStepsDown([
        { date: '2026-11-18', time: '10:00', percent: 25 },
        { date: '2026-11-25', time: '10:00', percent: 10 }
      ])
    ).toEqual([1])
  })
})

describe('carriedSalePercent (PLN-040b)', () => {
  const start = '2026-11-16'
  const sent = (date: string, percent?: number | null, offer = true) => ({
    date,
    offer,
    ...(percent === undefined ? {} : { percent })
  })

  it('is two offer spacings', () => {
    expect(saleGapDays).toBe(2 * offerSpacingDays)
  })

  it('picks the sale up from the latest offer email of known percent', () => {
    expect(
      carriedSalePercent(
        [sent('2026-11-05', 15), sent('2026-11-12', 25)],
        start,
        '2026-11-23'
      )
    ).toEqual({ percent: 25, date: '2026-11-12' })
    // Two that day: the bigger one.
    expect(
      carriedSalePercent(
        [sent('2026-11-12', 15), sent('2026-11-12', 25)],
        start,
        '2026-11-16'
      )
    ).toEqual({ percent: 25, date: '2026-11-12' })
    // Exactly 14 days before the first offer email still counts.
    expect(
      carriedSalePercent([sent('2026-11-09', 25)], start, '2026-11-23')
    ).toEqual({ percent: 25, date: '2026-11-09' })
  })

  it('starts a new sale after a longer gap, an unknown percent, or a send that is no offer', () => {
    expect(
      carriedSalePercent([sent('2026-11-09', 25)], start, '2026-11-24')
    ).toBeNull()
    for (const e of [
      sent('2026-11-12'),
      sent('2026-11-12', null),
      sent('2026-11-12', 25, false),
      sent('2026-11-12', 0),
      sent('2026-11-12', 12.5),
      // Not before the plan's days: the plan's own emails decide.
      sent('2026-11-16', 25),
      sent('12 Nov', 25)
    ])
      expect(carriedSalePercent([e], start, '2026-11-23')).toBeNull()
    expect(carriedSalePercent([], start, '2026-11-23')).toBeNull()
    expect(
      carriedSalePercent([sent('2026-11-12', 25)], start, 'soon')
    ).toBeNull()
  })

  it('ignores an unknown one between: what GROS knows still counts', () => {
    expect(
      carriedSalePercent(
        [sent('2026-11-08', 25), sent('2026-11-13')],
        start,
        '2026-11-20'
      )
    ).toEqual({ percent: 25, date: '2026-11-08' })
  })
})
