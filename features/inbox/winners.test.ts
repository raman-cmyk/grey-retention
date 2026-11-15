import { describe, expect, it } from 'vitest'
import { commonWinners, layoutOf, layoutWinners } from './winners'

const email = (
  sentAt: string,
  blockSequence: string[],
  angle = 'sale',
  id?: string
) => ({
  ...(id ? { id } : {}),
  facts: {
    version: 2,
    subject: 'Hello',
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
  'product_grid',
  'product_grid',
  'text',
  'footer_links'
]
// Sunday 15 November 2026, noon UTC.
const at = { now: Date.parse('2026-11-15T12:00:00Z'), timezone: 'UTC' }

describe('layoutWinners (CMP-047)', () => {
  it('reads the layout without chrome, a repeated block once', () => {
    expect(layoutOf(grid)).toEqual(['hero_image', 'product_grid', 'text'])
    expect(layoutOf(['announcement_bar', 'unsure', 'footer'])).toEqual([])
  })

  it('marks a layout sent 3 times in 2 or more weeks as a winner', () => {
    const layouts = layoutWinners(
      [
        email('2026-11-03T10:00:00Z', grid, 'sale', 'e1'),
        email('2026-11-10T10:00:00Z', grid, 'launch', 'e2'),
        email('2026-11-12T10:00:00Z', grid, 'sale', 'e3'),
        email('2026-11-11T10:00:00Z', ['hero_image', 'text'], 'story', 'e4')
      ],
      at
    )!
    expect(layouts[0]).toEqual({
      blocks: ['hero_image', 'product_grid', 'text'],
      emails: 3,
      weeks: 2,
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

  it('does not call a burst in one week a winner', () => {
    const burst = layoutWinners(
      ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12'].map((d) =>
        email(`${d}T10:00:00Z`, grid)
      ),
      at
    )!
    expect(burst[0]).toMatchObject({ emails: 4, weeks: 1, winner: false })
    const twice = layoutWinners(
      [
        email('2026-11-03T10:00:00Z', grid),
        email('2026-11-10T10:00:00Z', grid)
      ],
      at
    )!
    expect(twice[0]).toMatchObject({ emails: 2, weeks: 2, winner: false })
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
    expect(layoutWinners([], { now: Number.NaN, timezone: 'UTC' })).toBeNull()
    expect(layoutWinners([], { ...at, timezone: 'Not/Here' })).toBeNull()
  })

  it('counts weeks in the reader’s timezone', () => {
    // 23:30 UTC on Sunday 8 November is Monday 9 November in Sydney.
    const rows = [
      email('2026-11-08T23:30:00Z', grid),
      email('2026-11-10T10:00:00Z', grid),
      email('2026-11-11T10:00:00Z', grid)
    ]
    expect(layoutWinners(rows, at)![0]).toMatchObject({
      weeks: 2,
      winner: true
    })
    expect(
      layoutWinners(rows, { ...at, timezone: 'Australia/Sydney' })![0]
    ).toMatchObject({ weeks: 1, winner: false })
  })
})

describe('commonWinners (CMP-047)', () => {
  it('lists layouts that two or more brands each send as winners', () => {
    const win = (blocks: string[], emails: number, winner = true) => ({
      blocks,
      emails,
      weeks: 2,
      lastSeen: '2026-11-12T10:00:00.000Z',
      ids: [],
      angles: [],
      winner
    })
    const layout = ['hero_image', 'product_grid', 'text']
    expect(
      commonWinners([
        { domain: 'b.example', layouts: [win(layout, 4), win(['text'], 3)] },
        { domain: 'a.example', layouts: [win(layout, 3)] },
        { domain: 'c.example', layouts: [win(['text'], 5, false)] }
      ])
    ).toEqual([
      { blocks: layout, domains: ['a.example', 'b.example'], emails: 7 }
    ])
  })
})
