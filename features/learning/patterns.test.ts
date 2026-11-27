import { describe, expect, it } from 'vitest'
import {
  confidenceFor,
  findPatterns,
  minSends,
  planWrites,
  retireAfter,
  ruleKey,
  ruleDays,
  weeklyLearning,
  type SentEmail,
  type StoredRule
} from './patterns'

const tenant = '00000000-0000-4000-8000-000000000101'
const now = Date.parse('2026-11-24T12:00:00Z')
const day = 86_400_000
let n = 0
const sent = (over: Partial<SentEmail>): SentEmail => ({
  buildId: `b${++n}`,
  emailType: 'story',
  sentAt: new Date(now - 10 * day).toISOString(),
  recipients: 1000,
  clicks: 20,
  unsubscribes: 1,
  spamComplaints: 0,
  topBlock: null,
  edited: false,
  ...over
})
const many = (k: number, over: Partial<SentEmail>) =>
  Array.from({ length: k }, () => sent(over))

describe('the Performance analyst (LRN-002, D22)', () => {
  it('finds a kind of email with more clicks, and one with fewer, from three sends on each side', () => {
    const emails = [
      ...many(3, { emailType: 'launch', clicks: 40 }),
      // 22 is within the band of the rest: no pattern.
      ...many(3, { emailType: 'story', clicks: 22 }),
      ...many(3, { emailType: 'education', clicks: 10 })
    ]
    const found = findPatterns(emails, now)
    expect(
      found
        .filter((p) => p.dimension === 'email_type')
        .map((p) => [p.value, p.kind])
    ).toEqual([
      ['education', 'dont'],
      ['launch', 'do']
    ])
    const launch = found.find((p) => p.value === 'launch')!
    expect(launch).toMatchObject({
      rule: "Plan more launch emails: they get more clicks than this brand's other emails.",
      why: 'launch emails: 4 clicks per 100 people over 3 sends, against 1.6 for the other 6.',
      appliesTo: ['brief-writer', 'calendar-planner', 'strategy-critic'],
      confidence: confidenceFor(3)
    })
    expect(launch.evidence).toHaveLength(3)
  })

  it('never learns from sends the owner edited in Klaviyo: not evidence, not counted (PICK-99)', () => {
    const edited = [
      ...many(3, { emailType: 'launch', clicks: 40, edited: true }),
      ...many(3, { emailType: 'story', clicks: 22 }),
      ...many(3, { emailType: 'education', clicks: 10 })
    ]
    const found = findPatterns(edited, now)
    expect(found.some((p) => p.value === 'launch')).toBe(false)
    // Two unedited and one edited: still too few for a rule.
    const mixed = [
      sent({ emailType: 'launch', clicks: 40, edited: true }),
      ...many(2, { emailType: 'launch', clicks: 40 }),
      ...many(3, { emailType: 'story', clicks: 22 }),
      ...many(3, { emailType: 'education', clicks: 10 })
    ]
    expect(findPatterns(mixed, now).some((p) => p.value === 'launch')).toBe(
      false
    )
    const unsubscribing = [
      ...many(3, { emailType: 'offer', unsubscribes: 20, edited: true }),
      ...many(3, { emailType: 'story', unsubscribes: 1 })
    ]
    expect(
      findPatterns(unsubscribing, now).some(
        (p) => p.dimension === 'unsubscribes'
      )
    ).toBe(false)
    for (const p of findPatterns(
      [...edited, ...many(3, { emailType: 'launch', clicks: 40 })],
      now
    ))
      for (const e of p.evidence)
        expect(edited.some((x) => x.edited && x.buildId === e.buildId)).toBe(
          false
        )
  })

  it('needs three sends on each side, enough people, and recent, real sends', () => {
    const two = [
      ...many(minSends - 1, { emailType: 'launch', clicks: 80 }),
      ...many(4, { emailType: 'story' })
    ]
    expect(findPatterns(two, now)).toEqual([])
    const small = [
      ...many(3, { emailType: 'launch', clicks: 80, recipients: 99 }),
      ...many(4, { emailType: 'story' })
    ]
    expect(findPatterns(small, now)).toEqual([])
    const old = [
      ...many(3, {
        emailType: 'launch',
        clicks: 80,
        sentAt: new Date(now - 200 * day).toISOString()
      }),
      ...many(4, { emailType: 'story' })
    ]
    expect(findPatterns(old, now)).toEqual([])
  })

  it('makes a kind people unsubscribe from a don’t, even when it gets clicks (#76)', () => {
    const emails = [
      ...many(3, { emailType: 'offer', clicks: 60, unsubscribes: 8 }),
      ...many(4, { emailType: 'story', clicks: 20, unsubscribes: 1 })
    ]
    const found = findPatterns(emails, now)
    expect(found.map((p) => [p.dimension, p.value, p.kind])).toEqual([
      ['unsubscribes', 'offer', 'dont'],
      ['email_type', 'story', 'dont']
    ])
    // Not unknown counts as 0: a send with no count is left out.
    const unknown = [
      ...many(3, { emailType: 'offer', unsubscribes: null }),
      ...many(4, { emailType: 'story', unsubscribes: 1 })
    ]
    expect(
      findPatterns(unknown, now).filter((p) => p.dimension === 'unsubscribes')
    ).toEqual([])
  })

  it('makes a kind people mark as spam a don’t over 1 in 1,000, even when it gets clicks (#76)', () => {
    // 4 complaints over 3,000 people: 1.3 per 1,000.
    const emails = [
      sent({ emailType: 'offer', clicks: 60, spamComplaints: 2 }),
      sent({ emailType: 'offer', clicks: 60, spamComplaints: 1 }),
      sent({ emailType: 'offer', clicks: 60, spamComplaints: 1 }),
      ...many(4, { emailType: 'story', clicks: 20 })
    ]
    const found = findPatterns(emails, now)
    expect(found.map((p) => [p.dimension, p.value, p.kind])).toEqual([
      ['spam_complaints', 'offer', 'dont'],
      ['email_type', 'story', 'dont']
    ])
    expect(found[0]).toMatchObject({
      rule: "Send fewer offer emails: people mark them as spam, which hurts how all of this brand's emails reach the inbox.",
      why: 'offer emails: 1.3 spam complaints per 1,000 people over 3 sends; inbox providers start to warn at 1 per 1,000.',
      appliesTo: ['brief-writer', 'calendar-planner', 'strategy-critic'],
      confidence: confidenceFor(3)
    })
    expect(found[0]!.evidence).toHaveLength(3)
    // Its key is its own: it never takes the unsubscribe rule's place.
    expect(ruleKey(tenant, found[0]!)).toBe(
      `results:${tenant}:spam_complaints:offer:dont`
    )
  })

  it('needs the rate, three complaints and three counted sends before spam teaches anything (#76)', () => {
    const rest = many(4, { emailType: 'story' })
    // Under 1 in 1,000: 3 complaints over 6,000 people.
    expect(
      findPatterns(
        [
          ...many(3, {
            emailType: 'offer',
            recipients: 2000,
            spamComplaints: 1
          }),
          ...rest
        ],
        now
      ).filter((p) => p.dimension === 'spam_complaints')
    ).toEqual([])
    // Over the rate but only 2 complaints in all (300 people).
    expect(
      findPatterns(
        [
          sent({ emailType: 'offer', recipients: 100, spamComplaints: 1 }),
          sent({ emailType: 'offer', recipients: 100, spamComplaints: 1 }),
          sent({ emailType: 'offer', recipients: 100, spamComplaints: 0 }),
          ...rest
        ],
        now
      ).filter((p) => p.dimension === 'spam_complaints')
    ).toEqual([])
    // An unknown count is left out, never read as 0: two counted sends only.
    expect(
      findPatterns(
        [
          sent({ emailType: 'offer', spamComplaints: 5 }),
          sent({ emailType: 'offer', spamComplaints: 5 }),
          sent({ emailType: 'offer', spamComplaints: null }),
          ...rest
        ],
        now
      ).filter((p) => p.dimension === 'spam_complaints')
    ).toEqual([])
  })

  it('never makes a kind people mark as spam a do, and retires the rule once it fades (#76)', () => {
    const emails = [
      ...many(3, { emailType: 'launch', clicks: 80, spamComplaints: 2 }),
      ...many(4, { emailType: 'story', clicks: 20 })
    ]
    const found = findPatterns(emails, now)
    expect(found.some((p) => p.value === 'launch' && p.kind === 'do')).toBe(
      false
    )
    expect(found.find((p) => p.dimension === 'spam_complaints')?.value).toBe(
      'launch'
    )
    // Six later launch sends with no complaints: the rule is retired.
    const key = `results:${tenant}:spam_complaints:launch:dont`
    const quiet = [
      ...many(retireAfter, { emailType: 'launch', spamComplaints: 0 }),
      ...many(4, { emailType: 'story' })
    ]
    expect(
      planWrites({
        tenantId: tenant,
        patterns: findPatterns(quiet, now),
        stored: [
          { id: 'r1', revision: 2, key, status: 'active', confidence: 0.55 }
        ],
        emails: quiet,
        now
      })
    ).toContainEqual(
      expect.objectContaining({
        op: 'update',
        id: 'r1',
        status: 'retired',
        reason: 'faded'
      })
    )
  })

  it('retires a stored "do" for a kind people now mark as spam or leave over (#76)', () => {
    const spammy = [
      ...many(3, { emailType: 'launch', clicks: 80, spamComplaints: 2 }),
      ...many(4, { emailType: 'story', clicks: 20 })
    ]
    const leaving = [
      ...many(3, { emailType: 'launch', clicks: 80, unsubscribes: 8 }),
      ...many(4, { emailType: 'story', clicks: 20, unsubscribes: 1 })
    ]
    const doKey = `results:${tenant}:email_type:launch:do`
    for (const emails of [spammy, leaving])
      expect(
        planWrites({
          tenantId: tenant,
          patterns: findPatterns(emails, now),
          stored: [
            {
              id: 'do1',
              revision: 4,
              key: doKey,
              status: 'active',
              confidence: 0.7
            }
          ],
          emails,
          now
        })
      ).toContainEqual({
        op: 'update',
        id: 'do1',
        revision: 4,
        status: 'retired',
        confidence: 0.7,
        reason: 'turned'
      })
  })

  it('brings a faded spam "don\'t" back as a new rule when complaints return, unless the owner removed it (#76)', () => {
    const emails = [
      ...many(3, { emailType: 'offer', spamComplaints: 2 }),
      ...many(4, { emailType: 'story' })
    ]
    const key = `results:${tenant}:spam_complaints:offer:dont`
    const write = (stored: Parameters<typeof planWrites>[0]['stored']) =>
      planWrites({
        tenantId: tenant,
        patterns: findPatterns(emails, now),
        stored,
        emails,
        now
      }).filter((w) => w.op === 'add')
    const faded = {
      id: 'r1',
      revision: 3,
      key,
      status: 'retired' as const,
      confidence: 0.55
    }
    expect(write([faded])).toEqual([
      expect.objectContaining({ op: 'add', key: `${key}#2` })
    ])
    // Already back and active: no third one; it is kept as before.
    const back = {
      ...faded,
      id: 'r2',
      key: `${key}#2`,
      status: 'active' as const
    }
    expect(write([faded, back])).toEqual([])
    expect(
      planWrites({
        tenantId: tenant,
        patterns: findPatterns(emails, now),
        stored: [faded, back],
        emails,
        now
      }).filter((w) => w.op === 'update' && w.status === 'retired')
    ).toEqual([])
    // The owner removed it on Learned: it stays removed.
    expect(write([{ ...faded, removedByOwner: true }])).toEqual([])
  })

  it('names the section that gets the most clicks in most emails', () => {
    const emails = [
      ...many(3, { topBlock: 'product_grid_2col' }),
      ...many(1, { topBlock: 'hero_product' }),
      ...many(2, { topBlock: null })
    ]
    expect(findPatterns(emails, now)).toEqual([
      expect.objectContaining({
        dimension: 'top_section',
        value: 'product_grid_2col',
        kind: 'do',
        rule: "Give product grid 2col sections a clear place: they get the most clicks in this brand's emails.",
        appliesTo: ['section-planner', 'art-director']
      })
    ])
    // Not most: no rule.
    expect(
      findPatterns(
        [
          ...many(3, { topBlock: 'product_grid_2col' }),
          ...many(3, { topBlock: 'hero_product' })
        ],
        now
      )
    ).toEqual([])
  })

  it('is surer with more sends, never past 0.9', () => {
    expect(confidenceFor(3)).toBe(0.55)
    expect(confidenceFor(6)).toBe(0.7)
    expect(confidenceFor(40)).toBe(0.9)
  })
})

describe('the Memory writer (LRN-002, D22)', () => {
  const emails = [
    ...many(3, { emailType: 'launch', clicks: 40 }),
    ...many(3, { emailType: 'story', clicks: 20 })
  ]
  const patterns = findPatterns(emails, now)
  const launchKey = ruleKey(tenant, {
    dimension: 'email_type',
    value: 'launch',
    kind: 'do'
  })
  const stored = (over: Partial<StoredRule>): StoredRule => ({
    id: 'r1',
    revision: 1,
    key: launchKey,
    status: 'active',
    confidence: 0.55,
    ...over
  })

  it('adds a new pattern once, with its evidence and an end date', () => {
    const writes = planWrites({
      tenantId: tenant,
      patterns,
      stored: [],
      emails,
      now
    })
    expect(writes).toEqual([
      expect.objectContaining({
        op: 'add',
        key: launchKey,
        expiresAt: new Date(now + ruleDays * day).toISOString()
      }),
      expect.objectContaining({ op: 'add' })
    ])
    // Once: a stored rule with the key, whatever its status, is not added again.
    expect(
      planWrites({
        tenantId: tenant,
        patterns,
        stored: patterns.map((p, i) =>
          stored({
            id: `r${i}`,
            key: ruleKey(tenant, p),
            status: 'retired'
          })
        ),
        emails,
        now
      })
    ).toEqual([])
  })

  it('moves a rule’s confidence with its evidence', () => {
    const more = [
      ...many(6, { emailType: 'launch', clicks: 40 }),
      ...many(3, { emailType: 'story', clicks: 20 })
    ]
    const writes = planWrites({
      tenantId: tenant,
      patterns: findPatterns(more, now),
      stored: [stored({})],
      emails: more,
      now
    })
    expect(writes).toContainEqual({
      op: 'update',
      id: 'r1',
      revision: 1,
      status: 'active',
      confidence: confidenceFor(6),
      reason: 'stronger'
    })
  })

  it('retires a rule whose pattern turned the other way, and one that faded after enough sends', () => {
    const turned = [
      ...many(3, { emailType: 'launch', clicks: 5 }),
      ...many(3, { emailType: 'story', clicks: 20 })
    ]
    expect(
      planWrites({
        tenantId: tenant,
        patterns: findPatterns(turned, now),
        stored: [stored({})],
        emails: turned,
        now
      })
    ).toContainEqual(
      expect.objectContaining({
        op: 'update',
        id: 'r1',
        status: 'retired',
        reason: 'turned'
      })
    )
    const faded = [
      ...many(retireAfter, { emailType: 'launch', clicks: 21 }),
      ...many(3, { emailType: 'story', clicks: 20 })
    ]
    expect(
      planWrites({
        tenantId: tenant,
        patterns: findPatterns(faded, now),
        stored: [stored({})],
        emails: faded,
        now
      })
    ).toContainEqual(
      expect.objectContaining({
        op: 'update',
        status: 'retired',
        reason: 'faded'
      })
    )
    // Faded, but too few sends since: left to expire.
    const early = [
      ...many(retireAfter - 1, { emailType: 'launch', clicks: 21 }),
      ...many(3, { emailType: 'story', clicks: 20 })
    ]
    expect(
      planWrites({
        tenantId: tenant,
        patterns: findPatterns(early, now),
        stored: [stored({})],
        emails: early,
        now
      }).filter((w) => w.op === 'update')
    ).toEqual([])
  })
})

describe('the weekly learning report (#74)', () => {
  const at = (days: number) => new Date(now - days * day).toISOString()
  it('says what was learned this week in plain words', () => {
    expect(
      weeklyLearning(
        [
          {
            kind: 'do',
            rule: 'A',
            status: 'active',
            createdAt: at(1),
            updatedAt: at(1)
          },
          {
            kind: 'do',
            rule: 'B',
            status: 'active',
            createdAt: at(3),
            updatedAt: at(3)
          },
          {
            kind: 'do',
            rule: 'C',
            status: 'active',
            createdAt: at(6),
            updatedAt: at(6)
          },
          {
            kind: 'dont',
            rule: 'D',
            status: 'active',
            createdAt: at(2),
            updatedAt: at(2)
          },
          {
            kind: 'do',
            rule: 'E',
            status: 'retired',
            createdAt: at(30),
            updatedAt: at(2)
          },
          {
            kind: 'do',
            rule: 'F',
            status: 'active',
            createdAt: at(30),
            updatedAt: at(2)
          },
          {
            kind: 'do',
            rule: 'G',
            status: 'active',
            createdAt: at(9),
            updatedAt: at(9)
          }
        ],
        now
      )
    ).toEqual({
      dos: ['A', 'B', 'C'],
      donts: ['D'],
      retired: ['E'],
      summary: "3 new do's, 1 new don't, 1 retired"
    })
    expect(weeklyLearning([], now).summary).toBe(
      'Nothing new learned this week'
    )
  })

  it('never counts a rule the owner removed as one GROS retired', () => {
    expect(
      weeklyLearning(
        [
          {
            kind: 'do',
            rule: 'Removed by the owner',
            status: 'retired',
            createdAt: at(30),
            updatedAt: at(1),
            removedByOwner: true
          },
          {
            kind: 'dont',
            rule: 'Faded',
            status: 'retired',
            createdAt: at(30),
            updatedAt: at(2)
          }
        ],
        now
      )
    ).toMatchObject({ retired: ['Faded'], summary: '1 retired' })
  })
})
