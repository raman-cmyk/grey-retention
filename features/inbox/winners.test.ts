import { describe, expect, it } from 'vitest'
import { commonWinners, layoutOf, layoutWinners, type Layout } from './winners'

let n = 0
const email = (
  sentAt: string,
  blockSequence: string[],
  {
    angle = 'sale',
    id,
    subject
  }: { angle?: string; id?: string; subject?: string } = {}
) => ({
  ...(id ? { id } : {}),
  facts: {
    version: 2,
    subject: subject ?? `Campaign ${++n}`,
    preview: null,
    offer: { kind: 'none', value: null, code: null },
    angle,
    cta: 'Shop',
    sentAt,
    blockSequence,
    textRatio: 0.2,
    sections: blockSequence.length
  }
})
const grid = [
  'header_logo',
  'hero_image',
  'product_grid_2col',
  'product_grid_2col',
  'text',
  'signoff',
  'footer'
]
const layout = ['hero_image', 'product_grid_2col', 'text']
// Sunday 15 November 2026, noon UTC.
const at = { now: Date.parse('2026-11-15T12:00:00Z'), timezone: 'UTC' }

describe('layoutOf (CMP-047)', () => {
  it('leaves out chrome and unnamed ends, a repeated block once', () => {
    expect(layoutOf(grid)).toEqual(layout)
    expect(layoutOf(['announcement_bar', 'unsure', 'footer'])).toEqual([])
    expect(layoutOf(['unsure', 'hero_image', 'text', 'unsure'])).toEqual([
      'hero_image',
      'text'
    ])
    // An unnamed part between content stays, so it never merges with a real layout.
    expect(layoutOf(['hero_image', 'unsure', 'hero_image', 'text'])).toEqual([
      'hero_image',
      'unsure',
      'hero_image',
      'text'
    ])
  })
})

describe('layoutWinners (CMP-047)', () => {
  it('marks a layout with 3 campaigns over a week or more as a winner', () => {
    const layouts = layoutWinners(
      [
        email('2026-11-03T10:00:00Z', grid, { id: 'e1' }),
        email('2026-11-10T10:00:00Z', grid, { id: 'e2', angle: 'launch' }),
        email('2026-11-12T10:00:00Z', grid, { id: 'e3' }),
        email('2026-11-11T10:00:00Z', ['hero_image', 'text'], { id: 'e4' })
      ],
      at
    )!
    expect(layouts[0]).toEqual({
      blocks: layout,
      emails: 3,
      campaigns: 3,
      weeks: 2,
      spanDays: 9,
      lastSeen: '2026-11-12T10:00:00.000Z',
      ids: ['e3', 'e2', 'e1'],
      angles: [
        { angle: 'sale', emails: 2 },
        { angle: 'launch', emails: 1 }
      ],
      winner: true
    })
    expect(layouts[1]).toMatchObject({
      blocks: ['hero_image', 'text'],
      winner: false
    })
  })

  it('does not call a sale burst a winner, even across a Monday', () => {
    // Black Friday to Cyber Monday on one template: 4 campaigns in 4 days.
    const bfcm = layoutWinners(
      ['2026-11-27', '2026-11-28', '2026-11-29', '2026-11-30'].map((d) =>
        email(`${d}T10:00:00Z`, grid)
      ),
      { now: Date.parse('2026-12-01T12:00:00Z'), timezone: 'UTC' }
    )!
    expect(bfcm[0]).toMatchObject({ campaigns: 4, weeks: 2, winner: false })
  })

  it('counts resends with the same subject once', () => {
    const resends = layoutWinners(
      [
        email('2026-11-01T10:00:00Z', grid, { subject: '20% off knitwear' }),
        email('2026-11-05T10:00:00Z', grid, {
          subject: 'Last chance: 20% off knitwear'
        }),
        email('2026-11-12T10:00:00Z', grid, {
          subject: 'REMINDER - 20% off  knitwear'
        })
      ],
      at
    )!
    expect(resends[0]).toMatchObject({ emails: 3, campaigns: 1, winner: false })
  })

  it('keeps to the window and skips what it cannot read', () => {
    const layouts = layoutWinners(
      [
        email('2026-06-01T10:00:00Z', grid),
        email('2026-11-20T10:00:00Z', grid),
        email('2026-11-10T10:00:00Z', ['header_logo', 'footer']),
        { facts: { version: 2 } },
        email('not a time', grid),
        email('2026-11-10T10:00:00Z', grid)
      ],
      at
    )!
    expect(layouts).toEqual([
      expect.objectContaining({ emails: 1, ids: [], winner: false })
    ])
    for (const bad of [
      { now: Number.NaN },
      { timezone: 'Not/Here' },
      { windowDays: 0 },
      { windowDays: 1.5 },
      { windowDays: 400 }
    ])
      expect(
        layoutWinners([], { ...at, ...bad }),
        JSON.stringify(bad)
      ).toBeNull()
  })

  it('counts a row given twice once', () => {
    const row = email('2026-11-03T10:00:00Z', grid, { id: 'e1' })
    expect(
      layoutWinners(
        [row, row, email('2026-11-10T10:00:00Z', grid, { id: 'e2' })],
        at
      )![0]
    ).toMatchObject({ emails: 2, ids: ['e2', 'e1'] })
  })

  it('counts weeks in the reader’s timezone', () => {
    // 23:30 UTC on Sunday 8 November is Monday 9 November in Sydney.
    const rows = [
      email('2026-11-08T23:30:00Z', grid),
      email('2026-11-11T10:00:00Z', grid)
    ]
    expect(layoutWinners(rows, at)![0]!.weeks).toBe(2)
    expect(
      layoutWinners(rows, { ...at, timezone: 'Australia/Sydney' })![0]!.weeks
    ).toBe(1)
  })
})

describe('commonWinners (CMP-047)', () => {
  const win = (blocks: string[], emails: number, winner = true): Layout => ({
    blocks,
    emails,
    campaigns: emails,
    weeks: 2,
    spanDays: 10,
    lastSeen: '2026-11-12T10:00:00.000Z',
    ids: [],
    angles: [],
    winner
  })

  it('lists layouts that two or more brands each send as winners', () => {
    const common = commonWinners([
      { domain: 'b.example', layouts: [win(layout, 4), win(['text'], 3)] },
      { domain: 'a.example', layouts: [win(layout, 3)] },
      { domain: 'a.example', layouts: [win(layout, 3)] },
      { domain: 'c.example', layouts: [win(['text'], 5, false)] }
    ])
    expect(common).toEqual([
      { blocks: layout, domains: ['a.example', 'b.example'], emails: 7 }
    ])
    // The result does not share the input's arrays.
    expect(common[0]!.blocks).not.toBe(layout)
  })
})
