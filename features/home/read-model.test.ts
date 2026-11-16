// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({
  latestPlanRun: vi.fn(),
  resultsReadModel: vi.fn(),
  offersPage: vi.fn(),
  createClient: vi.fn()
}))
vi.mock('@/features/strategy/load', async (original) => ({
  ...(await original<typeof import('@/features/strategy/load')>()),
  latestPlanRun: mocks.latestPlanRun
}))
vi.mock('@/features/results/read-model', () => ({
  resultsReadModel: mocks.resultsReadModel
}))
vi.mock('@/features/offers/data', () => ({ offersPage: mocks.offersPage }))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))

import type { ResultLine } from '@/features/results/read-model'
import type { PlanRun } from '@/features/strategy/load'
import {
  addDays,
  greeting,
  homeReadModel,
  homeView,
  topLearned,
  type HomeInput
} from './read-model'

// 10:00 in New York on Monday 16 November 2026.
const now = new Date('2026-11-16T15:00:00Z')
const context = {
  tenantId: 'tenant-1',
  tenantName: 'Cedar Lane',
  tenantRole: 'owner' as const,
  timezone: 'America/New_York',
  kind: 'client' as const,
  userId: 'user-1',
  tenantSlug: 'cedar-lane'
}

const slot = (
  date: string,
  angle: string,
  extra: Partial<NonNullable<PlanRun['plan']>['slots'][number]> = {}
) => ({
  date,
  time: '10:00',
  emailType: 'launch' as const,
  angle,
  products: [],
  offer: null,
  audience: { id: 'a1', label: 'Past buyers' },
  why: 'Because',
  evidence: [],
  ...extra
})

function run(overrides: Partial<PlanRun> = {}): PlanRun {
  return {
    id: 'run-1',
    state: 'planned',
    reason: null,
    startOn: '2026-11-16',
    stale: false,
    pulse: null,
    plan: {
      start: '2026-11-16',
      end: '2026-11-30',
      dropped: 0,
      brief: [],
      notes: [],
      source: { brief: 'code', planner: 'code', critic: 'skipped' },
      slots: [
        slot('2026-11-16', 'The fall edit'),
        slot('2026-11-18', 'A note from us', { format: 'text' }),
        slot('2026-11-20', 'Back in stock'),
        slot('2026-11-23', 'Gift guide'),
        slot('2026-11-27', 'Black Friday')
      ]
    },
    builds: {},
    today: '2026-11-16',
    sendPassed: [false, false, false, false, false],
    ...overrides
  }
}

const result = (
  sentAt: string,
  totals: Partial<NonNullable<ResultLine['totals']>> | null,
  sample = false
): ResultLine => ({
  buildId: `b-${sentAt}`,
  subject: 'Hello',
  plannedDay: null,
  emailType: 'launch',
  status: 'sent',
  statusText: 'Sent',
  sentAt,
  final: true,
  complete: true,
  sample,
  totals: totals && {
    recipients: 1000,
    opens: 0,
    clicks: 0,
    orders: null,
    revenue: null,
    openRate: null,
    clickRate: null,
    ...totals
  },
  ab: null,
  topSection: null
})

const input = (over: Partial<HomeInput> = {}): HomeInput => ({
  context,
  now,
  run: run(),
  results: [],
  currency: 'USD',
  offers: {
    maxDiscountPercent: 20,
    grossMarginPercent: null,
    marginFloorPercent: null,
    revision: 1,
    codes: [
      { id: 'c1', code: 'FALL20', percent: 20, ended: false } as never,
      { id: 'c2', code: 'OLD10', percent: 10, ended: true } as never
    ]
  },
  learned: [],
  ...over
})

describe('greeting (UI-HOMEa)', () => {
  it('greets the store by the time of day where the store is', () => {
    expect(greeting('Cedar Lane', 'America/New_York', now)).toBe(
      'Good morning, Cedar Lane'
    )
    expect(greeting('Cedar Lane', 'Asia/Kathmandu', now)).toBe(
      'Good evening, Cedar Lane'
    )
    expect(greeting('Cedar Lane', 'Not/AZone', now)).toBe(
      'Good afternoon, Cedar Lane'
    )
    expect(addDays('2026-11-25', 14)).toBe('2026-12-09')
  })
})

describe('homeView: the plan (UI-HOMEa)', () => {
  it('has no plan yet: 15 empty days from today', () => {
    const view = homeView(input({ run: null }))
    expect(view.plan!.state).toBe('none')
    expect(view.plan!.start).toBe('2026-11-16')
    expect(view.plan!.days).toHaveLength(15)
    expect(view.plan!.days.every((d) => d.state === 'none')).toBe(true)
    expect(view.plan!.next).toEqual([])
  })

  it('marks each day planned or in Klaviyo, and lists the next three emails', () => {
    const view = homeView(
      input({
        run: run({
          builds: {
            0: {
              id: 'build-0',
              state: 'drafted',
              step: 'push',
              sampleDraft: false,
              reason: null
            },
            1: {
              id: 'build-1',
              state: 'build_queued',
              step: 'design',
              sampleDraft: false,
              reason: null
            },
            2: {
              id: 'build-2',
              state: 'failed',
              step: 'copy',
              sampleDraft: false,
              reason: 'The words did not pass the checks.'
            }
          }
        })
      })
    )
    const days = view.plan!.days
    expect(days[0]).toEqual({
      date: '2026-11-16',
      state: 'in_klaviyo',
      buildId: 'build-0'
    })
    expect(days[2]!.state).toBe('planned')
    // A failed email's day is not shown as planned; the row says why.
    expect(days[4]!.state).toBe('none')
    expect(days[7]!.state).toBe('planned')
    expect(days[14]!.date).toBe('2026-11-30')
    expect(
      view.plan!.next.map((s) => [s.title, s.status, s.stepWords, s.canCreate])
    ).toEqual([
      ['A note from us', 'working', 'Designing', false],
      ['Back in stock', 'failed', null, true],
      ['Gift guide', 'planned', null, true]
    ])
    expect(view.plan!.next[0]!.format).toBe('text')
    expect(view.plan!.next[1]!.reason).toBe(
      'The words did not pass the checks.'
    )
  })

  it('offers no Create email to staff, on a passed send, or on a stale plan', () => {
    const staff = homeView(
      input({ context: { ...context, tenantRole: 'staff' } })
    )
    expect(staff.owner).toBe(false)
    expect(staff.plan!.next.every((s) => !s.canCreate)).toBe(true)
    expect(staff.plan!.next).toHaveLength(3)
    const passed = homeView(
      input({ run: run({ sendPassed: [true, false, false, false, false] }) })
    )
    expect(passed.plan!.next[0]!.title).toBe('A note from us')
    const stale = homeView(input({ run: run({ stale: true }) }))
    expect(stale.plan!.next.some((s) => s.canCreate)).toBe(false)
    expect(stale.plan!.stale).toBe(true)
  })

  it('says a plan is being made, waits for offers, or failed with its reason', () => {
    expect(
      homeView(input({ run: run({ state: 'pulse_queued', plan: null }) })).plan!
        .state
    ).toBe('working')
    expect(
      homeView(input({ run: run({ state: 'offers_ready', plan: null }) })).plan!
        .state
    ).toBe('offers_ready')
    const failed = homeView(
      input({
        run: run({ state: 'failed', plan: null, reason: 'No products yet.' })
      })
    )
    expect([failed.plan!.state, failed.plan!.reason]).toEqual([
      'failed',
      'No products yet.'
    ])
  })
})

describe('homeView: numbers, offers and learned (UI-HOMEa)', () => {
  it('adds up the last 30 days of sent emails only', () => {
    const view = homeView(
      input({
        results: [
          result('2026-11-10T15:00:00Z', {
            opens: 400,
            clicks: 40,
            revenue: 1200
          }),
          result('2026-11-01T15:00:00Z', {
            opens: 300,
            clicks: 20,
            revenue: null
          }),
          result('2026-10-01T15:00:00Z', {
            opens: 999,
            clicks: 99,
            revenue: 999
          }),
          result('2026-11-12T15:00:00Z', null)
        ]
      })
    )
    expect(view.numbers).toEqual({
      emails: 2,
      revenue: 1200,
      opens: 700,
      clicks: 60,
      currency: 'USD',
      sample: false
    })
    expect(homeView(input({ results: [] })).numbers).toBeNull()
    expect(
      homeView(
        input({
          results: [result('2026-11-10T15:00:00Z', { opens: 1 }, true)]
        })
      ).numbers
    ).toMatchObject({ revenue: null, sample: true })
  })

  it('counts only the codes still running, and keeps the learned items', () => {
    const learned = [
      {
        id: 'r1',
        kind: 'dont' as const,
        rule: 'Avoid all caps subjects',
        source: 'results',
        at: '2026-11-10T00:00:00Z'
      }
    ]
    const view = homeView(input({ learned }))
    expect(view.offers).toEqual({ maxDiscountPercent: 20, activeCodes: 1 })
    expect(view.learned).toEqual(learned)
    expect(view.unread).toEqual([])
  })

  it('shows what it could read when a part cannot be read', () => {
    const view = homeView(
      input({
        run: undefined,
        results: null,
        offers: undefined,
        learned: null
      })
    )
    expect(view.plan).toBeNull()
    expect(view.numbers).toBeNull()
    expect(view.offers).toBeNull()
    expect(view.learned).toEqual([])
    expect(view.unread).toEqual(['plan', 'numbers', 'offers', 'learned'])
    expect(view.greeting).toBe('Good morning, Cedar Lane')
  })
})

/** A query recorder: every filter, and the answer it gives. */
function database(answers: Record<string, { data: unknown; error: unknown }>) {
  const calls: { table: string; filters: [string, unknown][] }[] = []
  return {
    calls,
    db: {
      from(table: string) {
        const call = { table, filters: [] as [string, unknown][] }
        calls.push(call)
        const answer = answers[table] ?? { data: [], error: null }
        const chain = {
          select: () => chain,
          eq: (column: string, value: unknown) => {
            call.filters.push([column, value])
            return chain
          },
          order: () => chain,
          limit: async () => answer,
          maybeSingle: async () => answer
        }
        return chain
      }
    }
  }
}

describe('homeReadModel (UI-HOMEa)', () => {
  beforeEach(() => vi.resetAllMocks())

  it('reads every part for the session’s workspace only, with the member’s client', async () => {
    const { db, calls } = database({
      agent_memory_rules: {
        data: [
          {
            id: 'r1',
            kind: 'do',
            rule: 'Lead with one product',
            source: 'results',
            created_at: '2026-11-10T00:00:00Z'
          }
        ],
        error: null
      },
      workspace_connections: { data: { account_currency: 'EUR' }, error: null }
    })
    mocks.createClient.mockResolvedValue(db)
    mocks.latestPlanRun.mockResolvedValue({ ok: true, run: null })
    mocks.resultsReadModel.mockResolvedValue([
      result('2026-11-10T15:00:00Z', { revenue: 50, opens: 5, clicks: 1 })
    ])
    mocks.offersPage.mockResolvedValue(null)
    const view = await homeReadModel(context, now)
    expect(mocks.latestPlanRun).toHaveBeenCalledWith(
      'tenant-1',
      'America/New_York',
      now
    )
    expect(mocks.resultsReadModel).toHaveBeenCalledWith(db, 'tenant-1')
    expect(mocks.offersPage).toHaveBeenCalledWith(context)
    for (const call of calls)
      expect(call.filters).toContainEqual(['tenant_id', 'tenant-1'])
    expect(view.numbers!.currency).toBe('EUR')
    expect(view.learned.map((l) => l.rule)).toEqual(['Lead with one product'])
    expect(view.plan!.state).toBe('none')
  })

  it('marks the parts it could not read, and never throws for them', async () => {
    const { db } = database({
      agent_memory_rules: { data: null, error: { code: '42501' } }
    })
    mocks.createClient.mockResolvedValue(db)
    mocks.latestPlanRun.mockResolvedValue({ ok: false })
    mocks.resultsReadModel.mockResolvedValue(null)
    mocks.offersPage.mockRejectedValue(new Error('down'))
    const view = await homeReadModel(context, now)
    expect(view.unread).toEqual(['plan', 'numbers', 'offers', 'learned'])
  })

  it('reads only active rules, surest first', async () => {
    const { db, calls } = database({})
    await topLearned(db as never, 'tenant-1')
    expect(calls[0]).toEqual({
      table: 'agent_memory_rules',
      filters: [
        ['tenant_id', 'tenant-1'],
        ['status', 'active']
      ]
    })
  })
})
