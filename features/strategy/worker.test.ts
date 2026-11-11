// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { runStrategyRuns, stepCode } from './worker'
import { sampleStrategyData } from './data'
import { codePulse, gatherEvidence } from './pulse'
import { sampleStore } from './sample'
import { storedPulse, type StoredPlan, type StoredPulse } from './stored'

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
  timezone = 'Australia/Melbourne'
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
  const from = (table: keyof Saved | 'tenants') => {
    const read = { table, filters: [] as [string, string][] }
    reads.push(read)
    const result =
      table === 'tenants'
        ? { data: [{ timezone }], error: null }
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
    expect(stored).toMatchObject({ source: 'code', sample: true })
    // Nothing saved in Settings: the sample offers, sorted by code.
    expect(stored.offers.map((o) => o.code)).toEqual(['CANDLE10', 'WELCOME15'])
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
