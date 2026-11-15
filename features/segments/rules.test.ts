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
      'People who opened or clicked an email in the last 90 days, and placed at least 2 orders in the last 180 days, but not people who joined in the last 7 days.'
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
      'People who spent at least A$500 ever, and live in Australia or New Zealand, but not people who have not ordered in the last 365 days.'
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
        '“placed an order in the last 90 days” and “have not ordered in the last 180 days” cannot both be true, so nobody matches.'
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

  it('warns when a segment is close to everyone', () => {
    expect(
      checkSegment({
        name: 'Australia',
        include: [{ kind: 'country', countries: ['AU'] }],
        exclude: []
      })
    ).toMatchObject({
      ok: true,
      warnings: [
        'This segment has no engagement, purchase or sign-up rule, so it is close to everyone on the list.'
      ]
    })
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
    expect(
      checkSegment(defaultEngagedSegment({ engaged90: 1, list: 1 })).ok
    ).toBe(true)
  })
})
