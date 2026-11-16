import { describe, expect, it, vi } from 'vitest'
import type { PlanRun } from './load'
import { dayLabel, fifteenDays, planScreen, timeLabel } from './plan-screen'

vi.mock('server-only', () => ({}))

const slot = (date: string, over: Record<string, unknown> = {}) => ({
  date,
  time: '18:00',
  emailType: 'bestseller',
  angle: 'Our best candle for cold evenings.',
  products: [{ id: 'p1', title: 'Cedar candle' }],
  offer: null,
  audience: { id: 'a1', label: 'Past buyers' },
  why: 'It sells most in November.',
  evidence: [],
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
    notes: [],
    source: { brief: 'code', planner: 'code', critic: 'skipped' },
    slots: [
      slot('2026-11-20', {
        emailType: 'offer',
        offer: { id: 'o1', code: 'CANDLE10', percent: 10 }
      }),
      slot('2026-11-17'),
      slot('2026-11-24', {
        format: 'text',
        emailType: 'story',
        products: []
      }),
      slot('2026-11-27')
    ]
  } as unknown as PlanRun['plan'],
  builds: {},
  today: '2026-11-16',
  sendPassed: [false, false, false, false],
  ...over
})

describe('the Plan screen (UI-PLAN-a)', () => {
  it('asks for a first plan, shows the planner working, or says why it failed', () => {
    expect(planScreen(null)).toEqual({ kind: 'empty' })
    expect(planScreen(run({ state: 'pulse_queued', plan: null }))).toEqual({
      kind: 'planning',
      steps: [
        { label: 'Reading your store and your discounts', state: 'now' },
        { label: 'Planned 15 days of emails', state: 'next' }
      ]
    })
    expect(
      planScreen(run({ state: 'plan_queued', plan: null })).kind ===
        'planning' &&
        (
          planScreen(run({ state: 'plan_queued', plan: null })) as {
            steps: unknown
          }
        ).steps
    ).toEqual([
      { label: 'Read your store and your discounts', state: 'done' },
      { label: 'Planning 15 days of emails', state: 'now' }
    ])
    expect(
      planScreen(
        run({
          state: 'failed',
          reason: 'Klaviyo key stopped working.',
          plan: null
        })
      )
    ).toEqual({ kind: 'failed', reason: 'Klaviyo key stopped working.' })
    expect(planScreen(run({ plan: null }))).toMatchObject({ kind: 'failed' })
  })

  it('lays out the 15 days and the emails by date, the first still to create next', () => {
    const screen = planScreen(run())
    if (screen.kind !== 'plan') throw new Error('expected a plan')
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
    expect(screen.emails[0]).toMatchObject({
      day: 'Tue 17',
      title: 'Bestseller: Cedar candle',
      details: ['Tue 17', '6:00 pm', 'Past buyers'],
      status: { kind: 'planned' },
      action: { kind: 'create', label: 'Create email' },
      next: true
    })
    expect(screen.emails[1]).toMatchObject({
      title: 'Offer: Cedar candle',
      details: ['Fri 20', '6:00 pm', 'Past buyers', '10% off'],
      next: false
    })
    expect(screen.emails[2]).toMatchObject({
      title: 'Story',
      format: 'text',
      details: ['Tue 24', '6:00 pm', 'Past buyers', 'Text email']
    })
    expect(screen.counts).toEqual({ inKlaviyo: 0, planned: 4 })
  })

  it('shows each email’s build: working with its step, in Klaviyo, or needing the owner', () => {
    const screen = planScreen(
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
          }
        },
        sendPassed: [false, false, false, true]
      })
    )
    if (screen.kind !== 'plan') throw new Error('expected a plan')
    const by = (s: number) => screen.emails.find((e) => e.slot === s)!
    expect(by(1)).toMatchObject({
      status: { kind: 'in_klaviyo' },
      action: { kind: 'open', buildId: 'b1' },
      sampleDraft: true
    })
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
    // A day passed with nothing made: the owner's words, no button.
    expect(by(3)).toMatchObject({
      status: { kind: 'needs_you', reason: 'Its send time has passed.' },
      action: null
    })
    // Nothing left to create: no row is next.
    expect(screen.emails.some((e) => e.next)).toBe(false)
    expect(screen.days.find((d) => d.date === '2026-11-17')!.state).toBe(
      'in_klaviyo'
    )
    expect(screen.counts).toEqual({ inKlaviyo: 1, planned: 3 })
  })

  it('marks no email next once the 15 days have begun', () => {
    const screen = planScreen(run({ stale: true }))
    expect(screen.kind === 'plan' && screen.emails.some((e) => e.next)).toBe(
      false
    )
    expect(screen).toMatchObject({ kind: 'plan', stale: true })
  })

  it('writes days and times the short way', () => {
    expect(dayLabel('2026-11-20')).toBe('Fri 20')
    expect(dayLabel('nonsense')).toBe('nonsense')
    expect(timeLabel('00:05')).toBe('12:05 am')
    expect(timeLabel('12:30')).toBe('12:30 pm')
    expect(fifteenDays('2026-12-25').at(-1)).toBe('2027-01-08')
    expect(fifteenDays('bad')).toEqual([])
  })
})
