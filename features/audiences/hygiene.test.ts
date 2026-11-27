import { describe, expect, it } from 'vitest'
import type { ProfileFacts } from '@/lib/providers/klaviyo-read'
import { sampleKlaviyoSnapshot } from '@/lib/providers/fake-klaviyo-read'
import {
  countHygiene,
  hygieneCountWords,
  hygieneDefaults,
  hygieneRule,
  hygieneRuleKey,
  hygieneRuleLines,
  hygieneSegmentDefinition,
  hygieneSegmentName,
  hygieneSegmentNamePattern,
  judge,
  privacyOpenProperty
} from './hygiene'

const now = new Date('2026-11-27T12:00:00Z')
const ago = (days: number) =>
  new Date(now.getTime() - days * 86_400_000).toISOString()
/** Weekly emails, newest first, for `weeks` weeks. */
const weekly = (weeks: number) =>
  Array.from({ length: weeks }, (_, i) => ago(3 + i * 7))

/** Someone on the list for a year, emailed weekly, who never did anything. */
const asleep = (over: Partial<ProfileFacts> = {}): ProfileFacts => ({
  suppression: null,
  firstEmail: ago(400),
  emails: weekly(52),
  lastClick: 'never',
  lastOpen: 'never',
  lastPrivacyOpen: 'never',
  lastSiteVisit: 'never',
  lastOrder: 'never',
  ...over
})
const rule = hygieneRule()

describe('the hygiene rule as data', () => {
  it('defaults to on, 180 days, with orders kept for at least 180 days', () => {
    expect(hygieneDefaults).toEqual({ enabled: true, days: 180 })
    expect(rule).toMatchObject({
      version: 1,
      enabled: true,
      days: 180,
      recentOrderDays: 180,
      minEmails: 5,
      engagedBy: ['click', 'open', 'site_visit', 'order']
    })
    expect(hygieneRule({ enabled: true, days: 90 }).recentOrderDays).toBe(180)
    expect(hygieneRule({ enabled: true, days: 365 }).recentOrderDays).toBe(365)
  })

  it('falls back to the default for settings outside the bounds', () => {
    for (const days of [0, 29, 731, 1.5, Number.NaN])
      expect(hygieneRule({ enabled: true, days }).days).toBe(180)
    expect(hygieneRule({ enabled: false, days: 30 })).toMatchObject({
      enabled: false,
      days: 30
    })
  })

  it('says the rule in plain words', () => {
    expect(hygieneRuleLines(rule)).toEqual([
      'Left out: people who bounced or are suppressed, and people with no clicks, site visits or orders in 180 days.',
      'Always kept: anyone who ordered in the last 180 days, and anyone too new to judge.',
      'Apple Mail privacy opens do not count as opens.'
    ])
    expect(
      hygieneRuleLines(hygieneRule({ enabled: false, days: 180 }))[0]
    ).toBe('Off: GROS plans for everyone Klaviyo can email.')
  })
})

describe('judge', () => {
  it('leaves out someone with no engagement in 180 days', () => {
    expect(judge(asleep(), rule, now)).toEqual({ out: true, why: 'unengaged' })
    expect(judge(asleep({ lastClick: ago(181) }), rule, now).out).toBe(true)
  })

  it('keeps a recent buyer with no opens or clicks', () => {
    expect(judge(asleep({ lastOrder: ago(20) }), rule, now)).toEqual({
      out: false,
      why: 'recent_order'
    })
    // With a shorter window the order still keeps them for 180 days.
    const short = hygieneRule({ enabled: true, days: 60 })
    expect(judge(asleep({ lastOrder: ago(150) }), short, now).why).toBe(
      'recent_order'
    )
    expect(judge(asleep({ lastOrder: ago(200) }), rule, now).out).toBe(true)
  })

  it('never counts Apple Mail privacy opens as engagement', () => {
    expect(judge(asleep({ lastPrivacyOpen: ago(2) }), rule, now)).toEqual({
      out: true,
      why: 'unengaged'
    })
    // A real open keeps them, even without a click.
    expect(judge(asleep({ lastOpen: ago(30) }), rule, now).why).toBe('engaged')
  })

  it('keeps people whose clicks, opens or emails are unknown', () => {
    for (const over of [
      { lastClick: 'unknown' },
      { lastOpen: 'unknown' },
      { firstEmail: 'unknown' },
      { emails: 'unknown' },
      { lastClick: 'not a time' }
    ] as Partial<ProfileFacts>[])
      expect(judge(asleep(over), rule, now)).toEqual({
        out: false,
        why: 'unknown'
      })
  })

  it('judges a store without site or order data on clicks and opens', () => {
    expect(
      judge(
        asleep({ lastSiteVisit: 'unknown', lastOrder: 'unknown' }),
        rule,
        now
      )
    ).toEqual({ out: true, why: 'unengaged' })
    expect(judge(asleep({ lastSiteVisit: ago(9) }), rule, now).why).toBe(
      'engaged'
    )
  })

  it('keeps someone too new or emailed too little to judge', () => {
    expect(judge(asleep({ firstEmail: ago(100) }), rule, now).why).toBe('new')
    expect(
      judge(asleep({ firstEmail: 'never', emails: [] }), rule, now).why
    ).toBe('new')
    expect(
      judge(
        asleep({ emails: [ago(10), ago(40), ago(70), ago(300)] }),
        rule,
        now
      )
    ).toEqual({ out: false, why: 'few_emails' })
  })

  it('leaves out bounced and suppressed people, even with hygiene off', () => {
    const off = hygieneRule({ enabled: false, days: 180 })
    expect(judge(asleep({ suppression: 'hard_bounce' }), rule, now)).toEqual({
      out: true,
      why: 'bounced'
    })
    expect(
      judge(
        asleep({ suppression: 'invalid_email', lastClick: ago(1) }),
        off,
        now
      )
    ).toEqual({ out: true, why: 'bounced' })
    expect(judge(asleep({ suppression: 'spam_complaint' }), off, now)).toEqual({
      out: true,
      why: 'suppressed'
    })
    expect(judge(asleep(), off, now)).toEqual({
      out: false,
      why: 'hygiene_off'
    })
  })
})

describe('countHygiene', () => {
  it('counts each person once and never a suppressed one as reachable', () => {
    const counts = countHygiene(
      [
        // Bounced and unengaged: counted once, as bounced.
        { facts: asleep({ suppression: 'hard_bounce' }), count: 310 },
        // A recent buyer who is also suppressed: still out.
        {
          facts: asleep({ suppression: 'unsubscribed', lastOrder: ago(3) }),
          count: 40
        },
        { facts: asleep(), count: 540 },
        { facts: asleep({ lastPrivacyOpen: ago(5) }), count: 390 },
        { facts: asleep({ lastOrder: ago(30) }), count: 410 },
        { facts: asleep({ emails: 'unknown' }), count: 180 },
        { facts: asleep({ lastClick: ago(10) }), count: 6000 },
        // Broken counts are ignored.
        { facts: asleep(), count: -5 },
        { facts: asleep(), count: 1.5 }
      ],
      rule,
      now
    )
    expect(counts).toEqual({
      total: 7870,
      reachable: 6590,
      leftOut: 1280,
      bounced: 310,
      suppressed: 40,
      unengaged: 930,
      keptUnsure: 180,
      keptRecentOrder: 410
    })
    expect(counts.reachable + counts.leftOut).toBe(counts.total)
    expect(hygieneCountWords(counts, rule)).toBe(
      '1,280 people left out: 310 bounced, 40 unsubscribed or blocked, 930 with no clicks, site visits or orders in 180 days'
    )
  })

  it('with hygiene off only bounced and suppressed people are out', () => {
    const off = hygieneRule({ enabled: false, days: 180 })
    const counts = countHygiene(
      [
        { facts: asleep({ suppression: 'hard_bounce' }), count: 3 },
        { facts: asleep(), count: 7 }
      ],
      off,
      now
    )
    expect(counts).toMatchObject({ leftOut: 3, reachable: 7, unengaged: 0 })
    expect(hygieneCountWords(counts, off)).toBe('3 people left out: 3 bounced')
    expect(
      hygieneCountWords(
        countHygiene([{ facts: asleep(), count: 1 }], off, now),
        off
      )
    ).toBe('Nobody is left out.')
  })

  it('counts the sample store as a non-developer would expect', () => {
    const snapshot = sampleKlaviyoSnapshot({ now, timezone: 'UTC' })
    const counts = countHygiene(snapshot.profileGroups ?? [], rule, now)
    expect(counts.total).toBe(snapshot.activeSubscribers.count)
    expect(hygieneCountWords(counts, rule)).toBe(
      '1,240 people left out: 310 bounced, 930 with no clicks, site visits or orders in 180 days'
    )
    // A longer window leaves fewer people out.
    const longer = hygieneRule({ enabled: true, days: 365 })
    expect(
      countHygiene(snapshot.profileGroups ?? [], longer, now).unengaged
    ).toBeLessThan(counts.unengaged)
  })
})

describe('the Klaviyo segment for the rule', () => {
  const metrics = {
    receivedEmail: 'MRecv',
    clickedEmail: 'MClick',
    openedEmail: 'MOpen',
    activeOnSite: 'MSite',
    placedOrder: 'MOrder'
  }

  it('has one name and key per rule, which the client accepts', () => {
    expect(hygieneSegmentName(rule)).toBe('GROS list hygiene · 180 days · v1')
    expect(hygieneSegmentNamePattern.test(hygieneSegmentName(rule))).toBe(true)
    expect(
      hygieneSegmentName(hygieneRule({ enabled: true, days: 90 }))
    ).not.toBe(hygieneSegmentName(rule))
    expect(hygieneRuleKey(rule)).toBe('v1-180')
    expect(hygieneSegmentNamePattern.test('VIP buyers')).toBe(false)
  })

  it('says the same as the rule: all groups must hold', () => {
    const def = hygieneSegmentDefinition(rule, metrics)!
    const groups = def.condition_groups.map(
      (g) => g.conditions[0] as Record<string, unknown>
    )
    expect(groups.map((g) => [g.metric_id, g.measurement_filter])).toEqual([
      [
        'MRecv',
        { type: 'numeric', operator: 'greater-than-or-equal', value: 1 }
      ],
      [
        'MRecv',
        { type: 'numeric', operator: 'greater-than-or-equal', value: 5 }
      ],
      ['MClick', { type: 'numeric', operator: 'equals', value: 0 }],
      ['MOpen', { type: 'numeric', operator: 'equals', value: 0 }],
      ['MSite', { type: 'numeric', operator: 'equals', value: 0 }],
      ['MOrder', { type: 'numeric', operator: 'equals', value: 0 }]
    ])
    expect(groups[0]!.timeframe_filter).toMatchObject({
      operator: 'before',
      quantity: 180
    })
    expect(groups[3]!.metric_filters).toEqual([
      {
        property: privacyOpenProperty,
        filter: { type: 'boolean', operator: 'equals', value: false }
      }
    ])
  })

  it('skips site and order data a store does not have', () => {
    const def = hygieneSegmentDefinition(rule, {
      ...metrics,
      activeOnSite: null,
      placedOrder: null
    })!
    expect(def.condition_groups).toHaveLength(4)
  })

  it('makes no segment without the email metrics, or with hygiene off', () => {
    for (const missing of ['receivedEmail', 'clickedEmail', 'openedEmail'])
      expect(
        hygieneSegmentDefinition(rule, { ...metrics, [missing]: null })
      ).toBeNull()
    expect(
      hygieneSegmentDefinition(
        hygieneRule({ enabled: false, days: 180 }),
        metrics
      )
    ).toBeNull()
  })
})
