import { describe, expect, it } from 'vitest'
import { ladderStepsDown, offerLadder, type LadderOffer } from './ladder'

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

describe('offerLadder (PLN-040)', () => {
  it('steps up from 10% to the highest code over the window', () => {
    expect(ladder(['2026-11-24', '2026-11-17', '2026-11-20'], codes)).toEqual([
      '2026-11-17 TEN 10%',
      '2026-11-20 MID15 15%',
      '2026-11-24 BIG25 25%'
    ])
  })

  it('gives one offer email the starting code, not the max', () => {
    expect(ladder(['2026-11-17'], codes)).toEqual(['2026-11-17 TEN 10%'])
  })

  it('spreads fewer emails across the codes, and repeats a step for more', () => {
    const five = [5, 10, 15, 20, 25].map((p) => offer(`P${p}`, p))
    // Starts at 10% (5% is below the start), ends at the highest.
    expect(ladder(['2026-11-17', '2026-11-24'], five)).toEqual([
      '2026-11-17 P10 10%',
      '2026-11-24 P25 25%'
    ])
    expect(
      ladder(
        ['2026-11-17', '2026-11-19', '2026-11-21', '2026-11-23'],
        [offer('TEN', 10), offer('TWENTY', 20)]
      )
    ).toEqual([
      '2026-11-17 TEN 10%',
      '2026-11-19 TEN 10%',
      '2026-11-21 TWENTY 20%',
      '2026-11-23 TWENTY 20%'
    ])
  })

  it('uses a code only while it works, and never steps down', () => {
    // The 15% code ends on the 19th: the 20th steps up to 25% instead.
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
    // The 25% code has ended by the 24th: the last email stays at 10%.
    expect(
      ladder(
        ['2026-11-17', '2026-11-24'],
        [offer('TEN', 10), offer('BIG25', 25, '2026-11-18')]
      )
    ).toEqual(['2026-11-17 TEN 10%', '2026-11-24 TEN 10%'])
    // Only lower codes, or none, work on the 24th: that day gets none.
    expect(
      ladder(
        ['2026-11-17', '2026-11-20', '2026-11-24'],
        [offer('TEN', 10, '2026-11-17'), offer('MID15', 15, '2026-11-20')]
      )
    ).toEqual(['2026-11-17 TEN 10%', '2026-11-20 MID15 15%', '2026-11-24 none'])
  })

  it('starts at the lowest code when all are below 10%', () => {
    expect(
      ladder(
        ['2026-11-17', '2026-11-24'],
        [offer('EIGHT', 8), offer('FIVE', 5)]
      )
    ).toEqual(['2026-11-17 FIVE 5%', '2026-11-24 EIGHT 8%'])
    // Another start.
    expect(ladder(['2026-11-17', '2026-11-24'], codes, 15)).toEqual([
      '2026-11-17 MID15 15%',
      '2026-11-24 BIG25 25%'
    ])
  })

  it('picks the longest-lasting of codes with the same percent', () => {
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
      ladder(['2026-11-17'], [offer('ZED', 10), offer('ABC', 10)])
    ).toEqual(['2026-11-17 ABC 10%'])
  })

  it('gives none without usable codes, and ignores broken percents', () => {
    expect(ladder(['2026-11-17'], [])).toEqual(['2026-11-17 none'])
    expect(
      ladder(['2026-11-17'], [offer('ZERO', 0), offer('HALF', 10.5)])
    ).toEqual(['2026-11-17 none'])
    expect(offerLadder([], codes)).toEqual([])
  })
})

describe('ladderStepsDown (PLN-040)', () => {
  it('finds offer emails lower than one on an earlier day', () => {
    expect(
      ladderStepsDown([
        { date: '2026-11-24', percent: 10 },
        { date: '2026-11-17', percent: 25 },
        { date: '2026-11-20', percent: null },
        { date: '2026-11-21', percent: 25 }
      ])
    ).toEqual([0])
  })

  it('does not count emails on the same day, or a steady ladder', () => {
    expect(
      ladderStepsDown([
        { date: '2026-11-17', percent: 25 },
        { date: '2026-11-17', percent: 10 },
        { date: '2026-11-20', percent: 25 }
      ])
    ).toEqual([])
    expect(
      ladderStepsDown([
        { date: '2026-11-17', percent: 25 },
        { date: '2026-11-17', percent: 10 },
        { date: '2026-11-20', percent: 15 }
      ])
    ).toEqual([2])
    expect(ladderStepsDown([])).toEqual([])
  })
})
