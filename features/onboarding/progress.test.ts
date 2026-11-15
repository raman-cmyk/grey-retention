import { describe, expect, it, vi } from 'vitest'
import {
  progressFrom,
  readOnboardingProgress,
  readerKinds,
  targetSeconds,
  type JobRow,
  type PlanRow
} from './progress'

const signedUpAt = '2026-11-15T10:00:00.000Z'
const at = (min: number, sec = 0) =>
  new Date(Date.parse(signedUpAt) + (min * 60 + sec) * 1000).toISOString()
const job = (
  kind: string,
  status: string,
  from: number,
  to: number = from
): JobRow => ({ kind, status, created_at: at(from), updated_at: at(to) })
const plan = (state: string, from: number, to: number = from): PlanRow => ({
  state,
  created_at: at(from),
  updated_at: at(to)
})
const states = (p: ReturnType<typeof progressFrom>) =>
  Object.fromEntries(p.steps.map((s) => [s.key, s.state]))

describe('progressFrom (ONB-066)', () => {
  it('shows nothing started right after sign-up', () => {
    const p = progressFrom({
      signedUpAt,
      jobs: [],
      plans: [],
      now: new Date(at(1))
    })
    expect(p.steps.map((s) => [s.key, s.label])).toEqual([
      ['site', 'Reading your website'],
      ['catalog', 'Reading your products'],
      ['history', 'Reading what you sent in Klaviyo'],
      ['ads', 'Reading your ads'],
      ['reviews', 'Reading your reviews'],
      ['plan', 'Your first 15-day plan']
    ])
    expect(p).toMatchObject({
      done: 0,
      elapsedSeconds: 60,
      firstPlanSeconds: null,
      onTarget: null
    })
    expect(
      p.steps.every((s) => s.state === 'not_started' && s.seconds === null)
    ).toBe(true)
  })

  it('follows each reader’s newest read', () => {
    const p = progressFrom({
      signedUpAt,
      jobs: [
        job(readerKinds.site, 'failed', 0, 1),
        job(readerKinds.site, 'succeeded', 2, 3),
        job(readerKinds.catalog, 'running', 1),
        job(readerKinds.history, 'retry_wait', 1),
        job(readerKinds.ads, 'queued', 4),
        job(readerKinds.reviews, 'cancelled', 1, 2),
        job('email.rewrite', 'running', 1)
      ],
      plans: [],
      now: new Date(at(5))
    })
    expect(states(p)).toEqual({
      site: 'done',
      catalog: 'working',
      history: 'working',
      ads: 'waiting',
      reviews: 'failed',
      plan: 'not_started'
    })
    const site = p.steps.find((s) => s.key === 'site')!
    expect(site).toMatchObject({
      startedAt: at(2),
      finishedAt: at(3),
      seconds: 60
    })
    // Still working: the time so far.
    expect(p.steps.find((s) => s.key === 'catalog')!.seconds).toBe(240)
    expect(p.done).toBe(1)
  })

  it('times the first plan against the ten-minute target', () => {
    const quick = progressFrom({
      signedUpAt,
      jobs: [],
      plans: [plan('planned', 6, 8), plan('planned', 20, 21)],
      now: new Date(at(30))
    })
    expect(quick.steps.at(-1)).toMatchObject({
      state: 'done',
      startedAt: at(6),
      finishedAt: at(8),
      seconds: 120
    })
    expect(quick).toMatchObject({ firstPlanSeconds: 480, onTarget: true })
    const slow = progressFrom({
      signedUpAt,
      jobs: [],
      plans: [plan('planned', 9, 11)],
      now: new Date(at(30))
    })
    expect(slow).toMatchObject({ firstPlanSeconds: 660, onTarget: false })
    expect(targetSeconds).toBe(600)
  })

  it('says a plan is working or failed until one is planned, and late once ten minutes pass', () => {
    const working = progressFrom({
      signedUpAt,
      jobs: [],
      plans: [plan('failed', 2, 3), plan('plan_queued', 4)],
      now: new Date(at(9))
    })
    expect(working.steps.at(-1)).toMatchObject({
      state: 'working',
      seconds: 300
    })
    expect(working.onTarget).toBeNull()
    const failed = progressFrom({
      signedUpAt,
      jobs: [],
      plans: [plan('failed', 2, 3)],
      now: new Date(at(12))
    })
    expect(failed.steps.at(-1)).toMatchObject({
      state: 'failed',
      finishedAt: at(3)
    })
    expect(failed.onTarget).toBe(false)
  })
})

describe('readOnboardingProgress (ONB-066)', () => {
  const tenantId = '00000000-0000-4000-8000-000000000101'
  function db(answers: Record<string, { data: unknown; error: unknown }>) {
    const calls: {
      table: string
      eq: [string, unknown][]
      inKind?: unknown
    }[] = []
    const client = {
      from(table: string) {
        const call = {
          table,
          eq: [] as [string, unknown][],
          inKind: undefined as unknown
        }
        calls.push(call)
        const chain = {
          select: () => chain,
          eq: (c: string, v: unknown) => (call.eq.push([c, v]), chain),
          in: (_c: string, v: unknown) => ((call.inKind = v), chain),
          order: () => chain,
          limit: async () => answers[table],
          maybeSingle: async () => answers[table]
        }
        return chain
      }
    }
    return { client: client as never, calls }
  }

  it('reads only this workspace', async () => {
    const { client, calls } = db({
      tenants: { data: { created_at: signedUpAt }, error: null },
      job_runs: {
        data: [job(readerKinds.site, 'succeeded', 0, 2)],
        error: null
      },
      strategy_runs: { data: [], error: null }
    })
    const p = await readOnboardingProgress(client, tenantId, new Date(at(3)))
    expect(p?.done).toBe(1)
    expect(calls.map((c) => [c.table, c.eq])).toEqual([
      ['tenants', [['id', tenantId]]],
      ['job_runs', [['tenant_id', tenantId]]],
      ['strategy_runs', [['tenant_id', tenantId]]]
    ])
    expect(calls[1]!.inKind).toEqual(Object.values(readerKinds))
  })

  it('is null when a read fails or the workspace is not there', async () => {
    const ok = { data: [], error: null }
    expect(
      await readOnboardingProgress(
        db({
          tenants: { data: null, error: null },
          job_runs: ok,
          strategy_runs: ok
        }).client,
        tenantId
      )
    ).toBeNull()
    expect(
      await readOnboardingProgress(
        db({
          tenants: { data: { created_at: signedUpAt }, error: null },
          job_runs: { data: null, error: { code: '42501' } },
          strategy_runs: ok
        }).client,
        tenantId
      )
    ).toBeNull()
    vi.restoreAllMocks()
  })
})
