import { describe, expect, it } from 'vitest'
import {
  defaultExposurePolicy,
  enforceExposure,
  exposurePolicySchema,
  type ExposurePolicy,
  type PastSend,
  type PlannedSlot
} from './exposure'

const day = 86_400_000
const t0 = Date.parse('2026-12-01T09:00:00.000Z')
const at = (ms: number) => new Date(t0 + ms).toISOString()
const slot = (
  id: string,
  ms: number,
  segments: string[],
  kind: PlannedSlot['class'] = 'marketing'
): PlannedSlot => ({ id, at: at(ms), segments, class: kind })
const past = (
  profile: string,
  ms: number,
  kind: PastSend['class'] = 'marketing'
): PastSend => ({ profile, at: at(ms), class: kind })
const run = (
  slots: PlannedSlot[],
  over: Partial<Parameters<typeof enforceExposure>[0]> = {}
) =>
  enforceExposure({
    policy: defaultExposurePolicy,
    segments: { SEGall: ['p1'] },
    slots,
    ...over
  })
/** Who gets each slot, by slot id. */
const sent = (e: ReturnType<typeof enforceExposure>) =>
  Object.fromEntries(e.slots.map((s) => [s.slot, s.send]))
const why = (e: ReturnType<typeof enforceExposure>, id: string) =>
  e.slots.find((s) => s.slot === id)!.held

describe('enforceExposure (SEG-EXP-a)', () => {
  it('allows exactly 3 marketing emails in 7 days and holds the 4th', () => {
    const e = run([0, 1, 2, 3].map((d) => slot(`s${d}`, d * day, ['SEGall'])))
    expect(sent(e)).toEqual({ s0: ['p1'], s1: ['p1'], s2: ['p1'], s3: [] })
    expect(why(e, 's3')).toEqual([{ profile: 'p1', reason: 'over_cap' }])
    expect(e.marketing).toEqual({ p1: 3 })
    // Past sends count the same: three last week leave no room now.
    const full = run([slot('now', 6 * day, ['SEGall'])], {
      history: [past('p1', 0), past('p1', day), past('p1', 2 * day)]
    })
    expect(why(full, 'now')).toEqual([{ profile: 'p1', reason: 'over_cap' }])
  })

  it('frees one place the instant the oldest email leaves the rolling 7 days', () => {
    const history = [past('p1', 0), past('p1', 60_000), past('p1', 120_000)]
    const at7 = 7 * day
    expect(sent(run([slot('s', at7 - 1, ['SEGall'])], { history })).s).toEqual(
      []
    )
    expect(sent(run([slot('s', at7, ['SEGall'])], { history })).s).toEqual([
      'p1'
    ])
    // One place only: the next one waits for the second email to leave.
    const two = run(
      [
        slot('a', at7, ['SEGall']),
        slot('b', at7 + 59_999, ['SEGall']),
        slot('c', at7 + 60_000, ['SEGall'])
      ],
      { history }
    )
    expect(sent(two)).toEqual({ a: ['p1'], b: [], c: ['p1'] })
    // A window counts later emails too: an earlier slot cannot squeeze in.
    const later = run([slot('early', -day, ['SEGall'])], {
      history: [past('p1', 0), past('p1', day), past('p1', 2 * day)]
    })
    expect(sent(later).early).toEqual([])
  })

  it('leaves out suppressed and unsubscribed profiles first, even with no emails sent', () => {
    const e = run([slot('s', 0, ['SEGall', 'SEGvip'])], {
      segments: { SEGall: ['p1', 'p2', 'p3'], SEGvip: ['p2'] },
      suppressed: ['p1', 'p2'],
      unsubscribed: ['p2', 'p3']
    })
    expect(sent(e).s).toEqual([])
    expect(why(e, 's')).toEqual([
      { profile: 'p1', reason: 'suppressed' },
      { profile: 'p2', reason: 'suppressed' },
      { profile: 'p3', reason: 'unsubscribed' }
    ])
    // They are counted under no segment, and reach nobody.
    expect(e).toMatchObject({ countsUnder: {}, emails: 0, reached: 0 })
    // Transactional mail is held for them too.
    const t = run([slot('t', 0, ['SEGall'], 'transactional')], {
      suppressed: ['p1']
    })
    expect(why(t, 't')).toEqual([{ profile: 'p1', reason: 'suppressed' }])
  })

  it('counts a profile once across overlapping segments, under the priority one', () => {
    const segments = { SEGall: ['p1', 'p2'], SEGvip: ['p1'] }
    const slots = [
      slot('everyone', 0, ['SEGall']),
      slot('vip', day, ['SEGvip'])
    ]
    const e = run(slots, {
      segments,
      policy: { ...defaultExposurePolicy, priority: ['SEGvip'] }
    })
    expect(e.countsUnder).toEqual({ p1: 'SEGvip', p2: 'SEGall' })
    expect(sent(e)).toEqual({ everyone: ['p2'], vip: ['p1'] })
    expect(why(e, 'everyone')).toEqual([
      { profile: 'p1', reason: 'counted_under', segment: 'SEGvip' }
    ])
    // Campaign volume against unique people.
    expect(e).toMatchObject({ campaigns: 2, emails: 2, reached: 2 })
    // A slot sent to both segments reaches each profile once.
    const both = run([slot('both', 0, ['SEGall', 'SEGvip'])], { segments })
    expect(sent(both).both).toEqual(['p1', 'p2'])
  })

  it('breaks ties by the earliest slot, then the segment id, whatever the input order', () => {
    const segments = { SEGb: ['p1'], SEGa: ['p1'], SEGc: ['p1'] }
    // No priority: SEGc's slot is first, so p1 counts under SEGc.
    const slots = [
      slot('a', day, ['SEGa']),
      slot('b', day, ['SEGb']),
      slot('c', 0, ['SEGc'])
    ]
    expect(run(slots, { segments }).countsUnder).toEqual({ p1: 'SEGc' })
    // Same time: the segment id decides.
    const same = [slot('a', 0, ['SEGa']), slot('b', 0, ['SEGb'])]
    expect(run(same, { segments }).countsUnder).toEqual({ p1: 'SEGa' })
    // A set priority wins over an earlier slot.
    const policy: ExposurePolicy = {
      ...defaultExposurePolicy,
      priority: ['SEGb']
    }
    expect(run(slots, { segments, policy }).countsUnder).toEqual({ p1: 'SEGb' })
    // Shuffled slots, segments, members and history: the same answer every run.
    const many = {
      segments: {
        SEGx: ['p3', 'p1', 'p2'],
        SEGy: ['p2', 'p4'],
        SEGz: ['p1', 'p4', 'p5']
      },
      slots: [0, 1, 2, 3, 4, 5].map((i) =>
        slot(`s${i}`, (i % 3) * day, [['SEGx', 'SEGy', 'SEGz'][i % 3]!])
      ),
      history: [
        past('p1', -day),
        past('p4', -2 * day),
        past('p2', -day, 'transactional')
      ],
      suppressed: ['p5']
    }
    const base = run(many.slots, many)
    let seed = 7
    const shuffle = <T>(list: readonly T[]) =>
      [...list]
        .map((v) => ({ v, k: (seed = (seed * 9301 + 49297) % 233280) }))
        .sort((a, b) => a.k - b.k)
        .map((x) => x.v)
    for (let i = 0; i < 20; i++) {
      const again = run(shuffle(many.slots), {
        segments: Object.fromEntries(
          shuffle(Object.entries(many.segments)).map(([k, v]) => [
            k,
            shuffle(v)
          ])
        ),
        history: shuffle(many.history),
        suppressed: shuffle(many.suppressed)
      })
      expect(again).toEqual(base)
    }
  })

  it('never counts or holds transactional mail', () => {
    const history = [0, 1, 2, 3].map((d) =>
      past('p1', d * 60_000, 'transactional')
    )
    const e = run(
      [
        slot('t1', day, ['SEGall'], 'transactional'),
        slot('m1', day, ['SEGall']),
        slot('m2', 2 * day, ['SEGall']),
        slot('t2', 2 * day, ['SEGall'], 'transactional'),
        slot('m3', 3 * day, ['SEGall'])
      ],
      { history }
    )
    expect(sent(e)).toEqual({
      t1: ['p1'],
      m1: ['p1'],
      t2: ['p1'],
      m2: ['p1'],
      m3: ['p1']
    })
    expect(e.marketing).toEqual({ p1: 3 })
  })

  it('takes an edited cap and window', () => {
    const slots = [0, 2, 4].map((d) => slot(`s${d}`, d * day, ['SEGall']))
    const one: ExposurePolicy = { windowDays: 3, maxMarketing: 1, priority: [] }
    // Every 2 days with one email per 3 days: the middle one is held.
    expect(sent(run(slots, { policy: one }))).toEqual({
      s0: ['p1'],
      s2: [],
      s4: ['p1']
    })
    const wide: ExposurePolicy = {
      windowDays: 30,
      maxMarketing: 2,
      priority: []
    }
    expect(sent(run(slots, { policy: wide }))).toEqual({
      s0: ['p1'],
      s2: ['p1'],
      s4: []
    })
    const two: ExposurePolicy = {
      windowDays: 1,
      maxMarketing: 14,
      priority: []
    }
    expect(sent(run(slots, { policy: two })).s2).toEqual(['p1'])
  })

  it('handles empty segments, unknown segments and bad input', () => {
    const e = run([slot('s', 0, ['SEGnone', 'SEGempty'])], {
      segments: { SEGempty: [] }
    })
    expect(e).toMatchObject({
      slots: [{ slot: 's', send: [], held: [] }],
      emails: 0,
      reached: 0
    })
    expect(run([]).slots).toEqual([])
    expect(() =>
      run([{ ...slot('s', 0, ['SEGall']), at: 'tomorrow' }])
    ).toThrow()
    for (const bad of [
      { windowDays: 0, maxMarketing: 3, priority: [] },
      { windowDays: 31, maxMarketing: 3, priority: [] },
      { windowDays: 7, maxMarketing: 0, priority: [] },
      { windowDays: 7, maxMarketing: 15, priority: [] },
      { windowDays: 7.5, maxMarketing: 3, priority: [] },
      { windowDays: 7, maxMarketing: 3, priority: ['SEGa', 'SEGa'] },
      { windowDays: 7, maxMarketing: 3, priority: ['SEG a'] }
    ]) {
      expect(exposurePolicySchema.safeParse(bad).success).toBe(false)
      expect(() => run([], { policy: bad })).toThrow()
    }
    expect(exposurePolicySchema.safeParse(defaultExposurePolicy).success).toBe(
      true
    )
  })
})
