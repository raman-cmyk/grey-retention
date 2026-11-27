// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
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
import { runEmailBuilds } from './worker'
import type { PlannedEmail } from './build'

/**
 * DES-ENGINE-004b: the worker hands a design step the Scratch ports only
 * with the switch on, only for a Scratch build (mode `scratch`, no
 * inspiration email, no upload), and never reads the build's mode with the
 * switch off.
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

function fakeDb(build: {
  mode: string
  reference_id: string | null
  upload_id: string | null
}) {
  const first = {
    id: 'build-1',
    tenant_id: tenant,
    state: 'build_queued',
    step: 'design',
    progress: { work: {} },
    run_id: 'run-1',
    slot: 0,
    planned,
    email: null,
    push_key: 'key-1',
    timezone: 'Asia/Kathmandu',
    start_on: inDays(1),
    lease_token: 'lease-1'
  }
  const reads: string[] = []
  const rpc = vi.fn(async () => ({ data: [], error: null }))
  const from = (table: string) => {
    const query: Record<string, unknown> = {
      select: (columns: string) => {
        reads.push(`${table}:${columns}`)
        return query
      },
      eq: () => query,
      neq: () => query,
      or: () => query,
      maybeSingle: async () => ({
        data: table === 'email_builds' ? build : null,
        error: null
      }),
      then: (done: (r: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(done)
    }
    return query
  }
  return { db: { rpc, from } as never, first: first as never, reads }
}

const waits = { ok: true, waiting: 'design', work: {}, seconds: 900 }
beforeEach(() => runStep.mockReset())

describe('Scratch from the library in the worker (DES-ENGINE-004b)', () => {
  const scratch = { mode: 'scratch', reference_id: null, upload_id: null }

  it('never reads the build’s mode nor gives the ports with the switch off', async () => {
    runStep.mockResolvedValueOnce(waits)
    const d = fakeDb(scratch)
    await runEmailBuilds(d.db, {
      agents: null,
      fallbacks: memoryFallbackLog(),
      first: d.first,
      scratch: false,
      library: false,
      uploads: false
    })
    expect(d.reads.some((r) => r.includes('mode'))).toBe(false)
    expect(runStep.mock.calls.at(-1)![2].library).toBeUndefined()
  })

  it('gives a Scratch build the Scratch ports with the switch on', async () => {
    runStep.mockResolvedValueOnce(waits)
    const d = fakeDb(scratch)
    await runEmailBuilds(d.db, {
      agents: null,
      fallbacks: memoryFallbackLog(),
      first: d.first,
      scratch: true,
      library: false,
      uploads: false
    })
    const ports = runStep.mock.calls.at(-1)![2].library
    expect(typeof ports?.scratch?.library).toBe('function')
    expect(typeof ports?.scratch?.stored).toBe('function')
  })

  it.each([
    ['a Copy build', { mode: 'copy', reference_id: 'e1', upload_id: null }],
    ['a Remix build', { mode: 'remix', reference_id: null, upload_id: null }],
    [
      'a Scratch build that follows an inspiration email',
      { mode: 'scratch', reference_id: 'e1', upload_id: null }
    ]
  ])('never takes the Scratch branch for %s', async (_, build) => {
    runStep.mockResolvedValueOnce(waits)
    const d = fakeDb(build)
    await runEmailBuilds(d.db, {
      agents: null,
      fallbacks: memoryFallbackLog(),
      first: d.first,
      scratch: true,
      library: true,
      uploads: false
    })
    expect(runStep.mock.calls.at(-1)![2].library?.scratch).toBeUndefined()
  })

  it('never takes the Scratch branch for a build that copies an upload', async () => {
    runStep.mockResolvedValueOnce(waits)
    const d = fakeDb({ mode: 'copy', reference_id: null, upload_id: 'u1' })
    await runEmailBuilds(d.db, {
      agents: null,
      fallbacks: memoryFallbackLog(),
      first: d.first,
      scratch: true,
      library: false,
      uploads: true
    })
    const ports = runStep.mock.calls.at(-1)![2].library
    expect(ports?.upload).toBe('u1')
    expect(ports?.scratch).toBeUndefined()
  })
})
