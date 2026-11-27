// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { codePulse, gatherEvidence } from './pulse'
import {
  calendarPlannerAgent,
  readPlanInput,
  samplePlan,
  type PlanInput
} from './plan'
import { sampleStore } from './sample'
import { storedPlan } from './stored'
import { planScreen } from './plan-screen'
import {
  minHoursApart,
  timingWords,
  withSendTimes,
  type PlanSendTime
} from './send-times'

const start = '2026-11-16'
const store = sampleStore(start)
const pulse = codePulse(gatherEvidence(store))
const input: PlanInput = {
  industry: 'home',
  start,
  sendsPerWeek: 3,
  sendTime: '10:00',
  pulse,
  offers: pulse.offers,
  moves: [],
  products: store.products.map((p) => ({
    id: p.id,
    title: p.title,
    inStock: p.stock !== 0,
    availableFrom: p.launchedOn && p.launchedOn >= start ? p.launchedOn : null
  })),
  audiences: [{ id: 'SegEng', label: 'Engaged subscribers' }],
  blackouts: [],
  existing: []
}
const time = (over: Partial<PlanSendTime> = {}): PlanSendTime => ({
  audienceId: 'SegEng',
  time: '09:00',
  basis: 'segment',
  compared: true,
  weekday: 'Tue',
  ...over
})
const slot = (date: string, audienceId: string, t = '10:00') => ({
  date,
  time: t,
  audienceId
})

describe('withSendTimes (PICK-97)', () => {
  it('puts each email at its audience’s best time, with why', () => {
    const [a] = withSendTimes([slot('2026-11-17', 'SegEng')], [time()])
    expect(a).toEqual({
      date: '2026-11-17',
      time: '09:00',
      audienceId: 'SegEng',
      timing: {
        basis: 'segment',
        compared: true,
        best: '09:00',
        moved: false
      }
    })
  })

  it('leaves the slots as they are without send times (the sample store)', () => {
    const slots = [slot('2026-11-17', 'SegEng', '18:00')]
    expect(withSendTimes(slots, undefined)).toEqual(slots)
    expect(withSendTimes(slots, [])).toEqual(slots)
  })

  it(`keeps two emails on one day at least ${minHoursApart} hours apart: the later one moves to the nearest hour that fits`, () => {
    const times = [
      time(),
      time({ audienceId: 'SegVIP', time: '10:00', compared: false })
    ]
    const out = withSendTimes(
      [slot('2026-11-17', 'SegVIP'), slot('2026-11-17', 'SegEng')],
      times
    )
    // The 9:00 one keeps its time; the 10:00 one moves to 12:00.
    expect(out.map((s) => [s.audienceId, s.time, s.timing?.moved])).toEqual([
      ['SegVIP', '12:00', true],
      ['SegEng', '09:00', false]
    ])
    // Other days are not touched.
    const apart = withSendTimes(
      [slot('2026-11-17', 'SegVIP'), slot('2026-11-18', 'SegEng')],
      times
    )
    expect(apart.map((s) => s.time)).toEqual(['10:00', '09:00'])
  })

  it('moves earlier when later hours are full, and never outside 07:00 to 21:00', () => {
    const times = [
      time({ audienceId: 'A', time: '21:00' }),
      time({ audienceId: 'B', time: '21:00' })
    ]
    const out = withSendTimes(
      [slot('2026-11-17', 'A'), slot('2026-11-17', 'B')],
      times
    )
    expect(out.map((s) => s.time)).toEqual(['21:00', '18:00'])
  })

  it('says why in plain words', () => {
    const t = { best: '09:00', moved: false }
    expect(timingWords({ ...t, basis: 'segment', compared: true })).toBe(
      'when this group opens most'
    )
    expect(timingWords({ ...t, basis: 'segment', compared: false })).toBe(
      'the time this group has always had; no other time tried yet'
    )
    expect(timingWords({ ...t, basis: 'store', compared: true })).toBe(
      'not enough history for this group; when your subscribers open most'
    )
    expect(timingWords({ ...t, basis: 'usual', compared: false })).toBe(
      'not enough history yet; your usual send time'
    )
    expect(timingWords({ ...t, basis: 'default', compared: false })).toBe(
      'not enough history yet; a standard morning time'
    )
    expect(
      timingWords({ ...t, basis: 'segment', compared: true, moved: true })
    ).toBe('moved from 9:00 am so two emails that day are not too close')
  })
})

describe('the plan’s send times (PICK-97)', () => {
  it('plans every email at its audience’s best time, saved with why', () => {
    const plan = samplePlan({ ...input, sendTimes: [time()] })
    expect(plan.slots.length).toBeGreaterThan(0)
    for (const s of plan.slots) {
      expect(s.time).toBe('09:00')
      expect(s.timing).toEqual({
        basis: 'segment',
        compared: true,
        best: '09:00',
        moved: false
      })
    }
    // Saved and read back with it.
    const saved = storedPlan.parse(JSON.parse(JSON.stringify(plan)))
    expect(saved.slots[0]!.timing?.basis).toBe('segment')
    // A plan without send times is as before.
    expect(samplePlan(input).slots.every((s) => s.timing === undefined)).toBe(
      true
    )
    expect(samplePlan(input).slots.every((s) => s.time === '10:00')).toBe(true)
  })

  it('shows the time and why on the Plan row: "9:00 am — when this group opens most"', () => {
    const plan = samplePlan({ ...input, sendTimes: [time()] })
    const view = planScreen(
      {
        id: 'run',
        state: 'planned',
        reason: null,
        startOn: start,
        stale: false,
        pulse: null,
        plan: storedPlan.parse(JSON.parse(JSON.stringify(plan))),
        builds: {},
        today: '2026-11-15'
      },
      { owner: true }
    )
    if (view.kind !== 'plan') throw new Error(view.kind)
    expect(view.emails[0]!.details[1]).toBe(
      '9:00 am — when this group opens most'
    )
  })

  it('a stored timing of an odd shape is none, never a broken plan', () => {
    const plan = samplePlan({ ...input, sendTimes: [time()] })
    const odd = JSON.parse(JSON.stringify(plan))
    odd.slots[0].timing = { basis: 'guess', best: 'noon' }
    const saved = storedPlan.parse(odd)
    expect(saved.slots[0]!.timing).toBeUndefined()
  })

  it('checks the send times it is given, and the AI planner reads them', () => {
    expect(() =>
      readPlanInput({ ...input, sendTimes: [time({ time: '23:00' })] })
    ).toThrow()
    const task = JSON.parse(
      calendarPlannerAgent.task({
        input: { ...input, sendTimes: [time()] },
        brief: [],
        previous: null,
        problems: []
      })
    )
    expect(task.send_times).toEqual([
      { audienceId: 'SegEng', time: '09:00', opens_most_on: 'Tue' }
    ])
    expect(
      JSON.parse(
        calendarPlannerAgent.task({
          input,
          brief: [],
          previous: null,
          problems: []
        })
      ).send_times
    ).toBeUndefined()
  })
})
