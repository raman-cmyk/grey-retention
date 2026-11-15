import { describe, expect, it } from 'vitest'
import {
  checkSegment,
  defaultEngagedSegment,
  describeSegment,
  missingMetrics,
  segmentNeeds,
  type SegmentDefinition
} from './rules'

const vip: SegmentDefinition = {
  name: 'Repeat buyers, still engaged',
  include: [
    { kind: 'engaged', action: 'opened_or_clicked', withinDays: 90 },
    { kind: 'purchased', atLeast: 2, withinDays: 180 }
  ],
  exclude: [{ kind: 'joined', withinDays: 7 }]
}

describe('strategic segment rules (SEG-STRATEGY-001)', () => {
  it('accepts a sound segment and says it in one sentence', () => {
    expect(checkSegment(vip)).toEqual({ ok: true, segment: vip, warnings: [] })
    expect(describeSegment(vip)).toBe(
      'People who opened or clicked an email in the last 90 days and placed at least 2 orders in the last 180 days, but not people who joined in the last 7 days.'
    )
    expect(
      describeSegment(
        {
          name: 'Big spenders abroad',
          include: [
            { kind: 'spent', atLeast: 500, withinDays: null },
            { kind: 'country', countries: ['AU', 'NZ'] }
          ],
          exclude: [{ kind: 'not_purchased', withinDays: 365 }]
        },
        'AUD'
      )
    ).toBe(
      'People who have spent at least A$500 in all and live in Australia or New Zealand, but not people who have not ordered in the last 365 days.'
    )
  })

  it('refuses broken input in plain words', () => {
    const bad = checkSegment({
      name: 'x',
      include: [],
      exclude: [{ kind: 'engaged', action: 'read', withinDays: 0 }]
    })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.problems.length).toBeGreaterThanOrEqual(3)
    expect(checkSegment({ ...vip, name: 'Two\nlines' }).ok).toBe(false)
    expect(
      checkSegment({
        ...vip,
        include: [...vip.include, ...vip.include, ...vip.include]
      }).ok
    ).toBe(false)
    expect(
      checkSegment({
        ...vip,
        include: [{ kind: 'country', countries: ['australia'] }]
      }).ok
    ).toBe(false)
  })

  it('refuses rules that cannot both hold', () => {
    const lapsedAndRecent = checkSegment({
      name: 'Impossible',
      include: [
        { kind: 'purchased', atLeast: 1, withinDays: 90 },
        { kind: 'not_purchased', withinDays: 180 }
      ],
      exclude: []
    })
    expect(lapsedAndRecent).toEqual({
      ok: false,
      problems: [
        '“people who placed an order in the last 90 days” and “people who have not ordered in the last 180 days” cannot both be true, so nobody matches.'
      ]
    })
    // Lapsed customers are fine: ordered at some time, not in the last 90 days.
    expect(
      checkSegment({
        name: 'Lapsed',
        include: [
          { kind: 'purchased', atLeast: 1, withinDays: null },
          { kind: 'not_purchased', withinDays: 90 }
        ],
        exclude: []
      }).ok
    ).toBe(true)
    expect(
      checkSegment({
        name: 'Nowhere',
        include: [
          { kind: 'country', countries: ['US'] },
          { kind: 'country', countries: ['GB'] }
        ],
        exclude: []
      }).ok
    ).toBe(false)
  })

  it('refuses an exclusion that leaves nobody', () => {
    for (const [include, exclude] of [
      [vip.include[0], vip.include[0]],
      [
        { kind: 'engaged', action: 'opened', withinDays: 90 },
        { kind: 'engaged', action: 'opened_or_clicked', withinDays: 180 }
      ],
      [
        { kind: 'purchased', atLeast: 3, withinDays: 90 },
        { kind: 'purchased', atLeast: 1, withinDays: null }
      ],
      [
        { kind: 'country', countries: ['US'] },
        { kind: 'country', countries: ['US', 'CA'] }
      ],
      [
        { kind: 'joined', withinDays: 30 },
        { kind: 'joined', withinDays: 60 }
      ],
      [
        { kind: 'not_purchased', withinDays: 180 },
        { kind: 'not_purchased', withinDays: 90 }
      ]
    ])
      expect(
        checkSegment({ name: 'Empty', include: [include], exclude: [exclude] })
          .ok,
        JSON.stringify([include, exclude])
      ).toBe(false)
    // A narrower exclusion keeps people.
    expect(
      checkSegment({
        name: 'Engaged, not brand new',
        include: [{ kind: 'engaged', action: 'opened', withinDays: 90 }],
        exclude: [{ kind: 'engaged', action: 'opened', withinDays: 7 }]
      }).ok
    ).toBe(true)
  })

  it('warns when a segment is wider than engaged in the last 180 days', () => {
    const warning =
      'This segment has no rule for opening or clicking in the last 180 days, so it may reach people who have not read an email in a long time.'
    for (const include of [
      [{ kind: 'country', countries: ['AU'] }],
      [{ kind: 'joined', withinDays: 365 }],
      [{ kind: 'engaged', action: 'opened', withinDays: 365 }],
      [{ kind: 'purchased', atLeast: 1, withinDays: null }]
    ])
      expect(
        checkSegment({ name: 'Wide', include, exclude: [] })
      ).toMatchObject({
        ok: true,
        warnings: [warning]
      })
    expect(checkSegment(vip)).toMatchObject({ warnings: [] })
  })

  it('refuses more segments that leave nobody', () => {
    const nobody = (include: unknown[], exclude: unknown[]) =>
      checkSegment({ name: 'Nobody', include, exclude }).ok
    // Anyone who spent money placed an order.
    expect(
      nobody(
        [{ kind: 'spent', atLeast: 500, withinDays: 365 }],
        [{ kind: 'purchased', atLeast: 1, withinDays: null }]
      )
    ).toBe(false)
    expect(
      nobody(
        [{ kind: 'spent', atLeast: 500, withinDays: 365 }],
        [{ kind: 'spent', atLeast: 100, withinDays: null }]
      )
    ).toBe(false)
    // Two exclusions that together cover everyone.
    expect(
      nobody(
        [{ kind: 'engaged', action: 'opened', withinDays: 90 }],
        [
          { kind: 'purchased', atLeast: 1, withinDays: 90 },
          { kind: 'not_purchased', withinDays: 90 }
        ]
      )
    ).toBe(false)
    // Countries: what is left after every country rule.
    expect(
      nobody(
        [{ kind: 'country', countries: ['US', 'CA'] }],
        [
          { kind: 'country', countries: ['US'] },
          { kind: 'country', countries: ['CA'] }
        ]
      )
    ).toBe(false)
    expect(
      nobody(
        [
          { kind: 'country', countries: ['US', 'CA'] },
          { kind: 'country', countries: ['CA', 'GB'] },
          { kind: 'country', countries: ['GB', 'US'] }
        ],
        []
      )
    ).toBe(false)
    // Never ordered, and ordered at some time, cannot both hold.
    expect(
      nobody(
        [
          { kind: 'not_purchased', withinDays: null },
          { kind: 'purchased', atLeast: 1, withinDays: null }
        ],
        []
      )
    ).toBe(false)
    // A first-order segment: people who never ordered.
    expect(
      checkSegment({
        name: 'Never ordered',
        include: [
          { kind: 'engaged', action: 'opened', withinDays: 90 },
          { kind: 'not_purchased', withinDays: null }
        ],
        exclude: []
      })
    ).toMatchObject({ ok: true })
  })

  it('takes real country codes only, and names them well', () => {
    for (const code of ['UK', 'EU', 'ZZ', 'XX', 'EZ'])
      expect(
        checkSegment({
          ...vip,
          include: [...vip.include, { kind: 'country', countries: [code] }]
        }).ok,
        code
      ).toBe(false)
    expect(
      describeSegment({
        name: 'Abroad',
        include: [{ kind: 'country', countries: ['US', 'GB', 'NL'] }],
        exclude: []
      })
    ).toBe(
      'People who live in the United States, the United Kingdom or the Netherlands.'
    )
  })

  it('lists the Klaviyo data a segment reads, and what an account lacks', () => {
    expect(segmentNeeds(vip)).toEqual([
      { metric: 'Opened Email' },
      { metric: 'Clicked Email' },
      { metric: 'Placed Order' },
      { profile: 'subscribed_at' }
    ])
    expect(missingMetrics(vip, ['Opened Email', 'Clicked Email'])).toEqual([
      'Placed Order'
    ])
    // "Opened or clicked" works with either metric.
    expect(
      missingMetrics(defaultEngagedSegment({ engaged90: 5000, list: 10000 }), [
        'Opened Email',
        'Placed Order'
      ])
    ).toEqual([])
    expect(
      missingMetrics(
        defaultEngagedSegment({ engaged90: 5000, list: 10000 }),
        []
      )
    ).toEqual(['Opened Email', 'Clicked Email'])
    expect(
      segmentNeeds({
        name: 'Clickers abroad',
        include: [
          { kind: 'engaged', action: 'clicked', withinDays: 30 },
          { kind: 'country', countries: ['DE'] }
        ],
        exclude: []
      })
    ).toEqual([{ metric: 'Clicked Email' }, { profile: 'country' }])
  })

  it('picks the safe default: engaged 90 days, or 180 for a small group', () => {
    expect(defaultEngagedSegment({ engaged90: 4000, list: 10000 })).toEqual({
      name: 'Engaged 90 days',
      include: [
        { kind: 'engaged', action: 'opened_or_clicked', withinDays: 90 }
      ],
      exclude: []
    })
    expect(defaultEngagedSegment({ engaged90: 900, list: 2000 }).name).toBe(
      'Engaged 180 days'
    )
    expect(defaultEngagedSegment({ engaged90: 1500, list: 10000 }).name).toBe(
      'Engaged 180 days'
    )
    expect(defaultEngagedSegment({ engaged90: null, list: null }).name).toBe(
      'Engaged 90 days'
    )
    // Exactly 1,000 people and exactly 20% keep 90 (VISION: under either).
    expect(defaultEngagedSegment({ engaged90: 1000, list: 5000 }).name).toBe(
      'Engaged 90 days'
    )
    expect(
      checkSegment(defaultEngagedSegment({ engaged90: 1, list: 1 })).ok
    ).toBe(true)
  })
})
