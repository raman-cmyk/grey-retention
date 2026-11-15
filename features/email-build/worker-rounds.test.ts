// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
const runStep = vi.hoisted(() => vi.fn())
vi.mock('./steps', async (original) => ({
  ...(await original<typeof import('./steps')>()),
  runBuildStep: runStep
}))
import { memoryFallbackLog } from '@/features/fallback/log'
import { runEmailBuilds } from './worker'
import { buildSteps, maxStepSaves } from './step-names'

/**
 * REL-AI part 2b: a step that saves its rounds (`save_email_round`). The
 * steps themselves are stubbed: these tests are about the job.
 */
const tenant = '00000000-0000-4000-8000-000000000101'
const inDays = (n: number) => {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const job = (over: Record<string, unknown> = {}) => ({
  id: 'build-1',
  tenant_id: tenant,
  state: 'build_queued',
  step: 'copy',
  progress: { sections: {}, content: {} },
  run_id: 'run-1',
  slot: 0,
  planned: {
    date: inDays(2),
    time: '10:00',
    emailType: 'launch',
    angle: 'Meet the linen throw',
    products: [{ id: 'p-linen-throw', title: 'Linen throw' }],
    offer: null,
    audience: { id: 'sample-engaged', label: 'Engaged subscribers (sample)' }
  },
  email: null,
  push_key: 'key-1',
  timezone: 'Asia/Kathmandu',
  start_on: inDays(1),
  lease_token: 'lease-1',
  ...over
})

type Call = { fn: string; args: Record<string, unknown> }
/**
 * A database that hands out one build. Saving its rounds hands the same
 * step out again with the work kept (as `save_email_round` does);
 * finishing the copy step ends it.
 */
function fakeDb(fail: Record<string, { code: string }> = {}) {
  let current: Record<string, unknown> | null = job()
  const calls: Call[] = []
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
    calls.push({ fn, args })
    if (fail[fn]) return { data: null, error: fail[fn] }
    if (fn === 'claim_email_build') {
      const next = current
      current = null
      return { data: next ? [next] : [], error: null }
    }
    if (fn === 'save_email_round') {
      const last = calls.filter((c) => c.fn === 'save_email_round').length
      current = job({
        progress: {
          sections: {},
          content: {},
          work: { copy: { ...(args.work as object), saves: last } }
        }
      })
      return { data: last, error: null }
    }
    return { data: fn === 'fail_email_step' ? 'retry' : 'design', error: null }
  })
  const query: Record<string, unknown> = {
    select: () => query,
    eq: () => query,
    neq: () => query,
    or: () => query,
    then: (done: (r: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(done)
  }
  return { db: { rpc, from: () => query } as never, calls }
}
const names = (calls: Call[]) => calls.map((c) => c.fn)

beforeEach(() => runStep.mockReset())

describe('a step that saves its rounds (REL-AI part 2b)', () => {
  it('is claimed again at once and goes on from its saved rounds', async () => {
    runStep
      .mockResolvedValueOnce({ ok: true, saved: 'copy', work: { round: 1 } })
      .mockResolvedValueOnce({ ok: true, done: 'copy', output: { draft: 1 } })
    const { db, calls } = fakeDb()
    await runEmailBuilds(db, {
      agents: null,
      fallbacks: memoryFallbackLog(),
      build: 'build-1'
    })
    expect(names(calls).filter((n) => n !== 'claim_email_build')).toEqual([
      'save_email_round',
      'finish_email_step'
    ])
    expect(calls.find((c) => c.fn === 'save_email_round')?.args).toEqual({
      build: 'build-1',
      lease: 'lease-1',
      step: 'copy',
      work: { round: 1 }
    })
    // The second claim's step sees the saved rounds.
    expect(runStep.mock.calls[1][0]).toBe('copy')
    expect(runStep.mock.calls[1][1].progress.work.copy).toEqual({
      round: 1,
      saves: 1
    })
  })

  it('the owner’s click has room for every save of a step', async () => {
    runStep.mockResolvedValue({ ok: true, saved: 'copy', work: { round: 1 } })
    const { db, calls } = fakeDb()
    await runEmailBuilds(db, {
      agents: null,
      fallbacks: memoryFallbackLog(),
      build: 'build-1'
    })
    expect(names(calls).filter((n) => n === 'save_email_round')).toHaveLength(
      buildSteps.length + 1 + maxStepSaves
    )
  })

  it('a save the database refuses fails the build for good', async () => {
    runStep.mockResolvedValueOnce({ ok: true, saved: 'copy', work: {} })
    const { db, calls } = fakeDb({ save_email_round: { code: '22023' } })
    await runEmailBuilds(db, { agents: null, fallbacks: memoryFallbackLog() })
    expect(calls.find((c) => c.fn === 'fail_email_step')?.args).toMatchObject({
      build: 'build-1',
      code: 'step_output_invalid',
      final: true
    })
  })

  it('a save that lost its lease is tried again', async () => {
    runStep.mockResolvedValueOnce({ ok: true, saved: 'copy', work: {} })
    const { db, calls } = fakeDb({ save_email_round: { code: 'PT409' } })
    await runEmailBuilds(db, { agents: null, fallbacks: memoryFallbackLog() })
    expect(calls.find((c) => c.fn === 'fail_email_step')?.args).toMatchObject({
      code: 'step_error',
      final: false
    })
  })
})
