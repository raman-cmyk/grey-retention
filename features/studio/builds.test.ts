// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('server-only', () => ({}))
const worker = vi.hoisted(() => ({ runEmailBuilds: vi.fn() }))
vi.mock('@/features/email-build/worker', () => worker)
const service = vi.hoisted(() => ({ createServiceClient: vi.fn() }))
vi.mock('@/lib/supabase/service', () => service)
import { GET } from '@/app/api/internal/studio/builds/route'
import { InMemoryMemoryStore } from '@/features/agents/memory'
import { InMemoryRunLog } from '@/features/agents/runtime'
import { stepBudgetMs } from '@/features/email-build/steps'
import { runStudioBuilds, studioBuildsPerRun } from './builds'

const agents = {
  memory: new InMemoryMemoryStore(),
  log: new InMemoryRunLog(),
  ai: vi.fn()
}
const on = { DESIGN_STUDIO: 'on', EMAIL_BUILD_AGENTS: 'on' }
const env = (e: object) => e as NodeJS.ProcessEnv
/** A database whose studio claims hand out `ids`, one per claim, then none. */
function database(ids: string[] = ['b1', 'b2']) {
  const left = [...ids]
  const calls: unknown[][] = []
  return {
    calls,
    from: (table: string) => {
      calls.push(['from', table])
      throw new Error('no table read here')
    },
    rpc: vi.fn(async (fn: string, args: unknown) => {
      calls.push([fn, args])
      const id = left.shift()
      return {
        data: id ? [{ id, lease_token: `lease-${id}` }] : [],
        error: null
      }
    })
  }
}
const db = (d: ReturnType<typeof database>) =>
  d as unknown as Parameters<typeof runStudioBuilds>[0]

beforeEach(() => worker.runEmailBuilds.mockResolvedValue({ ran: 2 }))
afterEach(() => {
  worker.runEmailBuilds.mockReset()
  vi.unstubAllEnvs()
})

describe('the design studio’s job (DST-006b)', () => {
  it('claims nothing unless both owner’s switches are on and a model is set up', async () => {
    for (const e of [
      {},
      { DESIGN_STUDIO: 'on' },
      { EMAIL_BUILD_AGENTS: 'on' },
      { DESIGN_STUDIO: 'off', EMAIL_BUILD_AGENTS: 'on' },
      // Both on, but the fake model (no live one set up): still off.
      { ...on, AI_DEFAULT_PROVIDER: 'fake' }
    ]) {
      const d = database()
      expect(
        await runStudioBuilds(db(d), {
          deadline: Date.now() + 60_000,
          env: env(e)
        })
      ).toEqual({ off: true, builds: 0, ran: 0 })
      expect(d.calls).toEqual([])
    }
    expect(worker.runEmailBuilds).not.toHaveBeenCalled()
  })

  it('claims the ready waiting steps one by one and runs each with the agents, from its claim', async () => {
    const d = database()
    const deadline = Date.now() + 60_000
    expect(
      await runStudioBuilds(db(d), { deadline, env: env(on), agents })
    ).toEqual({ off: false, builds: 2, ran: 4 })
    // Unnamed claims: the database picks the one waiting longest that is ready.
    expect(d.calls).toEqual([
      ['claim_studio_build', {}],
      ['claim_studio_build', {}],
      ['claim_studio_build', {}]
    ])
    expect(worker.runEmailBuilds.mock.calls.map((c) => c[1])).toEqual([
      expect.objectContaining({
        build: 'b1',
        first: { id: 'b1', lease_token: 'lease-b1' },
        agents,
        deadline
      }),
      expect.objectContaining({
        build: 'b2',
        first: { id: 'b2', lease_token: 'lease-b2' },
        agents,
        deadline
      })
    ])
  })

  it('claims at most 5 a run, and only while a whole agent step fits before its deadline', async () => {
    const many = database(['b1', 'b2', 'b3', 'b4', 'b5', 'b6'])
    expect(
      (
        await runStudioBuilds(db(many), {
          deadline: Date.now() + 60_000,
          env: env(on),
          agents
        })
      ).builds
    ).toBe(studioBuildsPerRun)
    let t = 0
    worker.runEmailBuilds.mockImplementation(async () => {
      t += 20_000
      return { ran: 1 }
    })
    const d = database(['b1', 'b2', 'b3'])
    const result = await runStudioBuilds(db(d), {
      deadline: stepBudgetMs + 30_000,
      env: env(on),
      agents,
      now: () => t
    })
    // b1 at 0 and b2 at 20 s fit (each needs a whole step); at 40 s no
    // claim is made, so no lease is taken for nothing.
    expect(result).toEqual({ off: false, builds: 2, ran: 2 })
    expect(d.calls).toHaveLength(2)
  })
})

describe('the design studio’s job when a build throws (DST-006b)', () => {
  it('stops claiming, and says so', async () => {
    worker.runEmailBuilds.mockRejectedValueOnce(
      Object.assign(new Error('down'), { code: 'XX000' })
    )
    const d = database()
    await expect(
      runStudioBuilds(db(d), {
        deadline: Date.now() + 60_000,
        env: env(on),
        agents
      })
    ).rejects.toMatchObject({ code: 'XX000' })
    expect(d.calls).toEqual([['claim_studio_build', {}]])
  })
})

describe('the design studio’s route (DST-006b)', () => {
  const secret = 's'.repeat(40)
  const req = (headers: Record<string, string> = {}) =>
    new NextRequest('https://app.test/api/internal/studio/builds', { headers })
  const auth = { authorization: `Bearer ${secret}` }
  beforeEach(() => vi.stubEnv('CRON_SECRET', secret))
  afterEach(() => service.createServiceClient.mockReset())

  it('answers only the cron secret, and says when the server has no database', async () => {
    expect((await GET(req())).status).toBe(401)
    expect((await GET(req({ authorization: 'Bearer x' }))).status).toBe(401)
    service.createServiceClient.mockReturnValue(null)
    expect((await GET(req(auth))).status).toBe(503)
  })

  it('says the studio is off while the owner’s switches are off, claiming nothing', async () => {
    vi.stubEnv('DESIGN_STUDIO', '')
    const d = database()
    service.createServiceClient.mockReturnValue(d)
    const answer = await GET(req(auth))
    expect(answer.headers.get('cache-control')).toBe('no-store')
    expect(await answer.json()).toEqual({ off: true, builds: 0, ran: 0 })
    expect(d.calls).toEqual([])
  })

  it('says when the waiting designs could not go on', async () => {
    vi.stubEnv('DESIGN_STUDIO', 'on')
    vi.stubEnv('EMAIL_BUILD_AGENTS', 'on')
    vi.stubEnv('AI_DEFAULT_PROVIDER', 'gemini')
    vi.stubEnv('GEMINI_API_KEY', 'k'.repeat(39))
    const d = database()
    d.rpc.mockResolvedValue({
      data: null,
      error: { code: 'XX000', message: 'down' }
    } as never)
    service.createServiceClient.mockReturnValue(d)
    const answer = await GET(req(auth))
    expect(answer.status).toBe(500)
    expect(await answer.json()).toEqual({
      error: 'Waiting designs could not go on; they stay waiting.'
    })
  })
})
