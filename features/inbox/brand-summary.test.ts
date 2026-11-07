// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { brandSummary, trackedSummaries } from './brand-summary'
import type { EmailFacts } from './facts'

const now = Date.parse('2026-11-07T12:00:00Z')
const facts = (over: Partial<EmailFacts>): EmailFacts => ({
  version: 1,
  subject: 'Subject',
  preview: null,
  offer: { kind: 'none', value: null, code: null },
  angle: 'launch',
  cta: 'Shop now',
  // A Tuesday, 15:00 UTC.
  sentAt: '2026-11-03T15:00:00.000Z',
  blockSequence: [
    'announcement_bar',
    'header_logo',
    'hero_image',
    'text',
    'cta'
  ],
  textRatio: 0.5,
  sections: 5,
  ...over
})

describe('brandSummary', () => {
  it('summarises how often, what kind, offers, layout and when', () => {
    const s = brandSummary(
      [
        { facts: facts({ offer: { kind: 'percent', value: 20, code: 'A' } }) },
        {
          facts: facts({
            offer: { kind: 'percent', value: 30, code: null },
            angle: 'sale'
          })
        },
        { facts: facts({ textRatio: 1 }) },
        { facts: facts({ sentAt: '2026-10-27T15:00:00.000Z' }) }
      ],
      { now, timezone: 'Asia/Kathmandu' }
    )
    expect(s).toMatchObject({
      emails: 4,
      windowDays: 90,
      // 4 emails in the 11 days since the first one, not over 90 days.
      perWeek: 2.6,
      discount: { share: 0.5, typicalPercent: 20 },
      textRatio: 0.63,
      // 15:00 UTC is 20:45 in Kathmandu: the hour there is 20.
      sends: { day: 'Tuesday', hour: 20 }
    })
    expect(s!.angles[0]).toEqual({ angle: 'launch', count: 3, share: 0.75 })
  })

  it('weighs a repeated pattern above a one-off', () => {
    const s = brandSummary(
      [
        { facts: facts({}) },
        { facts: facts({}) },
        { facts: facts({}) },
        { facts: facts({ angle: 'story', blockSequence: ['founder_note'] }) }
      ],
      { now, timezone: 'UTC' }
    )!
    expect(s.patterns[0]).toMatchObject({
      angle: 'launch',
      offer: 'none',
      opening: ['hero_image', 'text', 'cta'],
      count: 3,
      weight: 0.75,
      repeated: true
    })
    expect(s.patterns[1]).toMatchObject({
      angle: 'story',
      count: 1,
      weight: 0.25,
      repeated: false
    })
  })

  it('counts a week at least, and names a send time only once it repeats', () => {
    const one = brandSummary(
      [{ facts: facts({ sentAt: '2026-11-06T09:00:00.000Z' }) }],
      {
        now,
        timezone: 'UTC'
      }
    )!
    expect(one.perWeek).toBe(1)
    expect(one.sends).toBeNull()
    const two = brandSummary(
      [
        { facts: facts({ sentAt: '2026-11-06T09:10:00.000Z' }) },
        { facts: facts({ sentAt: '2026-10-30T09:40:00.000Z' }) }
      ],
      { now, timezone: 'UTC' }
    )!
    expect(two.sends).toEqual({ day: 'Friday', hour: 9 })
  })

  it('builds the summaries of the brands a workspace follows, sample ones marked', () => {
    expect(
      trackedSummaries(
        [
          { domain: 'northwind.example', label: 'Northwind', sample: true },
          { domain: 'quiet.example', label: 'Quiet', sample: true }
        ],
        { 'northwind.example': [{ facts: facts({}) }] },
        { now, timezone: 'UTC' }
      ).map((t) => [t.domain, t.sample, t.summary.emails])
    ).toEqual([['northwind.example', true, 1]])
  })

  it('reads only the last 90 days and skips broken or older facts', () => {
    expect(
      brandSummary(
        [
          { facts: facts({ sentAt: '2026-06-01T00:00:00.000Z' }) },
          { facts: { version: 1, angle: 'nonsense' } },
          { facts: null }
        ],
        { now, timezone: 'UTC' }
      )
    ).toBeNull()
  })
})
