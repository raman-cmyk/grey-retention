// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { runStrategyRuns, stepCode } from './worker'
import { sampleStrategyData } from './data'
import { codePulse, gatherEvidence } from './pulse'
import { sampleStore } from './sample'
import type { StoredPlan, StoredPulse } from './stored'

const tenant = '00000000-0000-4000-8000-000000000101'
const start = '2026-11-16'

type Call = { fn: string; args: Record<string, unknown> }
/** A database that hands out the given runs, then nothing, and records calls. */
function fakeDb(
  runs: Record<string, unknown>[],
  fail: Record<string, { code: string }> = {}
) {
  const queue = [...runs]
  const calls: Call[] = []
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
    calls.push({ fn, args })
    if (fail[fn]) return { data: null, error: fail[fn] }
    if (fn === 'claim_strategy_run') {
      const next = queue.shift()
      return { data: next ? [next] : [], error: null }
    }
    return { data: fn === 'fail_strategy_step' ? 'retry' : null, error: null }
  })
  return { db: { rpc } as never, calls }
}
const run = (over: Record<string, unknown> = {}) => ({
  id: 'run-1',
  tenant_id: tenant,
  state: 'pulse_queued',
  start_on: start,
  pulse: null,
  offer_pick: null,
  lease_token: 'lease-1',
  ...over
})
const pulse = { ...codePulse(gatherEvidence(sampleStore(start))), sample: true }
const failure = (calls: Call[]) =>
  calls.find((c) => c.fn === 'fail_strategy_step')?.args

describe('running plan steps (the code-only path)', () => {
  it('reads the store and saves the pulse, marked as the sample store', async () => {
    const { db, calls } = fakeDb([run()])
    expect(await runStrategyRuns(db)).toEqual({ ran: 1 })
    const finish = calls.find((c) => c.fn === 'finish_strategy_pulse')!
    expect(finish.args).toMatchObject({ run: 'run-1', lease: 'lease-1' })
    const saved = finish.args.result as StoredPulse
    expect(saved).toMatchObject({ source: 'code', sample: true })
    expect(saved.offers.map((o) => o.code)).toEqual(['WELCOME15', 'CANDLE10'])
  })

  it('plans the 15 days with the owner’s pick', async () => {
    const { db, calls } = fakeDb([
      run({
        state: 'plan_queued',
        pulse,
        offer_pick: { mode: 'picked', offers: ['offer:WELCOME15'] }
      })
    ])
    expect(await runStrategyRuns(db)).toEqual({ ran: 1 })
    const plan = calls.find((c) => c.fn === 'finish_strategy_plan')!.args
      .result as StoredPlan
    expect(plan.source).toEqual({
      brief: 'code',
      planner: 'code',
      critic: 'skipped'
    })
    expect(plan.sample).toBe(true)
    expect(plan.slots.length).toBeGreaterThan(0)
    expect(
      plan.slots
        .filter((s) => s.offer)
        .every((s) => s.offer!.code === 'WELCOME15')
    ).toBe(true)
    // No AI and nothing written to the fallback log.
    expect(calls.map((c) => c.fn)).toEqual([
      'claim_strategy_run',
      'finish_strategy_plan',
      'claim_strategy_run'
    ])
  })

  it('runs the owner’s own plan when asked, and only that one, once', async () => {
    const { db, calls } = fakeDb([run(), run({ id: 'run-2' })])
    expect(await runStrategyRuns(db, { run: 'run-1' })).toEqual({ ran: 1 })
    expect(calls.filter((c) => c.fn === 'claim_strategy_run')).toEqual([
      { fn: 'claim_strategy_run', args: { target: 'run-1' } }
    ])
  })

  it('runs at most two steps per call, and stops at its deadline', async () => {
    const { db, calls } = fakeDb([
      run(),
      run({ id: 'run-2' }),
      run({ id: 'run-3' })
    ])
    expect(await runStrategyRuns(db)).toEqual({ ran: 2 })
    expect(calls.filter((c) => c.fn === 'claim_strategy_run')).toHaveLength(2)
    const late = fakeDb([run()])
    expect(
      await runStrategyRuns(late.db, { deadline: 1000, now: () => 2000 })
    ).toEqual({ ran: 0 })
    expect(late.calls).toEqual([])
  })
})

describe('failed steps', () => {
  it('are tried again when the store cannot be read', async () => {
    const { db, calls } = fakeDb([run()])
    const broken = { load: async () => Promise.reject(new Error('down')) }
    expect(await runStrategyRuns(db, { data: broken })).toEqual({ ran: 0 })
    expect(failure(calls)).toEqual({
      run: 'run-1',
      lease: 'lease-1',
      code: 'step_error',
      final: false
    })
  })

  it('fail at once when a retry cannot help', async () => {
    const otherDays = {
      load: async ({ tenantId }: { tenantId: string }) =>
        sampleStrategyData.load({ tenantId, start: '2026-12-01' })
    }
    const cases = [
      ['pulse_queued', {}, otherDays, 'store_wrong_days'],
      [
        'plan_queued',
        { pulse, offer_pick: { mode: 'picked', offers: ['offer:MADEUP'] } },
        undefined,
        'pick_not_in_pulse'
      ],
      [
        'plan_queued',
        { pulse: { broken: true }, offer_pick: { mode: 'auto' } },
        undefined,
        'stored_pulse_invalid'
      ],
      [
        'plan_queued',
        { pulse, offer_pick: { mode: 'all' } },
        undefined,
        'stored_pick_invalid'
      ],
      [
        'plan_queued',
        { pulse, offer_pick: { mode: 'auto' } },
        otherDays,
        'store_wrong_days'
      ]
    ] as const
    for (const [state, over, data, code] of cases) {
      const { db, calls } = fakeDb([run({ state, ...over })])
      await runStrategyRuns(db, data ? { data } : {})
      expect(failure(calls), code).toMatchObject({ code, final: true })
    }
  })

  it('treat bad store data as final, and a lost lease as a retry', async () => {
    const bad = {
      load: async () => ({
        ...(await sampleStrategyData.load({ tenantId: tenant, start })),
        pulse: { brand: 'nope' }
      })
    }
    const one = fakeDb([run()])
    await runStrategyRuns(one.db, { data: bad })
    expect(failure(one.calls)).toMatchObject({
      code: 'store_data_invalid',
      final: true
    })
    const lost = fakeDb([run()], { finish_strategy_pulse: { code: 'PT409' } })
    await runStrategyRuns(lost.db)
    expect(failure(lost.calls)).toMatchObject({
      code: 'step_error',
      final: false
    })
  })

  it('stop the call when a claim fails', async () => {
    const { db } = fakeDb([run()], { claim_strategy_run: { code: '42501' } })
    await expect(runStrategyRuns(db)).rejects.toMatchObject({ code: '42501' })
  })
})

describe('the step error code', () => {
  it('keeps short codes and hides everything else', () => {
    expect(stepCode({ code: 'store_wrong_days' })).toBe('store_wrong_days')
    expect(stepCode({ code: 'Has Spaces' })).toBe('step_error')
    expect(stepCode({ name: 'ZodError' })).toBe('store_data_invalid')
    expect(stepCode(new Error('secret detail'))).toBe('step_error')
  })
})
