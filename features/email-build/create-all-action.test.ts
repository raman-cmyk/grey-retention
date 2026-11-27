// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const auth = vi.hoisted(() => ({ requireRequestContext: vi.fn() }))
const supabase = vi.hoisted(() => ({ createClient: vi.fn() }))
const service = vi.hoisted(() => ({ client: null as unknown }))
const after = vi.hoisted(() => vi.fn())
const load = vi.hoisted(() => ({ latestPlanRun: vi.fn() }))
const agents = vi.hoisted(() => ({ emailAgentsReady: vi.fn(() => false) }))
const worker = vi.hoisted(() => ({ runEmailBuilds: vi.fn() }))
vi.mock('@/features/auth/application/request-context', () => auth)
vi.mock('@/lib/supabase/server', () => supabase)
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => service.client
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('next/server', () => ({ after }))
vi.mock('./worker', () => worker)
vi.mock('./agents', () => agents)
vi.mock('@/features/klaviyo-push/live', () => ({
  draftPusherFor: () => ({ createDraft: vi.fn() })
}))
vi.mock('@/features/strategy/load', () => load)

import { redirect } from 'next/navigation'
import type { PlanRun, EmailBuildView } from '@/features/strategy/load'
import { createAllEmails } from './actions'

const tenantId = '00000000-0000-4000-8000-000000000101'
const runId = '00000000-0000-4000-8000-0000000000aa'

const slot = (date: string, over: Record<string, unknown> = {}) => ({
  date,
  time: '18:00',
  emailType: 'bestseller',
  angle: 'Our best candle.',
  products: [{ id: 'p1', title: 'Cedar candle' }],
  offer: null,
  audience: { id: 'a1', label: 'Past buyers' },
  why: 'It sells most in November.',
  evidence: [],
  ...over
})

const days = ['2026-11-20', '2026-11-17', '2026-11-24', '2026-11-27']
const planRun = (
  builds: Record<number, EmailBuildView> = {},
  over: Partial<PlanRun> = {}
): PlanRun => ({
  id: runId,
  state: 'planned',
  reason: null,
  startOn: '2026-11-17',
  stale: false,
  pulse: null,
  plan: {
    start: '2026-11-17',
    end: '2026-12-01',
    dropped: 0,
    brief: [],
    notes: [],
    source: { brief: 'code', planner: 'code', critic: 'skipped' },
    slots: days.map((d, i) =>
      slot(d, i === 2 ? { format: 'text', emailType: 'story' } : {})
    ),
    sample: true
  } as unknown as PlanRun['plan'],
  builds,
  today: '2026-11-16',
  sendPassed: days.map(() => false),
  ...over
})

const built = (id: string, state: EmailBuildView['state']): EmailBuildView => ({
  id,
  state,
  step: 'copy',
  sampleDraft: state === 'drafted',
  reason: state === 'failed' ? 'Its design could not be drawn.' : null
})

const form = (fields: Record<string, string>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.append(k, v)
  return f
}

/**
 * The command, as `email_builds_one_open` keeps it: one open build per
 * planned email, so asking again returns the same build.
 */
const open = new Map<number, string>()
type Answer = {
  data: string | undefined
  error: { code: string; message: string } | null
}
const command = async (
  _name: string,
  args: { slot: number }
): Promise<Answer> => {
  if (!open.has(args.slot)) open.set(args.slot, `build-${args.slot}`)
  return { data: open.get(args.slot), error: null }
}
const rpc = vi.fn(command)
const cycle = vi.fn()
const from = vi.fn(() => {
  const q = {
    select: () => q,
    eq: () => q,
    order: () => q,
    limit: () => q,
    maybeSingle: cycle
  }
  return q
})

beforeEach(() => {
  vi.clearAllMocks()
  open.clear()
  rpc.mockImplementation(command)
  service.client = null
  auth.requireRequestContext.mockResolvedValue({
    tenantId,
    tenantRole: 'owner',
    timezone: 'UTC'
  })
  supabase.createClient.mockResolvedValue({ rpc, from })
  load.latestPlanRun.mockResolvedValue({ ok: true, run: planRun() })
  agents.emailAgentsReady.mockReturnValue(false)
  cycle.mockResolvedValue({
    data: { allocation_micro: 100, used_micro: 10, reserved_micro: 0 },
    error: null
  })
})

const slotsAsked = () => rpc.mock.calls.map(([, a]) => a.slot)

describe('Create all emails (PICK-102)', () => {
  it('queues every planned email through the one command, earliest first, and builds them after the reply', async () => {
    const answer = await createAllEmails({}, form({ run: runId }))
    // Screen order: 17, 20, 24, 27 Nov.
    expect(slotsAsked()).toEqual([1, 0, 2, 3])
    for (const [name, args] of rpc.mock.calls) {
      expect(name).toBe('create_email_build')
      // Scratch (the command's default), as one click without a choice.
      expect(Object.keys(args).sort()).toEqual(['run', 'slot', 't'])
      expect(args).toMatchObject({ t: tenantId, run: runId })
    }
    expect(answer).toEqual({
      message:
        'Creating 4 emails. Each lands in Klaviyo as a draft; nothing is sent or scheduled. You can leave this page.'
    })
    expect(after).toHaveBeenCalledOnce()
    expect(redirect).not.toHaveBeenCalled()
  })

  it('builds them one at a time, by name, inside the click’s one budget', async () => {
    service.client = { service: true }
    let running = 0
    let most = 0
    worker.runEmailBuilds.mockImplementation(async () => {
      most = Math.max(most, ++running)
      await Promise.resolve()
      running--
      return { ran: 1 }
    })
    await createAllEmails({}, form({ run: runId }))
    await after.mock.calls[0]![0]()
    const runs = worker.runEmailBuilds.mock.calls.map(([, deps]) => deps)
    expect(runs.map((d) => d.build)).toEqual([
      'build-1',
      'build-0',
      'build-2',
      'build-3'
    ])
    expect(new Set(runs.map((d) => d.deadline)).size).toBe(1)
    expect(most).toBe(1)
  })

  it('skips emails that already have a build: made, being made or failed', async () => {
    load.latestPlanRun.mockResolvedValue({
      ok: true,
      run: planRun({
        0: built('b0', 'drafted'),
        1: built('b1', 'build_queued'),
        3: built('b3', 'failed')
      })
    })
    const answer = await createAllEmails({}, form({ run: runId }))
    expect(slotsAsked()).toEqual([2])
    expect(answer.message).toContain('Creating 1 email.')
    expect(answer.message).toContain(
      '1 email that failed before keeps its own Try again.'
    )
  })

  it('never makes a second build on a second click or another tab', async () => {
    // Both tabs read the plan before either queued anything.
    const [a, b] = await Promise.all([
      createAllEmails({}, form({ run: runId })),
      createAllEmails({}, form({ run: runId }))
    ])
    expect(a).toEqual(b)
    expect(open.size).toBe(4)
    // The plan read again: every email has its build, nothing is asked.
    rpc.mockClear()
    after.mockClear()
    load.latestPlanRun.mockResolvedValue({
      ok: true,
      run: planRun(
        Object.fromEntries(
          [0, 1, 2, 3].map((s) => [s, built(`build-${s}`, 'build_queued')])
        )
      )
    })
    expect(await createAllEmails({}, form({ run: runId }))).toEqual({
      message: 'Every email in this plan is already made or being made.'
    })
    expect(rpc).not.toHaveBeenCalled()
    expect(after).not.toHaveBeenCalled()
  })

  it('never queues an email whose send time has passed', async () => {
    load.latestPlanRun.mockResolvedValue({
      ok: true,
      run: planRun({}, { sendPassed: [false, true, false, false] })
    })
    await createAllEmails({}, form({ run: runId }))
    expect(slotsAsked()).toEqual([0, 2, 3])
  })

  it('says which emails a limit stopped and why, and builds the rest', async () => {
    rpc.mockImplementation(async (_name, args) => {
      if (args.slot === 0)
        return {
          data: undefined,
          error: {
            code: 'PT409',
            message: 'This email failed 5 times; plan again'
          }
        }
      if (args.slot === 3)
        return {
          data: undefined,
          error: { code: 'PT409', message: "This email's day has passed" }
        }
      return { data: `build-${args.slot}`, error: null }
    })
    const answer = await createAllEmails({}, form({ run: runId }))
    expect(answer.error).toBeUndefined()
    expect(answer.message).toContain('Creating 2 emails.')
    expect(answer.message).toContain(
      'Not started: Fri 20, “Bestseller: Cedar candle”. This email could not be made after 5 tries. Plan again for new emails.'
    )
    expect(answer.message).toContain(
      'Not started: Fri 27, “Bestseller: Cedar candle”. This email’s day has passed or the plan has changed. Plan again to create it.'
    )
    expect(after).toHaveBeenCalledOnce()
  })

  it('is an error when every email was refused, and starts no build', async () => {
    rpc.mockResolvedValue({
      data: undefined,
      error: { code: 'PT409', message: 'This email failed 5 times; plan again' }
    } as never)
    const answer = await createAllEmails({}, form({ run: runId }))
    expect(answer.message).toBeUndefined()
    expect(answer.error).toMatch(/^Not started: Tue 17, /)
    expect(after).not.toHaveBeenCalled()
  })

  it('stops at once when the command refuses the whole plan', async () => {
    rpc.mockResolvedValue({
      data: undefined,
      error: {
        code: 'PT409',
        message: 'This plan has been replaced; use the latest plan'
      }
    } as never)
    expect(await createAllEmails({}, form({ run: runId }))).toEqual({
      error: 'This plan has been replaced. Reload the page to see the latest.'
    })
    expect(rpc).toHaveBeenCalledOnce()
    expect(after).not.toHaveBeenCalled()
  })

  it('says when the AI allowance is used up: the emails are made by code only', async () => {
    agents.emailAgentsReady.mockReturnValue(true)
    cycle.mockResolvedValue({
      data: { allocation_micro: 100, used_micro: 90, reserved_micro: 10 },
      error: null
    })
    const used = await createAllEmails({}, form({ run: runId }))
    expect(used.message).toContain(
      'Your AI allowance is used up, so these emails are made by code only, without the AI.'
    )
    open.clear()
    cycle.mockResolvedValue({
      data: { allocation_micro: 100, used_micro: 10, reserved_micro: 0 },
      error: null
    })
    const room = await createAllEmails({}, form({ run: runId }))
    expect(room.message).toContain('The AI team makes them one at a time')
    // Without the agents, the allowance is not read and not mentioned.
    agents.emailAgentsReady.mockReturnValue(false)
    cycle.mockClear()
    const code = await createAllEmails({}, form({ run: runId }))
    expect(code.message).not.toContain('AI')
    expect(cycle).not.toHaveBeenCalled()
  })

  it('is the owner’s only, before anything is read', async () => {
    for (const tenantRole of ['staff', 'admin']) {
      auth.requireRequestContext.mockResolvedValue({
        tenantId,
        tenantRole,
        timezone: 'UTC'
      })
      expect(await createAllEmails({}, form({ run: runId }))).toEqual({
        error: 'Only this workspace’s owner creates emails.'
      })
    }
    expect(load.latestPlanRun).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
    expect(after).not.toHaveBeenCalled()
  })

  it('stops when the command says the caller is no longer the owner', async () => {
    rpc.mockResolvedValue({
      data: undefined,
      error: { code: '42501', message: 'Access denied' }
    } as never)
    expect(await createAllEmails({}, form({ run: runId }))).toEqual({
      error: 'Only this workspace’s owner creates emails.'
    })
    expect(rpc).toHaveBeenCalledOnce()
  })

  it('refuses an old tab’s plan, a broken form and a plan not ready', async () => {
    expect(await createAllEmails({}, form({ run: 'x' }))).toEqual({
      error: 'Reload the page to see your plan.'
    })
    expect(
      await createAllEmails(
        {},
        form({ run: '00000000-0000-4000-8000-0000000000ff' })
      )
    ).toEqual({
      error: 'This plan has been replaced. Reload the page to see the latest.'
    })
    load.latestPlanRun.mockResolvedValue({
      ok: true,
      run: planRun({}, { state: 'plan_queued' })
    })
    expect(await createAllEmails({}, form({ run: runId }))).toEqual({
      error: 'This plan is not ready yet. Reload the page.'
    })
    load.latestPlanRun.mockResolvedValue({ ok: false })
    expect(await createAllEmails({}, form({ run: runId }))).toEqual({
      error: 'Creating emails is unavailable right now.'
    })
    expect(rpc).not.toHaveBeenCalled()
  })
})
