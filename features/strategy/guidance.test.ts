// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import type { ResultLine } from '@/features/results/read-model'
import {
  competitorFacts,
  goalGuidance,
  offersThatFit,
  planGuidance
} from './guidance'

const tenantId = '00000000-0000-4000-8000-000000000101'
let n = 0
const line = (
  sentAt: string,
  revenue: number | null,
  over: Partial<ResultLine> = {}
): ResultLine =>
  ({
    buildId: `b${++n}`,
    subject: null,
    plannedDay: null,
    emailType: 'story',
    status: 'sent',
    statusText: 'Sent',
    sentAt,
    final: true,
    complete: true,
    sample: false,
    totals: {
      recipients: 1000,
      opens: 400,
      clicks: 20,
      orders: revenue === null ? null : 3,
      revenue,
      openRate: 0.4,
      clickRate: 0.02
    },
    ab: null,
    topSection: null,
    ...over
  }) as ResultLine
const facts = (
  sentAt: string,
  offer: { kind: string; value: number | null; code: string | null } = {
    kind: 'none',
    value: null,
    code: null
  }
) => ({
  facts: {
    version: 2,
    subject: 'New in',
    preview: null,
    offer,
    angle: 'launch',
    cta: 'Shop',
    sentAt,
    blockSequence: ['header_logo', 'hero_image'],
    textRatio: 0.3,
    sections: 4
  }
})
// Sunday 15 November 2026, 07:00 in New York.
const now = Date.parse('2026-11-15T12:00:00Z')

describe('the plan’s guidance from the workspace’s own data (PICK-WIRE)', () => {
  it('fits offers by the plan’s own rules: none at 2 a week or without offers', () => {
    expect(offersThatFit(2, 3)).toBe(0)
    expect(offersThatFit(3, 3)).toBe(2)
    expect(offersThatFit(4, 3)).toBe(2)
    expect(offersThatFit(4, 0)).toBe(0)
  })

  it('works the month’s goal back to emails from the Results lines (#33)', () => {
    const lines = [
      line('2026-10-20T15:00:00Z', 1400),
      line('2026-11-03T15:00:00Z', 1600),
      line('2026-11-10T15:00:00Z', 6000)
    ]
    const goals = goalGuidance({
      goals: [
        {
          month: '2026-11-01',
          goal: { month: '2026-11-01', amount: 20_000, currency: 'USD' }
        },
        { month: '2026-12-01', goal: null }
      ],
      lines,
      capped: false,
      today: '2026-11-15',
      timezone: 'America/New_York',
      currency: 'USD',
      sendsPerWeek: 3
    })
    expect(goals).toEqual([
      {
        month: '2026-11-01',
        label: 'November 2026',
        sentence: expect.stringMatching(
          /^\$12,400 still needed by 30 November/
        ),
        emailsNeeded: 5,
        emailsPossible: 6,
        needsStrongerEmails: false,
        pace: 'on_track'
      }
    ])
  })

  it('names the followed brands’ timing and offers with dates, never their codes (#48, #49)', () => {
    const tuesdays = [
      '2026-11-10T14:00:00Z',
      '2026-11-03T14:00:00Z',
      '2026-10-27T13:00:00Z',
      '2026-10-20T13:00:00Z'
    ]
    const found = competitorFacts(
      [
        {
          label: 'Glow Co',
          rows: tuesdays.map((at, i) =>
            facts(
              at,
              i < 2
                ? { kind: 'percent', value: 20, code: 'GLOW20' }
                : { kind: 'none', value: null, code: null }
            )
          )
        },
        { label: 'Quiet Brand', rows: [] }
      ],
      { now, timezone: 'America/New_York' }
    )
    // A brand with no emails yet says nothing.
    expect(found.map((f) => f.id)).toEqual([
      'competitor-times:0',
      'competitor-offers:0'
    ])
    expect(found[0]!.fact).toMatch(
      /^Glow Co sent 4 emails in the 90 days to 15 Nov 2026, about [\d.]+ a week, most often on Tue around 09:00 your store’s time\.$/
    )
    expect(found[1]!.fact).toMatch(
      /^Glow Co ran an offer in 2 of the 4 weeks from \d{1,2} \w{3} 2026 to 15 Nov 2026, usually up to 20% off\.$/
    )
    expect(JSON.stringify(found)).not.toContain('GLOW20')
    expect(competitorFacts([], { now, timezone: 'Not/AZone' })).toEqual([])
  })

  it('reads each part for the run’s workspace only, and leaves out what it cannot read', async () => {
    const asked: unknown[][] = []
    const answers: Record<string, { data: unknown; error: unknown }> = {
      klaviyo_email_results: { data: [], error: null },
      revenue_goals: {
        data: [
          {
            month: '2026-11-01',
            amount: 20000,
            currency: 'USD',
            revision: 1
          }
        ],
        error: null
      },
      catalog_status: { data: { currency: 'USD' }, error: null },
      competitor_subscriptions: {
        data: [{ capture_id: 'cap-1', label: 'Glow Co' }],
        error: null
      },
      competitor_emails: {
        data: [facts('2026-11-10T14:00:00Z')],
        error: null
      }
    }
    const db = {
      from: (table: string) => {
        const answer = async () =>
          answers[table] ?? { data: null, error: { code: 'XX000' } }
        const chain = {
          select: () => chain,
          eq: (...a: unknown[]) => (asked.push([table, ...a]), chain),
          in: answer,
          not: () => chain,
          gte: () => chain,
          order: () => chain,
          limit: answer,
          maybeSingle: answer
        }
        return chain
      }
    } as never
    const guidance = await planGuidance(db, {
      tenantId,
      start: '2026-11-16',
      timezone: 'America/New_York',
      sendsPerWeek: 3,
      offers: 2,
      now
    })
    // No history: the goal cannot be worked back yet, said so plainly.
    expect(guidance.goals).toEqual([
      expect.objectContaining({ month: '2026-11-01', pace: 'unknown' })
    ])
    expect(guidance.mix).toEqual({
      counts: { offer: 2, story: 1, education: 1, product: 2 },
      basis: 'default'
    })
    expect(guidance.competitors?.[0]?.id).toBe('competitor-times:0')
    for (const table of [
      'klaviyo_email_results',
      'revenue_goals',
      'catalog_status',
      'competitor_subscriptions'
    ])
      expect(asked).toContainEqual([table, 'tenant_id', tenantId])
    expect(asked).toContainEqual(['competitor_emails', 'capture_id', 'cap-1'])

    // Nothing readable: no guidance, and no throw.
    const broken = {
      from: () => {
        throw new Error('down')
      }
    } as never
    expect(
      await planGuidance(broken, {
        tenantId,
        start: '2026-11-16',
        timezone: 'America/New_York',
        sendsPerWeek: 3,
        offers: 0,
        now
      })
    ).toEqual({})
  })
})
