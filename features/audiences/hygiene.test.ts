import { describe, expect, it } from 'vitest'
import type { ProfileFacts } from '@/lib/providers/klaviyo-read'
import { sampleKlaviyoSnapshot } from '@/lib/providers/fake-klaviyo-read'
import {
  hygieneDefinitionOk,
  hygieneFingerprint,
  hygieneSegmentDefinition,
  hygieneSegmentName,
  hygieneSegmentNamePattern,
  isHygieneSegmentCreate,
  privacyOpenProperty,
  sameDefinition
} from '@/lib/providers/klaviyo/hygiene-segment'
import {
  countHygiene,
  hygieneCountWords,
  hygieneDefaults,
  hygieneRule,
  hygieneRuleKey,
  hygieneRuleLines,
  hygieneSpec,
  judge,
  privacyOpenFilterProven,
  type HygieneRule
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
/** The rule as it will be once Apple privacy opens are proven. */
const proven: HygieneRule = { ...rule, countPrivacyOpens: false }

describe('the hygiene rule as data', () => {
  it('defaults to on, 180 days, every open counting until proven', () => {
    expect(hygieneDefaults).toEqual({ enabled: true, days: 180 })
    expect(privacyOpenFilterProven).toBe(false)
    expect(rule).toMatchObject({
      version: 1,
      enabled: true,
      days: 180,
      recentOrderDays: 180,
      minEmails: 5,
      countPrivacyOpens: true,
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
      'Left out: people who bounced or are suppressed, and people with no clicks, opens, site visits or orders in 180 days.',
      'Always kept: anyone who ordered in the last 180 days, and anyone too new to judge or sent fewer than 5 emails (flow emails count too).',
      'Every open counts for now, Apple Mail’s automatic opens too.'
    ])
    expect(hygieneRuleLines(proven)[2]).toBe(
      'Apple Mail’s automatic opens do not count as opens.'
    )
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
    const short = hygieneRule({ enabled: true, days: 60 })
    expect(judge(asleep({ lastOrder: ago(150) }), short, now).why).toBe(
      'recent_order'
    )
    expect(judge(asleep({ lastOrder: ago(200) }), rule, now).out).toBe(true)
  })

  it('counts Apple Mail privacy opens until the filter is proven', () => {
    // Today: an automatic open keeps the person (when in doubt, keep).
    expect(judge(asleep({ lastPrivacyOpen: ago(2) }), rule, now)).toEqual({
      out: false,
      why: 'engaged'
    })
    // Once proven: only privacy opens is out; a real open keeps.
    expect(judge(asleep({ lastPrivacyOpen: ago(2) }), proven, now)).toEqual({
      out: true,
      why: 'unengaged'
    })
    expect(judge(asleep({ lastOpen: ago(30) }), proven, now).why).toBe(
      'engaged'
    )
  })

  it('keeps people whose clicks, opens, orders or emails are unknown', () => {
    for (const over of [
      { lastClick: 'unknown' },
      { lastOpen: 'unknown' },
      { lastPrivacyOpen: 'unknown' },
      { lastOrder: 'unknown' },
      { firstEmail: 'unknown' },
      { emails: 'unknown' },
      { lastClick: 'not a time' }
    ] as Partial<ProfileFacts>[])
      expect(judge(asleep(over), rule, now)).toEqual({
        out: false,
        why: 'unknown'
      })
  })

  it('judges a store without site tracking without site visits', () => {
    expect(judge(asleep({ lastSiteVisit: 'unknown' }), rule, now)).toEqual({
      out: true,
      why: 'unengaged'
    })
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
        { facts: asleep({ suppression: 'hard_bounce' }), count: 310 },
        {
          facts: asleep({ suppression: 'unsubscribed', lastOrder: ago(3) }),
          count: 40
        },
        { facts: asleep(), count: 540 },
        { facts: asleep({ lastPrivacyOpen: ago(5) }), count: 390 },
        { facts: asleep({ lastOrder: ago(30) }), count: 410 },
        { facts: asleep({ emails: 'unknown' }), count: 180 },
        { facts: asleep({ lastClick: ago(10) }), count: 6000 },
        { facts: asleep(), count: -5 },
        { facts: asleep(), count: 1.5 }
      ],
      rule,
      now
    )
    expect(counts).toEqual({
      total: 7870,
      reachable: 6980,
      leftOut: 890,
      bounced: 310,
      suppressed: 40,
      unengaged: 540,
      keptUnsure: 180,
      keptRecentOrder: 410
    })
    expect(counts.reachable + counts.leftOut).toBe(counts.total)
    expect(hygieneCountWords(counts, rule)).toBe(
      '890 people left out: 310 bounced, 40 unsubscribed or blocked, 540 with no clicks, opens, site visits or orders in 180 days'
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

  it('counts the sample store', () => {
    const snapshot = sampleKlaviyoSnapshot({ now, timezone: 'UTC' })
    const counts = countHygiene(snapshot.profileGroups ?? [], rule, now)
    expect(counts.total).toBe(snapshot.activeSubscribers.count)
    expect(hygieneCountWords(counts, rule)).toBe(
      '850 people left out: 310 bounced, 540 with no clicks, opens, site visits or orders in 180 days'
    )
    const longer = hygieneRule({ enabled: true, days: 365 })
    expect(
      countHygiene(snapshot.profileGroups ?? [], longer, now).unengaged
    ).toBeLessThan(counts.unengaged)
  })
})

/** A definition to change in tests. */
type Cond = Record<string, unknown> & {
  measurement_filter: Record<string, unknown>
  timeframe_filter: Record<string, unknown>
}
type Def = { condition_groups: { conditions: Cond[] }[]; extra?: unknown }

describe('the Klaviyo segment for the rule', () => {
  const metrics = {
    receivedEmail: 'MRecv',
    clickedEmail: 'MClick',
    openedEmail: 'MOpen',
    activeOnSite: ['MSite', 'MSiteApi'],
    placedOrders: ['MOrdShop', 'MOrdApi'],
    complete: true
  }
  const specOf = (r: HygieneRule = rule, m = metrics) => {
    const planned = hygieneSpec(r, m)
    if (!('spec' in planned)) throw new Error(planned.none)
    return planned.spec
  }

  it('makes no segment when a keep-signal is missing or the read is unsure', () => {
    expect(hygieneSpec(rule, { ...metrics, complete: false })).toEqual({
      none: 'metrics_unread'
    })
    expect(hygieneSpec(rule, { ...metrics, placedOrders: [] })).toEqual({
      none: 'no_order_metric'
    })
    for (const missing of ['receivedEmail', 'clickedEmail', 'openedEmail'])
      expect(hygieneSpec(rule, { ...metrics, [missing]: null })).toEqual({
        none: 'no_email_metrics'
      })
  })

  it('has a neutral, unique name per rule and metrics', () => {
    const spec = specOf()
    const name = hygieneSegmentName(spec)
    expect(name).toMatch(/^List hygiene · 180 days · v1 · [a-f0-9]{8}$/)
    expect(name).not.toMatch(/GROS/)
    expect(hygieneSegmentNamePattern.test(name)).toBe(true)
    expect(
      hygieneSegmentName(specOf(hygieneRule({ enabled: true, days: 90 })))
    ).not.toBe(name)
    // Other metrics, another segment; the order they come in does not matter.
    expect(
      hygieneFingerprint(
        specOf(rule, { ...metrics, placedOrders: ['MOrdShop'] })
      )
    ).not.toBe(hygieneFingerprint(spec))
    expect(
      hygieneFingerprint(
        specOf(rule, { ...metrics, placedOrders: ['MOrdApi', 'MOrdShop'] })
      )
    ).toBe(hygieneFingerprint(spec))
    expect(hygieneRuleKey(rule)).toBe('v1-180')
  })

  it('one "no orders" group per Placed Order metric, one per site metric', () => {
    const def = hygieneSegmentDefinition(specOf())!
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
      ['MSiteApi', { type: 'numeric', operator: 'equals', value: 0 }],
      ['MOrdApi', { type: 'numeric', operator: 'equals', value: 0 }],
      ['MOrdShop', { type: 'numeric', operator: 'equals', value: 0 }]
    ])
    expect(groups[0]!.timeframe_filter).toMatchObject({
      operator: 'before',
      quantity: 180
    })
    // Every open counts today: no Apple filter.
    expect(groups[3]!.metric_filters).toBeNull()
    const withFilter = hygieneSegmentDefinition(specOf(proven))!
    expect(withFilter.condition_groups[3]!.conditions[0]).toMatchObject({
      metric_filters: [
        {
          property: privacyOpenProperty,
          filter: { type: 'boolean', operator: 'equals', value: false }
        }
      ]
    })
    expect(hygieneDefinitionOk(def)).toBe(true)
    expect(hygieneDefinitionOk(withFilter)).toBe(true)
  })

  it('the fence lets through only what the app builds', () => {
    const spec = specOf()
    const def = hygieneSegmentDefinition(spec)!
    const body = (attributes: Record<string, unknown>) => ({
      data: { type: 'segment', attributes }
    })
    const name = hygieneSegmentName(spec)
    expect(
      isHygieneSegmentCreate(body({ name, definition: def, is_starred: false }))
    ).toBe(true)
    const swap = (path: (d: Def) => void) => {
      const d = structuredClone(def) as unknown as Def
      path(d)
      return body({ name, definition: d, is_starred: false })
    }
    for (const hostile of [
      body({ name: 'VIP buyers', definition: def, is_starred: false }),
      body({ name, definition: def, is_starred: true }),
      body({ name, definition: def }),
      body({ name, definition: {}, is_starred: false }),
      {
        data: {
          type: 'segment',
          attributes: { name, definition: def, is_starred: false }
        },
        extra: 1
      },
      // Valid name, hostile definitions.
      swap(
        (d) => (d.condition_groups[2]!.conditions[0]!.type = 'profile-property')
      ),
      swap(
        (d) =>
          (d.condition_groups[2]!.conditions[0]!.measurement_filter.operator =
            'less-than')
      ),
      swap(
        (d) =>
          (d.condition_groups[2]!.conditions[0]!.measurement_filter.value = 3)
      ),
      swap(
        (d) =>
          (d.condition_groups[0]!.conditions[0]!.timeframe_filter.operator =
            'alltime')
      ),
      swap(
        (d) =>
          (d.condition_groups[0]!.conditions[0]!.timeframe_filter.quantity = 2)
      ),
      swap((d) =>
        d.condition_groups[0]!.conditions.push(
          d.condition_groups[1]!.conditions[0]!
        )
      ),
      swap(
        (d) =>
          (d.condition_groups[3]!.conditions[0]!.metric_filters = [
            { property: 'x' }
          ])
      ),
      swap((d) => (d.condition_groups[3]!.conditions[0]!.extra = 1)),
      swap((d) => (d.condition_groups = d.condition_groups.slice(0, 3))),
      swap((d) => (d.extra = {}))
    ])
      expect(isHygieneSegmentCreate(hostile)).toBe(false)
  })

  it('the fence refuses shape-valid definitions that are not hygiene', () => {
    const spec = specOf()
    const name = hygieneSegmentName(spec)
    const def = hygieneSegmentDefinition(spec)!
    const ok = (d: unknown) =>
      isHygieneSegmentCreate({
        data: {
          type: 'segment',
          attributes: { name, definition: d, is_starred: false }
        }
      })
    expect(ok(def)).toBe(true)
    const groups = def.condition_groups
    const clone = () => structuredClone(def) as unknown as Def
    // Five copies of "Received at least once before 30 days".
    const copy = structuredClone(
      groups[0]!
    ) as unknown as Def['condition_groups'][number]
    copy.conditions[0]!.timeframe_filter.quantity = 30
    expect(ok({ condition_groups: [copy, copy, copy, copy, copy] })).toBe(false)
    // Orders over fewer than 180 days.
    const short = clone()
    for (const g of short.condition_groups.slice(-2))
      g.conditions[0]!.timeframe_filter.quantity = 60
    expect(ok(short)).toBe(false)
    // One metric used twice (clicks counted as opens).
    const twice = clone()
    twice.condition_groups[3]!.conditions[0]!.metric_id = 'MClick'
    expect(ok(twice)).toBe(false)
    // The received metric as an order metric.
    const reused = clone()
    reused.condition_groups.at(-1)!.conditions[0]!.metric_id = 'MRecv'
    expect(ok(reused)).toBe(false)
    // Clicks at least once instead of none.
    const clicks = clone()
    clicks.condition_groups[2]!.conditions[0]!.measurement_filter.operator =
      'greater-than-or-equal'
    clicks.condition_groups[2]!.conditions[0]!.measurement_filter.value = 1
    expect(ok(clicks)).toBe(false)
    // An order group (180 days) moved in front of the clicks (90 days).
    // At 180 days both look alike and the groups all hold together anyway.
    const spec90 = specOf(hygieneRule({ enabled: true, days: 90 }))
    const days90 = hygieneSegmentDefinition(spec90)!
    const ok90 = (d: unknown) =>
      isHygieneSegmentCreate({
        data: {
          type: 'segment',
          attributes: {
            name: hygieneSegmentName(spec90),
            definition: d,
            is_starred: false
          }
        }
      })
    expect(ok90(days90)).toBe(true)
    const moved = structuredClone(days90) as unknown as Def
    const order = moved.condition_groups.pop()!
    moved.condition_groups.splice(2, 0, order)
    expect(ok90(moved)).toBe(false)
    // No order group at all (sites only, in the window).
    expect(ok({ condition_groups: days90.condition_groups.slice(0, 6) })).toBe(
      false
    )
    // A key inherited, not its own.
    const inherited = Object.create({ type: 'segment' })
    inherited.attributes = { name, definition: def, is_starred: false }
    expect(isHygieneSegmentCreate({ data: inherited })).toBe(false)
  })

  it('a segment Klaviyo shows is ours only when its definition is the same', () => {
    const def = hygieneSegmentDefinition(specOf())!
    const shown = structuredClone(def) as unknown as Def
    // Key order and a missing `metric_filters` do not matter.
    delete shown.condition_groups[2]!.conditions[0]!.metric_filters
    shown.condition_groups[2]!.conditions[0] = Object.fromEntries(
      Object.entries(shown.condition_groups[2]!.conditions[0]!).reverse()
    ) as Cond
    expect(sameDefinition(shown, def)).toBe(true)
    shown.condition_groups[2]!.conditions[0]!.measurement_filter.value = 1
    expect(sameDefinition(shown, def)).toBe(false)
    expect(sameDefinition({}, def)).toBe(false)
    expect(sameDefinition(null, def)).toBe(false)
  })
})
