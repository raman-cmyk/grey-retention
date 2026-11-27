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
  type PlanSendTime,
  type SlotTiming
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
  strength: 'clear',
  othersTried: true,
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
        strength: 'clear',
        othersTried: true,
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
      time({ audienceId: 'SegVIP', time: '10:00', strength: 'close' })
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

  it('never lets a fallback push a real recommendation off its hour: the stronger reason keeps its time', () => {
    const times = [
      // The VIPs have no history: the usual 09:00.
      time({
        audienceId: 'SegVIP',
        time: '09:00',
        basis: 'usual',
        strength: 'none',
        othersTried: false,
        weekday: null
      }),
      // The engaged clearly open and click most at 10:00.
      time({ time: '10:00' })
    ]
    const out = withSendTimes(
      [slot('2026-11-17', 'SegVIP'), slot('2026-11-17', 'SegEng')],
      times
    )
    expect(out.map((s) => [s.audienceId, s.time, s.timing?.moved])).toEqual([
      ['SegVIP', '07:00', true],
      ['SegEng', '10:00', false]
    ])
    // Among two counted times, a clear one before a close one.
    const counted = withSendTimes(
      [slot('2026-11-17', 'A'), slot('2026-11-17', 'B')],
      [
        time({ audienceId: 'A', time: '09:00', strength: 'close' }),
        time({ audienceId: 'B', time: '10:00', strength: 'clear' })
      ]
    )
    expect(counted.map((s) => s.time)).toEqual(['07:00', '10:00'])
  })

  it('says why in plain words, claiming only what the history shows', () => {
    const t = { best: '09:00', moved: false, othersTried: true }
    const words = (over: Partial<SlotTiming>) =>
      timingWords({ ...t, basis: 'segment', strength: 'clear', ...over })
    expect(words({})).toBe('when this group opens and clicks most')
    expect(words({ strength: 'close' })).toBe(
      'the time that did best so far for this group'
    )
    expect(words({ strength: 'only' })).toBe(
      'the only time this group has had more than once'
    )
    expect(words({ strength: 'only', othersTried: false })).toBe(
      'the time this group has always had; no other time tried yet'
    )
    expect(words({ basis: 'store' })).toBe(
      'not enough history for this group; when your subscribers open and click most'
    )
    expect(words({ basis: 'store', strength: 'close' })).toBe(
      'not enough history for this group; the time that did best so far for your store'
    )
    expect(words({ basis: 'store', strength: 'only' })).toBe(
      'not enough history for this group; your store’s best hour so far'
    )
    expect(words({ basis: 'usual', strength: 'none' })).toBe(
      'not enough history yet; your usual send time'
    )
    expect(words({ basis: 'default', strength: 'none' })).toBe(
      'not enough history yet; a standard morning time'
    )
    expect(words({ moved: true })).toBe(
      'moved from 9:00 am so two emails that day are not too close'
    )
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
        strength: 'clear',
        othersTried: true,
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

  it('shows the time and why on the Plan row: "9:00 am — when this group opens and clicks most"', () => {
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
      '9:00 am — when this group opens and clicks most'
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
      {
        audienceId: 'SegEng',
        time: '09:00',
        basis: 'segment',
        opens_most_on: 'Tue'
      }
    ])
    // The store's time carries no weekday as if it were the audience's,
    // and a time not counted from the history is not sent at all.
    const fallbacks = JSON.parse(
      calendarPlannerAgent.task({
        input: {
          ...input,
          audiences: [
            ...input.audiences,
            { id: 'SegVIP', label: 'VIPs' },
            { id: 'SegNew', label: 'New' }
          ],
          sendTimes: [
            time({ basis: 'store', weekday: null }),
            time({
              audienceId: 'SegNew',
              basis: 'usual',
              strength: 'none',
              weekday: null
            })
          ]
        },
        brief: [],
        previous: null,
        problems: []
      })
    )
    expect(fallbacks.send_times).toEqual([
      { audienceId: 'SegEng', time: '09:00', basis: 'store' }
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
