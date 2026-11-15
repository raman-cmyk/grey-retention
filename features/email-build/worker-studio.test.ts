// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
// ONB-057b: the plan made from the sample store, built on the sample store.
vi.mock('@/features/onboarding/store-source', async () => {
  const { sampleStoreFrom } = await import('./ports')
  return {
    planStore: async () => ({ own: false, sample: true }),
    storeForPlan: (_db: unknown, _plan: unknown, start: string) =>
      sampleStoreFrom(start)
  }
})
const runStep = vi.hoisted(() => vi.fn())
vi.mock('./steps', async (original) => ({
  ...(await original<typeof import('./steps')>()),
  runBuildStep: runStep
}))
import { memoryFallbackLog } from '@/features/fallback/log'
import { InMemoryMemoryStore } from '@/features/agents/memory'
import { InMemoryRunLog } from '@/features/agents/runtime'
import { fakeDraftPusher } from '@/lib/providers/klaviyo-draft'
import { runEmailBuilds } from './worker'
import { buildEmail, type PlannedEmail } from './build'
import { sampleOffers, sampleStoreSource } from './ports'

/**
 * DST-006b: a design step that waits for its pictures, and the design
 * studio's claim that takes it back. The steps are stubbed: these tests
 * are about the job.
 */
const tenant = '00000000-0000-4000-8000-000000000101'
const inDays = (n: number) => {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const planned: PlannedEmail = {
  date: inDays(2),
  time: '10:00',
  emailType: 'launch',
  angle: 'Meet the linen throw',
  products: [{ id: 'p-linen-throw', title: 'Linen throw' }],
  offer: null,
  audience: { id: 'sample-engaged', label: 'Engaged subscribers (sample)' }
}

type Call = { fn: string; args: Record<string, unknown> }
/**
 * One build on `step`, claimed already by the studio (`first`); after it,
 * nothing claims it again here; `wait` answers the wait with this error.
 */
function fakeDb(
  options: {
    step?: string
    wait?: { code: string; details?: string }
    /** After `finish_email_build`, the claim by name hands out the push. */
    push?: boolean
  } = {}
) {
  let built: unknown = null
  const first = {
    id: 'build-1',
    tenant_id: tenant,
    state: 'build_queued',
    step: options.step ?? 'design',
    progress: { work: { design: { round: 1, saves: 0 } } },
    run_id: 'run-1',
    slot: 0,
    planned,
    email: null,
    push_key: 'key-1',
    timezone: 'Asia/Kathmandu',
    start_on: inDays(1),
    lease_token: 'lease-1'
  }
  const calls: Call[] = []
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
    calls.push({ fn, args })
    if (fn === 'claim_email_build') {
      if (!options.push || !built) return { data: [], error: null }
      const email = built
      built = null
      return {
        data: [
          {
            ...first,
            state: 'push_queued',
            step: 'push',
            email,
            lease_token: 'lease-2'
          }
        ],
        error: null
      }
    }
    if (fn === 'finish_email_build') built = args.result
    if (fn === 'wait_email_round')
      return options.wait
        ? { data: null, error: options.wait }
        : { data: 2, error: null }
    return { data: fn === 'fail_email_step' ? 'failed' : null, error: null }
  })
  const query: Record<string, unknown> = {
    select: () => query,
    eq: () => query,
    neq: () => query,
    or: () => query,
    then: (done: (r: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(done)
  }
  return {
    db: { rpc, from: () => query } as never,
    calls,
    first: first as never
  }
}
const named = (calls: Call[], fn: string) => calls.filter((c) => c.fn === fn)
const waits = { ok: true, waiting: 'design', work: { round: 2 }, seconds: 900 }
const run = (d: ReturnType<typeof fakeDb>, deadline?: number) =>
  runEmailBuilds(d.db, {
    agents: null,
    fallbacks: memoryFallbackLog(),
    build: 'build-1',
    first: d.first,
    deadline
  })

beforeEach(() => runStep.mockReset())

describe('a design step waiting for its pictures (DST-006b)', () => {
  it('runs the studio’s claim first, with its work, then claims by name as the click does', async () => {
    runStep.mockResolvedValueOnce(waits)
    const d = fakeDb()
    expect(await run(d)).toEqual({ ran: 1 })
    expect(d.calls.map((c) => c.fn)).toEqual([
      'wait_email_round',
      'claim_email_build'
    ])
    expect(runStep.mock.calls[0][0]).toBe('design')
    expect(runStep.mock.calls[0][1].progress.work.design).toEqual({
      round: 1,
      saves: 0
    })
    // The work saved and the wait under the studio claim's own lease; the
    // build waits, so the click's claim by name finds nothing.
    expect(named(d.calls, 'wait_email_round')[0].args).toEqual({
      build: 'build-1',
      lease: 'lease-1',
      work: { round: 2 },
      seconds: 900
    })
    expect(named(d.calls, 'claim_email_build')[0].args).toEqual({
      target: 'build-1'
    })
    expect(named(d.calls, 'fail_email_step')).toEqual([])
  })

  it('runs a claimed build even when its deadline is near: its lease is held', async () => {
    runStep.mockResolvedValueOnce(waits)
    const d = fakeDb()
    expect(await run(d, Date.now() - 1)).toEqual({ ran: 1 })
    expect(named(d.calls, 'claim_email_build')).toEqual([])
  })

  it('fails the build when the pictures kept not coming (the seventh wait)', async () => {
    runStep.mockResolvedValueOnce(waits)
    const d = fakeDb({ wait: { code: '22023', details: 'too_many_waits' } })
    await run(d)
    expect(named(d.calls, 'fail_email_step')[0].args).toMatchObject({
      code: 'step_timed_out',
      final: true
    })
  })

  it('fails a wait the database refuses, and never fails one whose lease moved on', async () => {
    runStep.mockResolvedValueOnce(waits)
    const refused = fakeDb({ wait: { code: '22023' } })
    await run(refused)
    expect(named(refused.calls, 'fail_email_step')[0].args).toMatchObject({
      code: 'step_output_invalid',
      final: true
    })
    runStep.mockResolvedValueOnce(waits)
    const moved = fakeDb({ wait: { code: 'PT409' } })
    expect(await run(moved)).toEqual({ ran: 0 })
    expect(named(moved.calls, 'fail_email_step')).toEqual([])
  })

  it('never lets another step wait', async () => {
    runStep.mockResolvedValueOnce(waits)
    const d = fakeDb({ step: 'copy' })
    await run(d)
    expect(named(d.calls, 'wait_email_round')).toEqual([])
    expect(named(d.calls, 'fail_email_step')[0].args).toMatchObject({
      code: 'step_output_invalid',
      final: true
    })
  })

  it('goes on as the click does once the claimed step finishes: the push, by name', async () => {
    const made = await buildEmail(
      {
        planned,
        store: await sampleStoreSource.read(tenant),
        offers: sampleOffers
      },
      { tenantId: tenant, callerKey: 'x', fallbacks: memoryFallbackLog() }
    )
    if (!made.ok) throw new Error('sample build failed')
    runStep.mockResolvedValueOnce({
      ok: true,
      done: 'design',
      email: made.email
    })
    const d = fakeDb({ push: true })
    const pusher = fakeDraftPusher()
    expect(
      await runEmailBuilds(d.db, {
        agents: null,
        fallbacks: memoryFallbackLog(),
        first: d.first,
        pusher
      })
    ).toEqual({ ran: 2 })
    expect(d.calls.map((c) => c.fn)).toEqual([
      'finish_email_build',
      'claim_email_build',
      'finish_email_push',
      'claim_email_build'
    ])
    // Only this build, by name, under its own leases.
    expect(named(d.calls, 'claim_email_build').map((c) => c.args)).toEqual([
      { target: 'build-1' },
      { target: 'build-1' }
    ])
    expect(pusher.calls).toHaveLength(1)
    expect(pusher.calls[0]).toMatchObject({
      idempotencyKey: 'key-1',
      lease: { build: 'build-1', token: 'lease-2' }
    })
  })

  it('fails the step with its reason when the build is not on its design step', async () => {
    runStep.mockResolvedValueOnce(waits)
    const d = fakeDb({ wait: { code: 'PT409', details: 'not_design_step' } })
    await run(d)
    expect(named(d.calls, 'fail_email_step')[0].args).toMatchObject({
      code: 'step_output_invalid',
      final: true
    })
  })

  it('tries the step again later when the wait cannot be saved', async () => {
    runStep.mockResolvedValueOnce(waits)
    const d = fakeDb({ wait: { code: 'XX000' } })
    await run(d)
    expect(named(d.calls, 'fail_email_step')[0].args).toMatchObject({
      lease: 'lease-1',
      final: false
    })
    // A wait whose time is not a number is never sent.
    runStep.mockResolvedValueOnce({ ...waits, seconds: Number.NaN })
    const bad = fakeDb()
    await run(bad)
    expect(named(bad.calls, 'wait_email_round')).toEqual([])
    expect(named(bad.calls, 'fail_email_step')[0].args).toMatchObject({
      final: false
    })
  })

  it('runs a claimed build alone: never with another build named', async () => {
    const d = fakeDb()
    await expect(
      runEmailBuilds(d.db, { agents: null, build: 'build-2', first: d.first })
    ).rejects.toThrow('A claimed build runs alone')
    expect(d.calls).toEqual([])
  })

  it('gives the design step the studio’s ports only with the switch on and the agents (DST-006c)', async () => {
    const withAgents = {
      memory: new InMemoryMemoryStore(),
      log: new InMemoryRunLog(),
      ai: vi.fn()
    }
    for (const [options, given] of [
      [{ studio: true, agents: withAgents }, true],
      [{ studio: false, agents: withAgents }, false],
      [{ studio: true, agents: null }, false]
    ] as const) {
      runStep.mockResolvedValueOnce(waits)
      const d = fakeDb()
      await runEmailBuilds(d.db, {
        fallbacks: memoryFallbackLog(),
        first: d.first,
        ...options
      })
      expect(runStep.mock.calls.at(-1)![2].studio !== undefined).toBe(given)
    }
    // Never for another step.
    runStep.mockResolvedValueOnce(waits)
    const copy = fakeDb({ step: 'copy' })
    await runEmailBuilds(copy.db, {
      fallbacks: memoryFallbackLog(),
      first: copy.first,
      studio: true,
      agents: withAgents
    })
    expect(runStep.mock.calls.at(-1)![2].studio).toBeUndefined()
  })
})
