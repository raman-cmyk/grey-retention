// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { runStrategyRuns, stepCode } from './worker'
import { sampleStrategyData } from './data'
import { codePulse, gatherEvidence, type Pulse } from './pulse'
import { sampleStore } from './sample'
import type { FifteenDayPlan } from './plan'

const tenant = '00000000-0000-4000-8000-000000000101'
const start = '2026-11-16'
const env = {
  AI_DEFAULT_PROVIDER: 'fake',
  ADAPTER_MODE: 'fake'
} as unknown as NodeJS.ProcessEnv

type Call = { fn: string; args: Record<string, unknown> }
/** A database that hands out the given runs, then nothing, and records calls. */
function fakeDb(runs: Record<string, unknown>[]) {
  const queue = [...runs]
  const calls: Call[] = []
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
    calls.push({ fn, args })
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

describe('running plan steps (sample path, no live model)', () => {
  it('reads the store and saves the pulse', async () => {
    const { db, calls } = fakeDb([run()])
    expect(await runStrategyRuns(db, { env })).toEqual({ ran: 1 })
    const finish = calls.find((c) => c.fn === 'finish_strategy_pulse')!
    expect(finish.args).toMatchObject({ run: 'run-1', lease: 'lease-1' })
    const pulse = finish.args.result as Pulse
    expect(pulse.source).toBe('code')
    expect(pulse.offers.map((o) => o.code)).toEqual(['WELCOME15', 'CANDLE10'])
  })

  it('plans the 15 days with the owner’s pick', async () => {
    const pulse = codePulse(gatherEvidence(sampleStore(start)))
    const { db, calls } = fakeDb([
      run({
        state: 'plan_queued',
        pulse,
        offer_pick: { mode: 'picked', offers: ['offer:WELCOME15'] }
      })
    ])
    expect(await runStrategyRuns(db, { env })).toEqual({ ran: 1 })
    const plan = calls.find((c) => c.fn === 'finish_strategy_plan')!.args
      .result as FifteenDayPlan
    expect(plan.source).toEqual({
      brief: 'code',
      planner: 'code',
      critic: 'skipped'
    })
    expect(plan.slots.length).toBeGreaterThan(0)
    expect(
      plan.slots
        .filter((s) => s.offer)
        .every((s) => s.offer!.code === 'WELCOME15')
    ).toBe(true)
    // The sample path writes nothing to the fallback log.
    expect(calls.some((c) => c.fn === 'record_fallback')).toBe(false)
  })

  it('runs at most two steps per call', async () => {
    const { db, calls } = fakeDb([
      run(),
      run({ id: 'run-2' }),
      run({ id: 'run-3' })
    ])
    expect(await runStrategyRuns(db, { env })).toEqual({ ran: 2 })
    expect(calls.filter((c) => c.fn === 'claim_strategy_run')).toHaveLength(2)
  })

  it('fails a step with a short code when the store cannot be read', async () => {
    const { db, calls } = fakeDb([run()])
    const broken = { load: async () => Promise.reject(new Error('down')) }
    expect(await runStrategyRuns(db, { env, data: broken })).toEqual({ ran: 0 })
    expect(calls.find((c) => c.fn === 'fail_strategy_step')!.args).toEqual({
      run: 'run-1',
      lease: 'lease-1',
      code: 'step_error'
    })
  })

  it('refuses store data for other days, and a pick the pulse does not have', async () => {
    const otherDays = {
      load: async ({ tenantId }: { tenantId: string }) =>
        sampleStrategyData.load({ tenantId, start: '2026-12-01' })
    }
    const pulse = codePulse(gatherEvidence(sampleStore(start)))
    const { db, calls } = fakeDb([
      run(),
      run({
        id: 'run-2',
        state: 'plan_queued',
        pulse,
        offer_pick: { mode: 'picked', offers: ['offer:MADEUP'] }
      })
    ])
    await runStrategyRuns(db, { env, data: otherDays })
    expect(
      calls.filter((c) => c.fn === 'fail_strategy_step').map((c) => c.args.code)
    ).toEqual(['store_wrong_days', 'pick_not_in_pulse'])
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
