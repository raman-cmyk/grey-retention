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
import type { EmailBuildView, PlanRun } from '@/features/strategy/load'
import {
  accountCurrency,
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

type Slot = NonNullable<PlanRun['plan']>['slots'][number]
const slot = (date: string, angle: string, extra: Partial<Slot> = {}) => ({
  date,
  time: '18:00',
  emailType: 'launch' as const,
  angle,
  products: [],
  offer: null,
  audience: { id: 'a1', label: 'Past buyers' },
  why: 'Because',
  evidence: [],
  ...extra
})
const build = (
  id: string,
  state: EmailBuildView['state'],
  extra: Partial<EmailBuildView> = {}
): EmailBuildView => ({
  id,
  state,
  step: 'sections',
  sampleDraft: false,
  reason: null,
  ...extra
})

/**
 * A plan made on 13 November for 14 to 28 November, read on its third day:
 * `latestPlanRun` calls it stale (`start_on <= today`), as every running
 * plan is from its first day.
 */
function run(overrides: Partial<PlanRun> = {}): PlanRun {
  return {
    id: 'run-1',
    state: 'planned',
    reason: null,
    startOn: '2026-11-14',
    stale: true,
    pulse: null,
    plan: {
      start: '2026-11-14',
      end: '2026-11-28',
      dropped: 0,
      brief: [],
      notes: [],
      source: { brief: 'code', planner: 'code', critic: 'skipped' },
      slots: [
        slot('2026-11-14', 'Weekend edit'),
        slot('2026-11-15', 'Missed one'),
        slot('2026-11-16', 'Today at six'),
        slot('2026-11-18', 'A note from us', { format: 'text' }),
        slot('2026-11-20', 'Back in stock', { time: '09:00' }),
        slot('2026-11-20', 'Gift guide', { time: '08:00' }),
        slot('2026-11-27', 'Black Friday')
      ]
    },
    builds: { 0: build('build-0', 'drafted', { step: 'push' }) },
    today: '2026-11-16',
    sendPassed: [true, true, false, false, false, false, false],
    ...overrides
  }
}

const result = (
  sentAt: string,
  totals: Partial<NonNullable<ResultLine['totals']>> | null,
  extra: Partial<ResultLine> = {}
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
  sample: false,
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
  topSection: null,
  ...extra
})

const offers = {
  maxDiscountPercent: 20,
  grossMarginPercent: null,
  marginFloorPercent: null,
  revision: 1,
  codes: [
    { id: 'c1', code: 'FALL20', percent: 20, ended: false } as never,
    { id: 'c2', code: 'OLD10', percent: 10, ended: true } as never
  ]
}

const input = (over: Partial<HomeInput> = {}): HomeInput => ({
  context,
  now,
  run: run(),
  results: [],
  currency: 'USD',
  offers,
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
    // An unknown zone: UTC (15:00).
    expect(greeting('Cedar Lane', 'Not/AZone', now)).toBe(
      'Good afternoon, Cedar Lane'
    )
    const at = (iso: string) => greeting('X', 'UTC', new Date(iso))
    expect(at('2026-11-16T00:00:00Z')).toBe('Good morning, X')
    expect(at('2026-11-16T11:59:00Z')).toBe('Good morning, X')
    expect(at('2026-11-16T12:00:00Z')).toBe('Good afternoon, X')
    expect(at('2026-11-16T18:00:00Z')).toBe('Good evening, X')
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

  it('keeps offering Create email through a running plan, as the Plan page does', () => {
    const view = homeView(input())
    expect(view.plan!.outOfDate).toBe(false)
    expect(view.plan!.ended).toBe(false)
    expect(
      view.plan!.next.map((s) => [s.title, s.status, s.canCreate])
    ).toEqual([
      ['Today at six', 'planned', true],
      ['A note from us', 'planned', true],
      // Same day: the earlier send first.
      ['Gift guide', 'planned', true]
    ])
    expect(view.plan!.next[1]!.format).toBe('text')
  })

  it('marks each of the 15 days, past ones included', () => {
    const days = homeView(input()).plan!.days
    expect(days[0]).toEqual({
      date: '2026-11-14',
      state: 'in_klaviyo',
      buildId: 'build-0'
    })
    // A planned email whose send time passed is gone from the strip too.
    expect(days[1]!.state).toBe('none')
    expect(days[2]!.state).toBe('planned')
    expect(days[3]!.state).toBe('none')
    expect(days[6]!.state).toBe('planned')
    expect(days[14]!.date).toBe('2026-11-28')
  })

  it('says how far each email got, and why one failed', () => {
    const view = homeView(
      input({
        run: run({
          builds: {
            0: build('build-0', 'drafted', { step: 'push' }),
            2: build('build-2', 'build_queued', { step: 'design' }),
            3: build('build-3', 'failed', {
              step: 'copy',
              reason: 'The words did not pass the checks.'
            }),
            4: build('build-4', 'push_queued', { step: 'sections' }),
            5: build('build-5', 'drafted', { sampleDraft: true })
          }
        })
      })
    )
    expect(
      view.plan!.next.map((s) => [
        s.title,
        s.status,
        s.stepWords,
        s.reason,
        s.canCreate
      ])
    ).toEqual([
      ['Today at six', 'working', 'Designing', null, false],
      [
        'A note from us',
        'failed',
        null,
        'The words did not pass the checks.',
        true
      ],
      ['Gift guide', 'sample_draft', null, null, false]
    ])
    const days = view.plan!.days
    // A sample draft is not in Klaviyo: the day stays planned.
    expect(days[6]).toEqual({
      date: '2026-11-20',
      state: 'planned',
      buildId: 'build-4'
    })
    // The failed email's day shows nothing; the row says why.
    expect(days[4]!.state).toBe('none')
    expect(
      homeView(
        input({
          run: run({
            builds: {
              6: build('build-6', 'push_queued', { step: 'design' })
            }
          })
        })
      ).plan!.next.find((s) => s.slot === 6)
    ).toBeUndefined()
    expect(
      homeView(
        input({
          run: run({
            builds: { 2: build('b', 'push_queued', { step: 'design' }) }
          })
        })
      ).plan!.next[0]!.stepWords
    ).toBe('Saving draft')
  })

  it('offers no Create email to staff or on a passed send, and staff see the same emails', () => {
    const staff = homeView(
      input({ context: { ...context, tenantRole: 'staff' } })
    )
    expect(staff.owner).toBe(false)
    expect(staff.plan!.next.every((s) => !s.canCreate)).toBe(true)
    expect(staff.plan!.next.map((s) => s.title)).toEqual(
      homeView(input()).plan!.next.map((s) => s.title)
    )
    const passed = homeView(
      input({
        run: run({
          sendPassed: [true, true, true, false, false, false, false],
          builds: { 2: build('b2', 'failed') }
        })
      })
    )
    // A failed email whose send passed stays listed, without Try again.
    expect(passed.plan!.next[0]).toMatchObject({
      title: 'Today at six',
      status: 'failed',
      canCreate: false
    })
    // Without per-email send times, a day before today counts as passed.
    const old = homeView(input({ run: run({ sendPassed: undefined }) }))
    expect(old.plan!.days[1]!.state).toBe('none')
    expect(old.plan!.next[0]!.title).toBe('Today at six')
  })

  it('says a plan is being made, waits for offers, failed, is out of date, ended or unreadable', () => {
    const working = homeView(
      input({
        run: run({
          state: 'pulse_queued',
          plan: null,
          startOn: '2026-11-17',
          stale: false
        })
      })
    ).plan!
    expect([working.state, working.start, working.outOfDate]).toEqual([
      'working',
      '2026-11-17',
      false
    ])
    expect(
      homeView(
        input({
          run: run({ state: 'offers_ready', plan: null, pulse: {} as never })
        })
      ).plan!.state
    ).toBe('offers_ready')
    // An unfinished run whose days have begun: only a new plan helps.
    expect(
      homeView(
        input({
          run: run({
            state: 'offers_ready',
            plan: null,
            pulse: {} as never,
            stale: true
          })
        })
      ).plan!.outOfDate
    ).toBe(true)
    const failed = homeView(
      input({
        run: run({ state: 'failed', plan: null, reason: 'No products yet.' })
      })
    ).plan!
    expect([failed.state, failed.reason]).toEqual([
      'failed',
      'No products yet.'
    ])
    expect(homeView(input({ run: run({ plan: null }) })).plan!.state).toBe(
      'unreadable'
    )
    expect(
      homeView(input({ run: run({ state: 'offers_ready', plan: null }) })).plan!
        .state
    ).toBe('unreadable')
    expect(
      homeView(input({ now: new Date('2026-11-30T15:00:00Z'), run: run() }))
        .plan!.ended
    ).toBe(true)
  })
})

describe('homeView: numbers, offers and learned (UI-HOMEa)', () => {
  it('adds up the last 30 days of sent emails, and says when revenue is partial', () => {
    const view = homeView(
      input({
        results: [
          result('2026-11-10T15:00:00Z', {
            opens: 400,
            clicks: 40,
            revenue: 1200.104
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
      revenue: 1200.1,
      revenueEmails: 1,
      opens: 700,
      clicks: 60,
      currency: 'USD',
      complete: false,
      sample: false
    })
    expect(homeView(input({ results: [] })).numbers).toBeNull()
    expect(
      homeView(
        input({
          results: [
            result('2026-11-10T15:00:00Z', { revenue: 10 }, { complete: false })
          ]
        })
      ).numbers!.complete
    ).toBe(false)
    expect(
      homeView(
        input({
          results: [
            result('2026-11-10T15:00:00Z', { opens: 1 }, { sample: true })
          ]
        })
      ).numbers
    ).toMatchObject({ revenue: null, revenueEmails: 0, sample: true })
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
      input({ run: undefined, results: null, offers: null, learned: null })
    )
    expect(view.plan).toBeNull()
    expect(view.numbers).toBeNull()
    expect(view.offers).toBeNull()
    expect(view.learned).toEqual([])
    expect(view.unread).toEqual(['plan', 'numbers', 'offers', 'learned'])
    expect(view.greeting).toBe('Good morning, Cedar Lane')
  })
})

/** A query recorder: every filter and order, and the answer it gives. */
function database(answers: Record<string, { data: unknown; error: unknown }>) {
  const calls: {
    table: string
    filters: unknown[][]
    orders: unknown[][]
    limit?: number
  }[] = []
  return {
    calls,
    db: {
      from(table: string) {
        const call = {
          table,
          filters: [] as unknown[][],
          orders: [] as unknown[][],
          limit: undefined as number | undefined
        }
        calls.push(call)
        const answer = answers[table] ?? { data: [], error: null }
        const chain = {
          select: () => chain,
          eq: (...args: unknown[]) => (
            call.filters.push(['eq', ...args]),
            chain
          ),
          gte: (...args: unknown[]) => (
            call.filters.push(['gte', ...args]),
            chain
          ),
          or: (...args: unknown[]) => (
            call.filters.push(['or', ...args]),
            chain
          ),
          order: (...args: unknown[]) => (call.orders.push(args), chain),
          limit: async (n: number) => ((call.limit = n), answer),
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
    mocks.offersPage.mockResolvedValue(offers)
    const view = await homeReadModel(context, now)
    expect(mocks.latestPlanRun).toHaveBeenCalledWith(
      'tenant-1',
      'America/New_York',
      now
    )
    expect(mocks.resultsReadModel).toHaveBeenCalledWith(db, 'tenant-1')
    expect(mocks.offersPage).toHaveBeenCalledWith(context)
    for (const call of calls)
      expect(call.filters).toContainEqual(['eq', 'tenant_id', 'tenant-1'])
    expect(view.numbers!.currency).toBe('EUR')
    expect(view.learned.map((l) => l.rule)).toEqual(['Lead with one product'])
    expect(view.plan!.state).toBe('none')
    expect(view.unread).toEqual([])
  })

  it('asks only for another workspace when signed into it (row rules refuse the rest)', async () => {
    const { db, calls } = database({})
    mocks.createClient.mockResolvedValue(db)
    mocks.latestPlanRun.mockResolvedValue({ ok: true, run: null })
    mocks.resultsReadModel.mockResolvedValue([])
    mocks.offersPage.mockResolvedValue(offers)
    const other = { ...context, tenantId: 'tenant-2' }
    await homeReadModel(other, now)
    expect(mocks.latestPlanRun.mock.calls[0]![0]).toBe('tenant-2')
    expect(mocks.resultsReadModel).toHaveBeenCalledWith(db, 'tenant-2')
    expect(mocks.offersPage).toHaveBeenCalledWith(other)
    expect(JSON.stringify(calls)).not.toContain('tenant-1')
  })

  it('marks the parts it could not read, and never throws for them', async () => {
    const { db } = database({
      agent_memory_rules: { data: null, error: { code: '42501' } }
    })
    mocks.createClient.mockResolvedValue(db)
    mocks.latestPlanRun.mockRejectedValue(new RangeError('bad zone'))
    mocks.resultsReadModel.mockResolvedValue(null)
    // offersPage answers null when its read fails.
    mocks.offersPage.mockResolvedValue(null)
    const view = await homeReadModel(context, now)
    expect(view.unread).toEqual(['plan', 'numbers', 'offers', 'learned'])
    mocks.latestPlanRun.mockResolvedValue({ ok: false })
    mocks.offersPage.mockRejectedValue(new Error('down'))
    expect((await homeReadModel(context, now)).unread).toContain('plan')
  })

  it('reads only the rules agents use now, pinned first, then surest, three of them', async () => {
    const { db, calls } = database({
      agent_memory_rules: {
        data: [
          {
            id: 'r2',
            kind: 'dont',
            rule: 'Avoid all caps',
            source: 'inspector',
            created_at: '2026-11-11T00:00:00Z'
          },
          {
            id: 'r3',
            kind: 'odd',
            rule: 'Unknown kind',
            source: 'seed',
            created_at: '2026-11-11T00:00:00Z'
          }
        ],
        error: null
      }
    })
    const learned = await topLearned(db as never, 'tenant-1', now)
    expect(calls[0]).toEqual({
      table: 'agent_memory_rules',
      filters: [
        ['eq', 'tenant_id', 'tenant-1'],
        ['eq', 'status', 'active'],
        [
          'or',
          'pinned.is.true,and(confidence.gte.0.5,or(expires_at.is.null,expires_at.gt.2026-11-16T15:00:00.000Z))'
        ]
      ],
      orders: [
        ['pinned', { ascending: false }],
        ['confidence', { ascending: false }],
        ['created_at', { ascending: false }]
      ],
      limit: 3
    })
    expect(learned!.map((l) => l.kind)).toEqual(['dont', 'do'])
  })

  it('takes the account currency only when it is a currency code', async () => {
    const answer = (v: unknown) =>
      database({ workspace_connections: { data: v, error: null } }).db as never
    expect(
      await accountCurrency(answer({ account_currency: 'GBP' }), 't')
    ).toBe('GBP')
    expect(
      await accountCurrency(answer({ account_currency: 'pounds' }), 't')
    ).toBeNull()
    expect(await accountCurrency(answer(null), 't')).toBeNull()
  })
})
