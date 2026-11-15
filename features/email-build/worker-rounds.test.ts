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
import { runEmailBuilds } from './worker'
import { buildEmail, type BuildAgents, type PlannedEmail } from './build'
import { maxStepSaves } from './step-names'
import { sampleOffers, sampleStoreSource } from './ports'

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
const planned: PlannedEmail = {
  date: inDays(2),
  time: '10:00',
  emailType: 'launch',
  angle: 'Meet the linen throw',
  products: [{ id: 'p-linen-throw', title: 'Linen throw' }],
  offer: null,
  audience: { id: 'sample-engaged', label: 'Engaged subscribers (sample)' }
}
const order = ['sections', 'content', 'copy', 'design']

type Call = { fn: string; args: Record<string, unknown> }
/**
 * A database with one build, as the real one keeps it: each claim gets a
 * new lease; a save keeps the work and lets the step be claimed again (the
 * 17th save is refused); a finished step moves on; a step that just moved
 * on or saved is claimed only by name for 30 seconds; a failure ends the
 * build here (its next try would wait a minute).
 */
function fakeDb(
  start = 'copy',
  fail: Record<string, { code: string; details?: string }> = {}
) {
  let build: Record<string, unknown> | null = {
    id: 'build-1',
    tenant_id: tenant,
    state: 'build_queued',
    step: start,
    progress: Object.fromEntries(
      order.slice(0, order.indexOf(start)).map((s) => [s, {}])
    ),
    run_id: 'run-1',
    slot: 0,
    planned,
    email: null,
    push_key: 'key-1',
    timezone: 'Asia/Kathmandu',
    start_on: inDays(1)
  }
  let leases = 0
  let leased = false
  let moved = false
  let saves = 0
  const calls: Call[] = []
  const set = (over: Record<string, unknown>) => {
    build = { ...build, ...over }
    leased = false
    moved = true
  }
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
    calls.push({ fn, args })
    if (fail[fn]) return { data: null, error: fail[fn] }
    if (fn === 'claim_email_build') {
      if (!build || leased || (moved && !args.target))
        return { data: [], error: null }
      leased = true
      return { data: [{ ...build, lease_token: `lease-${++leases}` }] }
    }
    const progress = (build?.progress ?? {}) as Record<string, unknown>
    if (fn === 'save_email_round') {
      if (++saves > maxStepSaves)
        return {
          data: null,
          error: { code: '22023', details: 'too_many_rounds' }
        }
      set({
        progress: {
          ...progress,
          work: { [String(args.step)]: { ...(args.work as object), saves } }
        }
      })
      return { data: saves, error: null }
    }
    if (fn === 'finish_email_step') {
      const done = String(args.done)
      const next = order[order.indexOf(done) + 1]
      set({ step: next, progress: { ...progress, [done]: args.output } })
      return { data: next, error: null }
    }
    if (fn === 'finish_email_build') {
      set({ state: 'push_queued', step: 'push', email: args.result })
      return { data: null, error: null }
    }
    build = null
    return { data: fn === 'fail_email_step' ? 'retry' : null, error: null }
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
const named = (calls: Call[], fn: string) => calls.filter((c) => c.fn === fn)
const sampleEmail = async () => {
  const built = await buildEmail(
    {
      planned,
      store: await sampleStoreSource.read(tenant),
      offers: sampleOffers
    },
    { tenantId: tenant, callerKey: 'x', fallbacks: memoryFallbackLog() }
  )
  if (!built.ok) throw new Error('sample build failed')
  return built.email
}
const saveCopy = { ok: true, saved: 'copy', work: { round: 1 } }

beforeEach(() => runStep.mockReset())

describe('a step that saves its rounds (REL-AI part 2b)', () => {
  it('is claimed again at once and goes on from its saved rounds', async () => {
    runStep
      .mockResolvedValueOnce(saveCopy)
      .mockResolvedValueOnce({ ok: true, done: 'copy', output: { draft: 1 } })
    const { db, calls } = fakeDb()
    await runEmailBuilds(db, {
      agents: null,
      fallbacks: memoryFallbackLog(),
      build: 'build-1'
    })
    expect(named(calls, 'save_email_round')[0].args).toEqual({
      build: 'build-1',
      lease: 'lease-1',
      step: 'copy',
      work: { round: 1 }
    })
    // The second claim's step sees the saved rounds, under its own lease.
    expect(runStep.mock.calls[1][0]).toBe('copy')
    expect(runStep.mock.calls[1][1].progress.work.copy).toEqual({
      round: 1,
      saves: 1
    })
    expect(named(calls, 'finish_email_step')[0].args).toMatchObject({
      lease: 'lease-2',
      done: 'copy'
    })
  })

  it('one click reaches the push with every save a step may make', async () => {
    const built = await sampleEmail()
    let copyClaims = 0
    runStep.mockImplementation(async (step: string) => {
      if (step === 'copy' && ++copyClaims <= maxStepSaves) return saveCopy
      return step === 'design'
        ? { ok: true, done: 'design', email: built }
        : { ok: true, done: step, output: {} }
    })
    const { db, calls } = fakeDb('sections')
    await runEmailBuilds(db, {
      agents: null,
      fallbacks: memoryFallbackLog(),
      build: 'build-1'
    })
    expect(named(calls, 'save_email_round')).toHaveLength(maxStepSaves)
    expect(named(calls, 'finish_email_push')).toHaveLength(1)
    expect(named(calls, 'fail_email_step')).toEqual([])
  })

  it('the sweep takes a build it moved on through its steps by name, in one run', async () => {
    const email = await sampleEmail()
    runStep.mockImplementation(async (step: string) =>
      step === 'copy' && runStep.mock.calls.length === 3
        ? saveCopy
        : step === 'design'
          ? { ok: true, done: 'design', email }
          : { ok: true, done: step, output: {} }
    )
    const { db, calls } = fakeDb('sections')
    await runEmailBuilds(db, { agents: null, fallbacks: memoryFallbackLog() })
    expect(named(calls, 'finish_email_push')).toHaveLength(1)
    const claims = named(calls, 'claim_email_build').map((c) => c.args)
    // The first claim is the sweep's; then the build it moved, by name (its
    // content, copy twice, design, push, then drafted: nothing); then any
    // other build.
    expect(claims).toEqual([
      {},
      ...Array.from({ length: 6 }, () => ({ target: 'build-1' })),
      {}
    ])
  })

  it('the save the database refuses after the last one fails the build: it kept stopping', async () => {
    runStep.mockResolvedValue(saveCopy)
    const { db, calls } = fakeDb()
    await runEmailBuilds(db, {
      agents: null,
      fallbacks: memoryFallbackLog(),
      build: 'build-1'
    })
    expect(named(calls, 'save_email_round')).toHaveLength(maxStepSaves + 1)
    expect(named(calls, 'fail_email_step')[0].args).toMatchObject({
      code: 'step_timed_out',
      final: true
    })
  })

  it('another refused save fails the build for good', async () => {
    runStep.mockResolvedValueOnce(saveCopy)
    const { db, calls } = fakeDb('copy', {
      save_email_round: { code: '22023' }
    })
    await runEmailBuilds(db, { agents: null, fallbacks: memoryFallbackLog() })
    expect(named(calls, 'fail_email_step')[0].args).toMatchObject({
      build: 'build-1',
      code: 'step_output_invalid',
      final: true
    })
  })

  it('a save that lost its lease is tried again', async () => {
    runStep.mockResolvedValueOnce(saveCopy)
    const { db, calls } = fakeDb('copy', {
      save_email_round: { code: 'PT409' }
    })
    await runEmailBuilds(db, { agents: null, fallbacks: memoryFallbackLog() })
    expect(named(calls, 'fail_email_step')[0].args).toMatchObject({
      code: 'step_error',
      final: false
    })
  })

  it('rounds of another step are not saved', async () => {
    runStep.mockResolvedValueOnce({ ok: true, saved: 'design', work: {} })
    const { db, calls } = fakeDb()
    await runEmailBuilds(db, { agents: null, fallbacks: memoryFallbackLog() })
    expect(named(calls, 'save_email_round')).toEqual([])
    expect(named(calls, 'fail_email_step')[0].args).toMatchObject({
      code: 'step_output_invalid',
      final: true
    })
  })

  it('with the agents, the click claims again only while a whole step fits', async () => {
    let now = 0
    runStep.mockImplementation(async () => {
      now += 30_000
      return saveCopy
    })
    const agents: BuildAgents = {
      memory: new InMemoryMemoryStore(),
      log: new InMemoryRunLog(),
      ai: async () => ({ ok: false, code: 'setup_required' })
    }
    const { db, calls } = fakeDb()
    await runEmailBuilds(db, {
      agents,
      fallbacks: memoryFallbackLog(),
      build: 'build-1',
      deadline: 110_000,
      now: () => now
    })
    // Claims at 0, 30 and 60 s; at 90 s a 50-second step no longer fits.
    expect(named(calls, 'claim_email_build')).toHaveLength(3)
    expect(named(calls, 'save_email_round')).toHaveLength(3)
  })
})
