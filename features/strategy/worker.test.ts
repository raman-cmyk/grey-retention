// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { logger } from '@/lib/logger'
import { runStrategyRuns, stepCode } from './worker'
import { memoryFallbackLog } from '@/features/fallback/log'
import { sampleStrategyData } from './data'
import { codePulse, gatherEvidence } from './pulse'
import { sampleStore } from './sample'
import { storedPulse, type StoredPlan, type StoredPulse } from './stored'
import { storedPlan } from './stored'
import { InMemoryMemoryStore } from '@/features/agents/memory'
import { InMemoryRunLog, type AiCall } from '@/features/agents/runtime'

const tenant = '00000000-0000-4000-8000-000000000101'
const start = '2026-11-16'

type Call = { fn: string; args: Record<string, unknown> }
type Saved = {
  brand_offers?: Record<string, unknown>[]
  discount_codes?: Record<string, unknown>[]
}
/**
 * A database that hands out the given runs, then nothing, and records
 * calls. `saved` is what the owner saved in Settings (DSC-001's tables, read
 * by the real `SupabaseOfferSource`; 'error' makes that read fail);
 * `timezone` is the workspace's (Melbourne, like the sample store's, unless
 * a test says otherwise). `reads` records each table read and its filters.
 */
function fakeDb(
  runs: Record<string, unknown>[],
  fail: Record<string, { code: string }> = {},
  saved: Saved | 'error' = {},
  timezone = 'Australia/Melbourne',
  attempts = 1
) {
  const queue = [...runs]
  const calls: Call[] = []
  const reads: { table: string; filters: [string, string][] }[] = []
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
    calls.push({ fn, args })
    if (fail[fn]) return { data: null, error: fail[fn] }
    if (fn === 'claim_strategy_run') {
      const next = queue.shift()
      return { data: next ? [next] : [], error: null }
    }
    return { data: fn === 'fail_strategy_step' ? 'retry' : null, error: null }
  })
  const from = (table: keyof Saved | 'tenants' | 'strategy_runs') => {
    const read = { table, filters: [] as [string, string][] }
    reads.push(read)
    const result =
      table === 'tenants'
        ? { data: [{ timezone }], error: null }
        : table === 'strategy_runs'
          ? { data: [{ attempts }], error: null }
          : saved === 'error'
            ? { data: null, error: { code: 'PGRST000' } }
            : { data: saved[table] ?? [], error: null }
    const query = {
      eq: (column: string, value: string) => {
        read.filters.push([column, value])
        return query
      },
      maybeSingle: async () => ({
        data: result.data?.[0] ?? null,
        error: result.error
      }),
      then: (
        done: (r: typeof result) => unknown,
        failed: (e: unknown) => unknown
      ) => Promise.resolve(result).then(done, failed)
    }
    return { select: () => query }
  }
  return { db: { rpc, from } as never, calls, reads }
}
/** A code the owner saved, as DSC-001 stores it. */
const saved = (code: string, percent: number, expires_at: string | null) => ({
  id: `00000000-0000-4000-8000-${code.length.toString().padStart(4, '0')}${percent.toString().padStart(8, '0')}`,
  code,
  percent,
  expires_at
})
const run = (over: Record<string, unknown> = {}) => ({
  id: 'run-1',
  tenant_id: tenant,
  state: 'pulse_queued',
  start_on: start,
  pulse: null,
  offer_pick: null,
  lease_token: 'lease-1',
  ...over
})
const pulse = { ...codePulse(gatherEvidence(sampleStore(start))), sample: true }
const failure = (calls: Call[]) =>
  calls.find((c) => c.fn === 'fail_strategy_step')?.args

describe('running plan steps (the code-only path)', () => {
  it('reads the store and saves the pulse, marked as the sample store', async () => {
    const { db, calls } = fakeDb([run()])
    expect(await runStrategyRuns(db)).toEqual({ ran: 1 })
    const finish = calls.find((c) => c.fn === 'finish_strategy_pulse')!
    expect(finish.args).toMatchObject({ run: 'run-1', lease: 'lease-1' })
    const stored = finish.args.result as StoredPulse
    expect(stored).toMatchObject({ source: 'code', sample: true, own: false })
    // Nothing saved in Settings: the sample offers, sorted by code.
    expect(stored.offers.map((o) => o.code)).toEqual(['CANDLE10', 'WELCOME15'])
  })

  it('lists no offers for the workspace’s own store when nothing is saved, never the sample’s (ONB-057b)', async () => {
    const own = {
      load: async (input: { tenantId: string; start: string }) => ({
        ...(await sampleStrategyData.load(input)),
        sample: false,
        own: true
      })
    }
    const { db, calls } = fakeDb([run()])
    await runStrategyRuns(db, { data: own })
    const finish = calls.find((c) => c.fn === 'finish_strategy_pulse')!
    const stored = finish.args.result as StoredPulse
    expect(stored).toMatchObject({ sample: false, own: true })
    expect(stored.offers).toEqual([])
  })

  it('plans the 15 days with the owner’s pick', async () => {
    const { db, calls } = fakeDb([
      run({
        state: 'plan_queued',
        pulse,
        offer_pick: { mode: 'picked', offers: ['offer:WELCOME15'] }
      })
    ])
    expect(await runStrategyRuns(db)).toEqual({ ran: 1 })
    const plan = calls.find((c) => c.fn === 'finish_strategy_plan')!.args
      .result as StoredPlan
    expect(plan.source).toEqual({
      brief: 'code',
      planner: 'code',
      critic: 'skipped'
    })
    expect(plan.sample).toBe(true)
    expect(plan.slots.length).toBeGreaterThan(0)
    expect(
      plan.slots
        .filter((s) => s.offer)
        .every((s) => s.offer!.code === 'WELCOME15')
    ).toBe(true)
    // No AI and nothing written to the fallback log.
    expect(calls.map((c) => c.fn)).toEqual([
      'claim_strategy_run',
      'finish_strategy_plan',
      'claim_strategy_run'
    ])
  })

  it('plans toward the run’s workspace’s goal, mix and followed brands (PICK-WIRE)', async () => {
    const { db, calls } = fakeDb([
      run({ state: 'plan_queued', pulse, offer_pick: { mode: 'auto' } })
    ])
    const guidance = vi.fn(async () => ({
      goals: [
        {
          month: '2026-11-01',
          label: 'November 2026',
          sentence: '$12,400 still needed by 30 November.',
          emailsNeeded: 5,
          emailsPossible: 6,
          needsStrongerEmails: false,
          pace: 'behind' as const
        }
      ],
      mix: {
        counts: { offer: 1, story: 0, education: 3, product: 2 },
        basis: 'learned' as const
      },
      competitors: [
        {
          id: 'competitor-times:0',
          fact: 'Glow Co sent 30 emails in the 90 days to 15 Nov 2026.'
        }
      ]
    }))
    expect(await runStrategyRuns(db, { guidance, now: () => 1_000 })).toEqual({
      ran: 1
    })
    expect(guidance).toHaveBeenCalledWith({
      tenantId: tenant,
      start,
      timezone: 'Australia/Melbourne',
      sendsPerWeek: 3,
      offers: 2,
      now: 1_000
    })
    const plan = calls.find((c) => c.fn === 'finish_strategy_plan')!.args
      .result as StoredPlan
    expect(storedPlan.safeParse(plan).success).toBe(true)
    expect(plan.goal).toEqual([
      expect.objectContaining({
        label: 'November 2026',
        sentence: '$12,400 still needed by 30 November.',
        plan: expect.stringMatching(/^This plan has /)
      })
    ])
    expect(plan.notes.join(' ')).toContain(
      'What the brands you follow do: Glow Co sent 30 emails'
    )
    expect(plan.notes.length).toBeLessThanOrEqual(10)
  })

  it('plans without the guidance when it cannot be read', async () => {
    const { db, calls } = fakeDb([
      run({ state: 'plan_queued', pulse, offer_pick: { mode: 'auto' } })
    ])
    const guidance = vi.fn(async () => {
      throw Object.assign(new Error('down'), { code: 'PGRST000' })
    })
    expect(await runStrategyRuns(db, { guidance })).toEqual({ ran: 1 })
    const plan = calls.find((c) => c.fn === 'finish_strategy_plan')!.args
      .result as StoredPlan
    expect(plan.goal).toBeUndefined()
    expect(plan.slots.length).toBeGreaterThan(0)
  })

  it('runs the owner’s own plan when asked, and only that one, once', async () => {
    const { db, calls } = fakeDb([run(), run({ id: 'run-2' })])
    expect(await runStrategyRuns(db, { run: 'run-1' })).toEqual({ ran: 1 })
    expect(calls.filter((c) => c.fn === 'claim_strategy_run')).toEqual([
      { fn: 'claim_strategy_run', args: { target: 'run-1' } }
    ])
  })

  it('runs at most two steps per call, and stops at its deadline', async () => {
    const { db, calls } = fakeDb([
      run(),
      run({ id: 'run-2' }),
      run({ id: 'run-3' })
    ])
    expect(await runStrategyRuns(db)).toEqual({ ran: 2 })
    expect(calls.filter((c) => c.fn === 'claim_strategy_run')).toHaveLength(2)
    const late = fakeDb([run()])
    expect(
      await runStrategyRuns(late.db, { deadline: 1000, now: () => 2000 })
    ).toEqual({ ran: 0 })
    expect(late.calls).toEqual([])
  })
})

describe('owner-started planning with the existing agents', () => {
  const ownData = {
    load: async (input: { tenantId: string; start: string }) => ({
      ...(await sampleStrategyData.load(input)),
      sample: false,
      own: true
    })
  }
  const agents = (ai: AiCall) => ({
    ai,
    memory: new InMemoryMemoryStore(),
    log: new InMemoryRunLog()
  })
  const answer = (content: unknown) => ({
    ok: true as const,
    content,
    provider: 'fake' as const,
    model: 'fake',
    costMicro: 0,
    inputTokens: 1,
    outputTokens: 1,
    settled: true
  })
  const goodAi = () =>
    vi.fn<AiCall>(async (call) => {
      const task = JSON.parse(call.request.user)
      if (call.callerKey.startsWith('brand-pulse:'))
        return answer({
          highlights: [
            {
              evidenceId: task.facts[0].id,
              why: 'Relevant to the coming plan.'
            }
          ],
          summary: 'Prioritize the store’s current products and upcoming dates.'
        })
      if (call.callerKey.startsWith('competitor-mapper:'))
        return answer({
          moves: task.patterns.slice(0, 1).map((p: { id: string }) => ({
            patternId: p.id,
            move: 'Lead with a gift guide'
          }))
        })
      if (call.callerKey.startsWith('brief-writer:'))
        return answer({
          actions: [
            {
              goal: 'Introduce the new collection to subscribers.',
              evidenceIds: [
                task.facts.find((f: { id: string }) =>
                  f.id.startsWith('launch:')
                ).id
              ],
              from: task.window.from,
              to: task.window.to,
              offerId: null
            }
          ]
        })
      if (call.callerKey.startsWith('calendar-planner:'))
        return answer({
          slots: [
            {
              actionIndex: 0,
              date: '2026-11-20',
              time: task.default_send_time,
              emailType: 'launch',
              angle: 'Meet the collection',
              productIds: ['p-oak-tray'],
              offerId: null,
              audienceId: task.audiences[0].id
            }
          ]
        })
      return answer({ issues: [] })
    })

  it('saves an agent-produced pulse with the lease tenant and the owner’s real offer limits', async () => {
    const ai = goodAi()
    const runtime = agents(ai)
    const { db, calls } = fakeDb([run()])
    await runStrategyRuns(db, { data: ownData, agents: runtime, now: () => 0 })
    const result = calls.find((c) => c.fn === 'finish_strategy_pulse')!.args
      .result
    expect(storedPulse.parse(result)).toMatchObject({
      source: 'agent',
      sample: false,
      own: true,
      offers: []
    })
    expect(ai).toHaveBeenCalledTimes(1)
    expect(ai.mock.calls[0]![0].tenantId).toBe(tenant)
    expect(runtime.log.entries[0]).toMatchObject({
      tenantId: tenant,
      agent: 'brand-pulse',
      verdict: 'ok'
    })
  })

  it('invokes mapper, brief writer, planner and critic and saves their checked plan', async () => {
    const ai = goodAi()
    const runtime = agents(ai)
    const { db, calls } = fakeDb([
      run({
        state: 'plan_queued',
        pulse: { ...pulse, sample: false, own: true },
        offer_pick: { mode: 'none' }
      })
    ])
    await runStrategyRuns(db, { data: ownData, agents: runtime, now: () => 0 })
    const made = storedPlan.parse(
      calls.find((c) => c.fn === 'finish_strategy_plan')!.args.result
    )
    expect(made.source).toEqual({
      brief: 'agent',
      planner: 'agent',
      critic: 'agent'
    })
    expect(made.slots.length).toBeGreaterThan(0)
    expect(made.slots.every((s) => s.offer === null)).toBe(true)
    expect(new Set(runtime.log.entries.map((r) => r.agent))).toEqual(
      new Set([
        'competitor-mapper',
        'brief-writer',
        'calendar-planner',
        'strategy-critic'
      ])
    )
    expect(runtime.log.entries.every((r) => r.tenantId === tenant)).toBe(true)
    expect(failure(calls)).toBeUndefined()
  })

  it('never calls AI for a sample or fallback store, even with injected agents', async () => {
    const ai = goodAi()
    for (const data of [
      sampleStrategyData,
      {
        load: async (input: { tenantId: string; start: string }) => ({
          ...(await ownData.load(input)),
          sample: true
        })
      }
    ]) {
      const { db } = fakeDb([run()])
      await runStrategyRuns(db, { data, agents: agents(ai) })
    }
    expect(ai).not.toHaveBeenCalled()
  })

  it('keeps a valid code plan and records the reason when the AI allowance is exhausted', async () => {
    const ai = vi.fn<AiCall>(async () => ({ ok: false, code: 'cap_reached' }))
    const fallbacks = memoryFallbackLog()
    const { db, calls } = fakeDb([
      run({
        state: 'plan_queued',
        pulse: { ...pulse, sample: false, own: true },
        offer_pick: { mode: 'none' }
      })
    ])
    await runStrategyRuns(db, { data: ownData, agents: agents(ai), fallbacks })
    const made = storedPlan.parse(
      calls.find((c) => c.fn === 'finish_strategy_plan')!.args.result
    )
    expect(made.source).toEqual({
      brief: 'code',
      planner: 'code',
      critic: 'skipped'
    })
    expect(fallbacks.entries().length).toBeGreaterThan(0)
    expect(ai.mock.calls.every(([call]) => call.tenantId === tenant)).toBe(true)
    expect(ai.mock.calls.length).toBeLessThanOrEqual(4)
    expect(failure(calls)).toBeUndefined()
  })

  it('falls back without any paid call when reads consume the remaining action budget', async () => {
    const ai = goodAi()
    let clock = 0
    const data = {
      load: async (input: { tenantId: string; start: string }) => {
        clock = 99_000
        return ownData.load(input)
      }
    }
    const { db, calls } = fakeDb([run()])
    const fallbacks = memoryFallbackLog()
    await runStrategyRuns(db, {
      data,
      agents: agents(ai),
      fallbacks,
      now: () => clock,
      deadline: 100_000
    })
    expect(ai).not.toHaveBeenCalled()
    expect(
      storedPulse.parse(
        calls.find((c) => c.fn === 'finish_strategy_pulse')!.args.result
      ).source
    ).toBe('code')
    expect(fallbacks.entries()[0]).toMatchObject({
      agent: 'brand-pulse',
      reasonCode: 'pulse_agent_failed'
    })
  })
})

describe('the offers a plan uses (#379)', () => {
  // The owner's own codes, unlike the sample store's: 25% max, a 30% code
  // above it, and a code that ends at 2 pm on the plan's fourth day.
  const own: Saved = {
    brand_offers: [{ max_discount_percent: 25, revision: 1 }],
    discount_codes: [
      saved('OWNER20', 20, null),
      saved('OWNER30', 30, null),
      saved('ENDSOON', 10, '2026-11-19T14:00:00+11:00')
    ]
  }
  const sampleCodes = ['WELCOME15', 'CANDLE10', 'BIGSALE40', 'SPRING20']
  const pulseFor = async (savedOffers: Saved) => {
    const { db, calls } = fakeDb([run()], {}, savedOffers)
    await runStrategyRuns(db)
    return calls.find((c) => c.fn === 'finish_strategy_pulse')!.args
      .result as StoredPulse
  }
  const planFor = async (
    stored: StoredPulse,
    savedOffers: Saved,
    pick: unknown = { mode: 'auto' }
  ) => {
    const { db, calls } = fakeDb(
      [run({ state: 'plan_queued', pulse: stored, offer_pick: pick })],
      {},
      savedOffers
    )
    await runStrategyRuns(db)
    return calls.find((c) => c.fn === 'finish_strategy_plan')!.args
      .result as StoredPlan
  }

  it('lists and plans only the owner’s saved codes when they differ from the sample store’s', async () => {
    const stored = await pulseFor(own)
    expect(stored.sample).toBe(true)
    // ENDSOON works all day only until the 18th (it ends at 2 pm on the 19th).
    expect(stored.offers).toEqual([
      expect.objectContaining({ code: 'ENDSOON', until: '2026-11-18' }),
      expect.objectContaining({ code: 'OWNER20', percent: 20, until: null })
    ])
    expect(stored.leftOut).toEqual([
      { code: 'OWNER30', why: 'It is 30% off, above your 25% maximum.' }
    ])
    const listed = JSON.stringify(stored)
    for (const code of sampleCodes) expect(listed).not.toContain(code)

    const plan = await planFor(stored, own)
    const offers = plan.slots.filter((s) => s.offer)
    expect(offers.length).toBeGreaterThan(0)
    for (const s of offers) {
      expect(['ENDSOON', 'OWNER20']).toContain(s.offer!.code)
      expect(s.offer!.percent).toBeLessThanOrEqual(25)
      if (s.offer!.code === 'ENDSOON') expect(s.date <= '2026-11-18').toBe(true)
    }
    const planned = JSON.stringify(plan)
    for (const code of [...sampleCodes, 'OWNER30'])
      expect(planned).not.toContain(code)
  })

  it('drops a picked offer that changed in Settings before the plan step, and says so', async () => {
    // Picked from the sample offers; then the owner saves a 12% max.
    const stored = await pulseFor({})
    const plan = await planFor(
      stored,
      {
        brand_offers: [{ max_discount_percent: 12, revision: 2 }],
        discount_codes: [
          saved('CANDLE10', 10, null),
          saved('WELCOME15', 15, null)
        ]
      },
      { mode: 'picked', offers: ['offer:CANDLE10', 'offer:WELCOME15'] }
    )
    const offers = plan.slots.filter((s) => s.offer)
    expect(offers.length).toBeGreaterThan(0)
    expect(offers.every((s) => s.offer!.code === 'CANDLE10')).toBe(true)
    expect(plan.notes).toContain(
      'Left out because your offers in Settings changed after they were listed: WELCOME15.'
    )
  })

  it('names a picked offer that no email uses, but not for "You choose" (REL-084)', async () => {
    const stored = await pulseFor({})
    const picked = await planFor(
      stored,
      {},
      {
        mode: 'picked',
        offers: ['offer:CANDLE10', 'offer:WELCOME15']
      }
    )
    const used = new Set(
      picked.slots.flatMap((s: { offer: { code: string } | null }) =>
        s.offer ? [s.offer.code] : []
      )
    )
    expect(used.size).toBe(1)
    expect(picked.notes.at(-1)).toMatch(
      /^No email in these 15 days uses this offer: (CANDLE10|WELCOME15)\.$/
    )
    const auto = await planFor(stored, {}, { mode: 'auto' })
    expect(auto.notes.join(' ')).not.toMatch(/No email in these 15 days/)
  })

  it('reads only this workspace’s offers and timezone', async () => {
    const { db, reads } = fakeDb([run()], {}, own)
    await runStrategyRuns(db)
    const filters = (table: string) =>
      reads.filter((r) => r.table === table).flatMap((r) => r.filters)
    expect(filters('tenants')).toEqual([['id', tenant]])
    expect(filters('brand_offers')).toEqual([['tenant_id', tenant]])
    expect(filters('discount_codes')).toEqual([
      ['tenant_id', tenant],
      ['status', 'active']
    ])
  })

  it('keeps an end date saved in Settings on its own day, in the workspace’s timezone', async () => {
    // Settings ends a code at 23:59:59 store time: the 20th is its last day.
    const melbourne = await pulseFor({
      brand_offers: [{ max_discount_percent: 20, revision: 1 }],
      discount_codes: [saved('SAVE10', 10, '2026-11-20T12:59:59.000Z')]
    })
    expect(melbourne.offers).toEqual([
      expect.objectContaining({ code: 'SAVE10', until: '2026-11-20' })
    ])
    // 11 am UTC on the 20th: after the last send in Melbourne (10 pm), not in UTC.
    const at11 = {
      brand_offers: [{ max_discount_percent: 20, revision: 1 }],
      discount_codes: [saved('SAVE10', 10, '2026-11-20T11:00:00Z')]
    }
    expect((await pulseFor(at11)).offers[0].until).toBe('2026-11-20')
    const utc = fakeDb([run()], {}, at11, 'UTC')
    await runStrategyRuns(utc.db)
    const inUtc = utc.calls.find((c) => c.fn === 'finish_strategy_pulse')!.args
      .result as StoredPulse
    expect(inUtc.offers[0].until).toBe('2026-11-19')
  })

  it('handles every code Settings allows (more than 50)', async () => {
    const many: Saved = {
      brand_offers: [{ max_discount_percent: 25, revision: 1 }],
      discount_codes: Array.from({ length: 60 }, (_, i) =>
        saved(`CODE${String(i + 1).padStart(2, '0')}`, 10, null)
      )
    }
    const stored = await pulseFor(many)
    expect(stored.offers).toHaveLength(60)
    expect(storedPulse.safeParse(stored).success).toBe(true)
    const plan = await planFor(stored, many)
    expect(plan.slots.length).toBeGreaterThan(0)
  })

  it('shows the current percent in the facts behind an offer email', async () => {
    // Picked at 15% from the sample; the owner saved WELCOME15 at 10% since.
    const stored = await pulseFor({})
    const plan = await planFor(
      stored,
      {
        brand_offers: [{ max_discount_percent: 20, revision: 2 }],
        discount_codes: [saved('WELCOME15', 10, null)]
      },
      { mode: 'picked', offers: ['offer:WELCOME15'] }
    )
    const offers = plan.slots.filter((s) => s.offer)
    expect(offers.length).toBeGreaterThan(0)
    expect(offers.every((s) => s.offer!.percent === 10)).toBe(true)
    const facts = JSON.stringify(plan.slots.map((s) => s.evidence))
    expect(facts).not.toContain('15% off with WELCOME15')
  })

  it('on the last try, plans with no offers instead of getting stuck, and logs the fallback', async () => {
    // The third claim of the step is its last (`claim_strategy_run`).
    const fallbacks = memoryFallbackLog()
    const one = fakeDb([run()], {}, 'error', 'Australia/Melbourne', 3)
    expect(await runStrategyRuns(one.db, { fallbacks })).toEqual({ ran: 1 })
    expect(failure(one.calls)).toBeUndefined()
    const listed = one.calls.find((c) => c.fn === 'finish_strategy_pulse')!.args
      .result as StoredPulse
    expect(listed.offers).toEqual([])
    expect(listed.summary).toContain(
      'Your saved offers could not be read, so none are listed.'
    )
    const two = fakeDb(
      [run({ state: 'plan_queued', pulse, offer_pick: { mode: 'auto' } })],
      {},
      'error',
      'Australia/Melbourne',
      3
    )
    expect(await runStrategyRuns(two.db, { fallbacks })).toEqual({ ran: 1 })
    const plan = two.calls.find((c) => c.fn === 'finish_strategy_plan')!.args
      .result as StoredPlan
    expect(plan.slots.length).toBeGreaterThan(0)
    expect(plan.slots.some((s) => s.offer)).toBe(false)
    expect(plan.notes).toContain(
      'Your saved offers could not be read, so this plan has no offers. Start again to plan with them.'
    )
    expect(fallbacks.entries()).toEqual([
      expect.objectContaining({
        tenantId: tenant,
        agent: 'plan-offers',
        reasonCode: 'offers_unreadable',
        fallback: 'Listed no offers for these 15 days.',
        attempts: 3
      }),
      expect.objectContaining({
        agent: 'plan-offers',
        reasonCode: 'offers_unreadable',
        fallback: 'Planned these 15 days with no offers.'
      })
    ])
  })

  it('tries the plan step again too when the saved offers cannot be read', async () => {
    const stored = await pulseFor({})
    const { db, calls } = fakeDb(
      [
        run({
          state: 'plan_queued',
          pulse: stored,
          offer_pick: { mode: 'auto' }
        })
      ],
      {},
      'error'
    )
    await runStrategyRuns(db)
    expect(calls.some((c) => c.fn === 'finish_strategy_plan')).toBe(false)
    expect(failure(calls)).toMatchObject({
      code: 'offers_unreadable',
      final: false
    })
  })

  it('tries the step again when the saved offers cannot be read, never using the sample', async () => {
    const { db, calls } = fakeDb([run()], {}, 'error')
    expect(await runStrategyRuns(db)).toEqual({ ran: 0 })
    expect(calls.some((c) => c.fn === 'finish_strategy_pulse')).toBe(false)
    expect(failure(calls)).toEqual({
      run: 'run-1',
      lease: 'lease-1',
      code: 'offers_unreadable',
      final: false
    })
  })
})

describe('failed steps', () => {
  it('stores a code it has no words for as step_error, and logs the code (REL-084)', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
    const { db, calls } = fakeDb([run()])
    const broken = {
      load: async () => Promise.reject({ code: 'something_new' })
    }
    await runStrategyRuns(db, { data: broken })
    expect(failure(calls)).toMatchObject({ code: 'step_error', final: false })
    expect(error).toHaveBeenCalledWith(
      'Plan step threw',
      expect.objectContaining({ code: 'something_new' })
    )
    error.mockRestore()
  })

  it('are tried again when the store cannot be read', async () => {
    const { db, calls } = fakeDb([run()])
    const broken = { load: async () => Promise.reject(new Error('down')) }
    expect(await runStrategyRuns(db, { data: broken })).toEqual({ ran: 0 })
    expect(failure(calls)).toEqual({
      run: 'run-1',
      lease: 'lease-1',
      code: 'step_error',
      final: false
    })
  })

  it('fail at once when a retry cannot help', async () => {
    const otherDays = {
      load: async ({ tenantId }: { tenantId: string }) =>
        sampleStrategyData.load({ tenantId, start: '2026-12-01' })
    }
    const cases = [
      ['pulse_queued', {}, otherDays, 'store_wrong_days'],
      [
        'plan_queued',
        { pulse, offer_pick: { mode: 'picked', offers: ['offer:MADEUP'] } },
        undefined,
        'pick_not_in_pulse'
      ],
      [
        'plan_queued',
        { pulse: { broken: true }, offer_pick: { mode: 'auto' } },
        undefined,
        'stored_pulse_invalid'
      ],
      [
        'plan_queued',
        { pulse, offer_pick: { mode: 'all' } },
        undefined,
        'stored_pick_invalid'
      ],
      [
        'plan_queued',
        { pulse, offer_pick: { mode: 'auto' } },
        otherDays,
        'store_wrong_days'
      ]
    ] as const
    for (const [state, over, data, code] of cases) {
      const { db, calls } = fakeDb([run({ state, ...over })])
      await runStrategyRuns(db, data ? { data } : {})
      expect(failure(calls), code).toMatchObject({ code, final: true })
    }
  })

  it('fail at once when the offers were listed from the sample and the plan would be real, or back (ONB-057b)', async () => {
    const own = {
      load: async (input: { tenantId: string; start: string }) => ({
        ...(await sampleStrategyData.load(input)),
        sample: false,
        own: true
      })
    }
    const cases = [
      [pulse, own],
      [{ ...pulse, sample: false, own: true }, undefined],
      // A pulse saved before the flags was the sample store's.
      [{ ...pulse, sample: undefined }, own],
      // Live both times, but the offers were listed from the sample store.
      [{ ...pulse, sample: false }, own]
    ] as const
    for (const [listed, data] of cases) {
      const { db, calls } = fakeDb([
        run({
          state: 'plan_queued',
          pulse: listed,
          offer_pick: { mode: 'auto' }
        })
      ])
      await runStrategyRuns(db, data ? { data } : {})
      expect(failure(calls)).toEqual({
        run: 'run-1',
        lease: 'lease-1',
        code: 'store_changed',
        final: true
      })
      expect(calls.some((c) => c.fn === 'finish_strategy_plan')).toBe(false)
    }
    // The same store both times: planned.
    const same = fakeDb([
      run({
        state: 'plan_queued',
        pulse: { ...pulse, sample: false, own: true },
        offer_pick: { mode: 'auto' }
      })
    ])
    await runStrategyRuns(same.db, { data: own })
    expect(failure(same.calls)).toBeUndefined()
    const plan = same.calls.find((c) => c.fn === 'finish_strategy_plan')!
    // The plan says which store it was made from, for "Create email".
    expect(plan.args.result).toMatchObject({ sample: false, own: true })
  })

  it('treat bad store data as final, and a lost lease as a retry', async () => {
    const bad = {
      load: async () => ({
        ...(await sampleStrategyData.load({ tenantId: tenant, start })),
        pulse: { brand: 'nope' }
      })
    }
    const one = fakeDb([run()])
    await runStrategyRuns(one.db, { data: bad })
    expect(failure(one.calls)).toMatchObject({
      code: 'store_data_invalid',
      final: true
    })
    const lost = fakeDb([run()], { finish_strategy_pulse: { code: 'PT409' } })
    await runStrategyRuns(lost.db)
    expect(failure(lost.calls)).toMatchObject({
      code: 'step_error',
      final: false
    })
  })

  it('stop the call when a claim fails', async () => {
    const { db } = fakeDb([run()], { claim_strategy_run: { code: '42501' } })
    await expect(runStrategyRuns(db)).rejects.toMatchObject({ code: '42501' })
  })
})

describe('the step error code', () => {
  it('keeps short codes and hides everything else', () => {
    expect(stepCode({ code: 'store_wrong_days' })).toBe('store_wrong_days')
    expect(stepCode({ code: 'Has Spaces' })).toBe('step_error')
    expect(stepCode({ name: 'ZodError' })).toBe('store_data_invalid')
    expect(stepCode(new Error('secret detail'))).toBe('step_error')
  })
})
