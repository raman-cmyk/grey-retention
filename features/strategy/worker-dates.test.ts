// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
/** When set, the plan gets this extra email (a day outside its window). */
const extra = vi.hoisted(() => ({ date: null as string | null, only: false }))
vi.mock('./plan', async (original) => {
  const real = await original<typeof import('./plan')>()
  return {
    ...real,
    samplePlan: (...args: Parameters<typeof real.samplePlan>) => {
      const made = real.samplePlan(...args)
      if (!extra.date || !made.slots.length) return made
      const outside = { ...made.slots[0], date: extra.date }
      return {
        ...made,
        slots: extra.only ? [outside] : [...made.slots, outside]
      }
    }
  }
})
import { runStrategyRuns } from './worker'
import { memoryFallbackLog } from '@/features/fallback/log'
import { sampleStrategyData, type StrategyData } from './data'
import { addDays, codePulse, gatherEvidence } from './pulse'
import { sampleStore } from './sample'
import type { StoredPlan } from './stored'

/** REL-DAT: the plan worker's last guard on its 15 days. */
const tenant = '00000000-0000-4000-8000-000000000101'
const start = '2026-11-16'
const pulse = { ...codePulse(gatherEvidence(sampleStore(start))), sample: true }
type Call = { fn: string; args: Record<string, unknown> }
function fakeDb() {
  const queue = [
    {
      id: 'run-1',
      tenant_id: tenant,
      state: 'plan_queued',
      start_on: start,
      pulse,
      offer_pick: { mode: 'auto' },
      lease_token: 'lease-1'
    }
  ]
  const calls: Call[] = []
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
    calls.push({ fn, args })
    if (fn === 'claim_strategy_run') {
      const next = queue.shift()
      return { data: next ? [next] : [], error: null }
    }
    return { data: fn === 'fail_strategy_step' ? 'retry' : null, error: null }
  })
  const from = (table: string) => {
    const result =
      table === 'tenants'
        ? { data: [{ timezone: 'Australia/Melbourne' }], error: null }
        : table === 'strategy_runs'
          ? { data: [{ attempts: 1 }], error: null }
          : { data: [], error: null }
    const query: Record<string, unknown> = {
      eq: () => query,
      maybeSingle: async () => ({ data: result.data[0] ?? null, error: null }),
      then: (done: (r: typeof result) => unknown) =>
        Promise.resolve(result).then(done)
    }
    return { select: () => query }
  }
  return { db: { rpc, from } as never, calls }
}
const saved = (calls: Call[]) =>
  calls.find((c) => c.fn === 'finish_strategy_plan')?.args.result as
    StoredPlan | undefined

describe('a finished plan keeps to its 15 days (REL-DAT)', () => {
  it('leaves out an email outside them, says so and logs it by count', async () => {
    extra.date = '2026-12-31'
    extra.only = false
    const fallbacks = memoryFallbackLog()
    const { db, calls } = fakeDb()
    await runStrategyRuns(db, { fallbacks })
    extra.date = null
    const plan = saved(calls)!
    expect(plan.slots.every((s) => s.date >= start)).toBe(true)
    expect(plan.slots.some((s) => s.date === '2026-12-31')).toBe(false)
    expect(plan.notes).toContain(
      'One email was left out: its day was not in these 15 days.'
    )
    expect(
      fallbacks.entries().find((e) => e.agent === 'plan-dates')
    ).toMatchObject({ reasonCode: 'slot_outside_plan', detail: { count: 1 } })
  })

  it('fails a plan this guard empties: its data did not match its days', async () => {
    extra.date = '2026-12-31'
    extra.only = true
    const fallbacks = memoryFallbackLog()
    const { db, calls } = fakeDb()
    await runStrategyRuns(db, { fallbacks })
    extra.date = null
    expect(
      calls.find((c) => c.fn === 'fail_strategy_step')?.args
    ).toMatchObject({ code: 'store_wrong_days', final: true })
    expect(fallbacks.entries().some((e) => e.agent === 'plan-dates')).toBe(
      false
    )
  })

  it('still saves a plan where no day fits at all (every day blacked out)', async () => {
    const data: StrategyData = {
      async load(input) {
        const base = await sampleStrategyData.load(input)
        return {
          ...base,
          plan: {
            ...base.plan,
            blackouts: Array.from({ length: 15 }, (_, n) =>
              addDays(input.start, n)
            )
          }
        }
      }
    }
    const { db, calls } = fakeDb()
    await runStrategyRuns(db, { data, fallbacks: memoryFallbackLog() })
    expect(calls.find((c) => c.fn === 'fail_strategy_step')).toBeUndefined()
    expect(saved(calls)?.slots).toEqual([])
  })
})
