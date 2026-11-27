// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { PlanRun } from './load'
import { dayLabel, fifteenDays, planScreen, timeLabel } from './plan-screen'

const owner = { owner: true }
const staff = { owner: false }

const slot = (date: string, over: Record<string, unknown> = {}) => ({
  date,
  time: '18:00',
  emailType: 'bestseller',
  angle: 'Our best candle for cold evenings.',
  products: [{ id: 'p1', title: 'Cedar candle' }],
  offer: null,
  audience: { id: 'a1', label: 'Past buyers' },
  why: 'It sells most in November.',
  evidence: [{ id: 'e1', fact: 'Cedar candle sold 40 last November.' }],
  ...over
})

const run = (over: Partial<PlanRun> = {}): PlanRun => ({
  id: 'run-1',
  state: 'planned',
  reason: null,
  startOn: '2026-11-17',
  stale: false,
  pulse: null,
  plan: {
    start: '2026-11-17',
    end: '2026-12-01',
    dropped: 0,
    brief: [],
    notes: ['One email was left out: its day is a holiday.'],
    source: { brief: 'code', planner: 'code', critic: 'skipped' },
    slots: [
      slot('2026-11-20', {
        emailType: 'offer',
        offer: { id: 'o1', code: 'CANDLE10', percent: 10 }
      }),
      slot('2026-11-17'),
      slot('2026-11-24', { format: 'text', emailType: 'story', products: [] }),
      slot('2026-11-27')
    ]
  } as unknown as PlanRun['plan'],
  builds: {},
  today: '2026-11-16',
  sendPassed: [false, false, false, false],
  ...over
})

const pulse = {
  start: '2026-11-17',
  end: '2026-12-01',
  offers: [{ id: 'o1', code: 'CANDLE10', percent: 10, until: '2026-11-30' }],
  leftOut: [{ code: 'SUMMER20', why: 'it ended on 1 Sep.' }],
  highlights: [
    {
      id: 'h1',
      kind: 'season',
      fact: 'Black Friday is on 27 Nov.',
      why: 'Shoppers look for offers.'
    }
  ],
  summary: 'A busy fortnight with Black Friday.',
  source: 'code',
  sample: true
} as unknown as PlanRun['pulse']

const plan = (r: PlanRun, who = owner) => {
  const screen = planScreen(r, who)
  if (screen.kind !== 'plan')
    throw new Error(`expected a plan, got ${screen.kind}`)
  return screen
}

describe('the Plan screen (UI-PLAN-a)', () => {
  it('asks for a first plan, shows the planner working, or says why it failed', () => {
    expect(planScreen(null, owner)).toEqual({ kind: 'empty', canPlan: true })
    expect(planScreen(null, staff)).toEqual({ kind: 'empty', canPlan: false })
    expect(
      planScreen(run({ state: 'pulse_queued', plan: null }), owner)
    ).toEqual({
      kind: 'planning',
      steps: [
        { label: 'Reading your store and your discounts', state: 'now' },
        { label: 'Planning 15 days of emails', state: 'next' }
      ]
    })
    expect(
      planScreen(run({ state: 'plan_queued', plan: null }), owner)
    ).toEqual({
      kind: 'planning',
      steps: [
        { label: 'Read your store and your discounts', state: 'done' },
        { label: 'Planning 15 days of emails', state: 'now' }
      ]
    })
    expect(
      planScreen(
        run({
          state: 'failed',
          reason: 'Klaviyo key stopped working.',
          plan: null
        }),
        owner
      )
    ).toEqual({
      kind: 'failed',
      reason: 'Klaviyo key stopped working.',
      canPlan: true
    })
    expect(planScreen(run({ plan: null }), owner)).toMatchObject({
      kind: 'failed'
    })
  })

  it('waits for the owner to pick the offers, and tells staff only he can', () => {
    expect(
      planScreen(run({ state: 'offers_ready', plan: null, pulse }), owner)
    ).toEqual({
      kind: 'offers',
      sample: true,
      runId: 'run-1',
      days: 'Tue 17 Nov to Tue 1 Dec',
      summary: 'A busy fortnight with Black Friday.',
      highlights: [
        { fact: 'Black Friday is on 27 Nov.', why: 'Shoppers look for offers.' }
      ],
      offers: [{ id: 'o1', label: '10% off with CANDLE10, until Mon 30 Nov' }],
      leftOut: ['SUMMER20 is not offered: it ended on 1 Sep.'],
      none: null,
      canPick: true
    })
    expect(
      planScreen(run({ state: 'offers_ready', plan: null, pulse }), staff)
    ).toMatchObject({ kind: 'offers', canPick: false })
    expect(
      planScreen(run({ state: 'offers_ready', plan: null, pulse: null }), owner)
    ).toMatchObject({ kind: 'failed' })
  })

  it('asks to start again when an open plan’s days have begun', () => {
    for (const state of [
      'pulse_queued',
      'offers_ready',
      'plan_queued'
    ] as const)
      expect(
        planScreen(run({ state, stale: true, plan: null, pulse }), owner)
      ).toEqual({
        kind: 'restart',
        reason:
          'This plan was for days that have started. Plan the next 15 days again.',
        canPlan: true
      })
  })

  it('shows the revenue goal as the plan worked back from it, and none without one (#33)', () => {
    const goal = [
      {
        month: '2026-11-01',
        label: 'November 2026',
        sentence: '$12,400 still needed by 30 November.',
        plan: 'This plan has 4 emails in November 2026.',
        pace: 'behind'
      }
    ]
    expect(
      plan(run({ plan: { ...run().plan!, goal } as PlanRun['plan'] })).goal
    ).toEqual([
      {
        label: 'November 2026',
        sentence:
          '$12,400 still needed by 30 November. This plan has 4 emails in November 2026.'
      }
    ])
    expect(plan(run()).goal).toEqual([])
  })

  it('lays out the 15 days and the emails by date and time, the first still to create next', () => {
    const screen = plan(run())
    expect(screen).toMatchObject({
      sample: false,
      noAi: true,
      notes: ['One email was left out: its day is a holiday.'],
      none: null,
      canPlan: true
    })
    expect(screen.days).toHaveLength(15)
    expect(screen.days[0]).toEqual({
      date: '2026-11-17',
      state: 'planned',
      slot: 1
    })
    expect(screen.days[1]).toEqual({
      date: '2026-11-18',
      state: 'none',
      slot: null
    })
    expect(screen.emails.map((e) => e.slot)).toEqual([1, 0, 2, 3])
    expect(screen.emails[0]).toEqual({
      slot: 1,
      stage: 'not_started',
      date: '2026-11-17',
      day: 'Tue 17',
      title: 'Bestseller: Cedar candle',
      details: ['Tue 17', '6:00 pm', 'Past buyers'],
      format: 'designed',
      angle: 'Our best candle for cold evenings.',
      why: 'It sells most in November.',
      evidence: ['Cedar candle sold 40 last November.'],
      status: { kind: 'planned' },
      action: { kind: 'create', label: 'Create email' },
      next: true
    })
    expect(screen.emails[1]).toMatchObject({
      title: 'Offer: Cedar candle',
      details: ['Fri 20', '6:00 pm', 'Past buyers', '10% off with CANDLE10'],
      next: false
    })
    expect(screen.emails[2]).toMatchObject({
      title: 'Story',
      format: 'text',
      details: ['Tue 24', '6:00 pm', 'Past buyers', 'Text email']
    })
    expect(screen.counts).toEqual({ inKlaviyo: 0, sampleDrafts: 0, planned: 4 })
    // Two the same day: the earlier send first, and next.
    const sameDay = plan(
      run({
        plan: {
          ...run().plan!,
          slots: [slot('2026-11-17'), slot('2026-11-17', { time: '09:00' })]
        } as PlanRun['plan'],
        sendPassed: [false, false]
      })
    )
    expect(sameDay.emails.map((e) => [e.slot, e.next])).toEqual([
      [1, true],
      [0, false]
    ])
    // No email fits: why.
    expect(
      plan(run({ plan: { ...run().plan!, slots: [] } as PlanRun['plan'] })).none
    ).toBe('No email fits these 15 days with your current settings.')
  })

  it('shows each email’s build: working, in Klaviyo, a sample draft, or needing the owner', () => {
    const screen = plan(
      run({
        builds: {
          1: {
            id: 'b1',
            state: 'drafted',
            step: 'push',
            sampleDraft: true,
            reason: null
          },
          0: {
            id: 'b0',
            state: 'build_queued',
            step: 'design',
            sampleDraft: false,
            reason: null
          },
          2: {
            id: 'b2',
            state: 'failed',
            step: 'copy',
            sampleDraft: false,
            reason: 'The discount code ended before the send.'
          },
          3: {
            id: 'b3',
            state: 'drafted',
            step: 'push',
            sampleDraft: false,
            reason: null
          }
        }
      })
    )
    const by = (s: number) => screen.emails.find((e) => e.slot === s)!
    // A sample draft is never "In Klaviyo".
    expect(by(1)).toMatchObject({
      status: { kind: 'sample_draft' },
      action: { kind: 'open', buildId: 'b1' }
    })
    expect(by(3)).toMatchObject({ status: { kind: 'in_klaviyo' } })
    expect(by(3).status).not.toHaveProperty('words')
    expect(by(0)).toMatchObject({
      status: { kind: 'working', word: 'Designing' },
      action: { kind: 'open', buildId: 'b0' }
    })
    expect(by(2)).toMatchObject({
      status: {
        kind: 'needs_you',
        reason: 'The discount code ended before the send.'
      },
      action: { kind: 'create', label: 'Try again' }
    })
    expect(screen.emails.some((e) => e.next)).toBe(false)
    expect(screen.days.find((d) => d.date === '2026-11-17')!.state).toBe(
      'sample_draft'
    )
    expect(screen.days.find((d) => d.date === '2026-11-27')!.state).toBe(
      'in_klaviyo'
    )
    // Two the same day: the day is the furthest, and opens it.
    const two = plan(
      run({
        plan: {
          ...run().plan!,
          slots: [slot('2026-11-17', { time: '09:00' }), slot('2026-11-17')]
        } as PlanRun['plan'],
        sendPassed: [false, false],
        builds: {
          1: {
            id: 'b1',
            state: 'drafted',
            step: 'push',
            sampleDraft: false,
            reason: null
          }
        }
      })
    )
    expect(two.days[0]).toEqual({
      date: '2026-11-17',
      state: 'in_klaviyo',
      slot: 1
    })
    expect(screen.counts).toEqual({ inKlaviyo: 1, sampleDrafts: 1, planned: 2 })
  })

  it('says what to do when a send time passed, even without the loader’s word', () => {
    const screen = plan(
      run({
        today: '2026-11-25',
        sendPassed: undefined,
        builds: {
          0: {
            id: 'b0',
            state: 'failed',
            step: 'copy',
            sampleDraft: false,
            reason: 'Its words did not pass the checks.'
          }
        }
      })
    )
    const by = (s: number) => screen.emails.find((e) => e.slot === s)!
    expect(by(1)).toMatchObject({
      status: {
        kind: 'needs_you',
        reason:
          'Its send time passed before it was made. Plan next 15 days for new emails.'
      },
      action: null
    })
    expect(by(0)).toMatchObject({
      status: {
        kind: 'needs_you',
        reason:
          'Its send time passed before it was made. Plan next 15 days for new emails.'
      },
      action: null
    })
    // The plan's days began, but a day still to come is still next.
    expect(by(3)).toMatchObject({ action: { kind: 'create' }, next: true })
  })

  it('keeps the next email once the plan’s first day has begun', () => {
    const screen = plan(
      run({
        stale: true,
        today: '2026-11-18',
        sendPassed: [false, true, false, false]
      })
    )
    expect(screen.emails.find((e) => e.next)?.slot).toBe(0)
  })

  it('offers staff no button the server would refuse', () => {
    const screen = plan(
      run({
        builds: {
          0: {
            id: 'b0',
            state: 'failed',
            step: 'copy',
            sampleDraft: false,
            reason: null
          },
          2: {
            id: 'b2',
            state: 'drafted',
            step: 'push',
            sampleDraft: false,
            reason: null
          }
        }
      }),
      staff
    )
    const by = (s: number) => screen.emails.find((e) => e.slot === s)!
    expect(by(1).action).toBeNull()
    expect(by(0)).toMatchObject({
      action: null,
      status: {
        reason: 'We could not create this email. Only the owner can try again.'
      }
    })
    expect(by(2).action).toEqual({ kind: 'open', buildId: 'b2' })
    expect(screen.emails.some((e) => e.next)).toBe(false)
    expect(screen.canPlan).toBe(false)
  })

  it('writes days and times the short way', () => {
    expect(dayLabel('2026-11-20')).toBe('Fri 20')
    expect(dayLabel('nonsense')).toBe('nonsense')
    expect(timeLabel('00:05')).toBe('12:05 am')
    expect(timeLabel('12:30')).toBe('12:30 pm')
    expect(fifteenDays('2026-12-25').at(-1)).toBe('2027-01-08')
    expect(fifteenDays('bad')).toEqual([])
  })

  it('counts how far the emails got, and what Create all would queue (PICK-102)', () => {
    const r = run({
      builds: {
        0: {
          id: 'b0',
          state: 'drafted',
          step: 'push',
          sampleDraft: true,
          reason: null
        },
        2: {
          id: 'b2',
          state: 'failed',
          step: 'design',
          sampleDraft: false,
          reason: 'Its design could not be drawn.'
        }
      },
      // Slot 3's send time passed before it was made.
      sendPassed: [false, false, false, true]
    })
    const mine = plan(r)
    expect(
      Object.fromEntries(mine.emails.map((e) => [e.slot, e.stage]))
    ).toEqual({ 0: 'ready', 1: 'not_started', 2: 'failed', 3: 'too_late' })
    expect(mine.progress).toEqual({
      total: 4,
      ready: 1,
      working: 0,
      failed: 1,
      notStarted: 1,
      tooLate: 1
    })
    expect(mine.toCreate).toBe(1)
    // Staff see the same progress, and have nothing to create.
    const theirs = plan(r, staff)
    expect(theirs.progress).toEqual(mine.progress)
    expect(theirs.toCreate).toBe(0)
  })
})
