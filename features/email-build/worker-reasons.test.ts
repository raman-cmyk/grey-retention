// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))

/**
 * PICK-104 review: the design reasons go into the stored email through
 * `finish_email_build`; they never fail the design step (it may have used
 * paid AI) and never make an email too large to store.
 */
const knobs = vi.hoisted(() => ({
  throwReasons: false,
  maxBytes: null as number | null
}))
vi.mock('./reasons', async (original) => {
  const real = await original<typeof import('./reasons')>()
  return {
    ...real,
    reasonsFor: (...args: Parameters<typeof real.reasonsFor>) => {
      if (knobs.throwReasons) throw new Error('reasons broke')
      return real.reasonsFor(...args)
    }
  }
})
vi.mock('./step-names', async (original) => {
  const real = await original<typeof import('./step-names')>()
  return {
    ...real,
    get maxEmailBytes() {
      return knobs.maxBytes ?? real.maxEmailBytes
    }
  }
})
vi.mock('@/features/onboarding/store-source', async () => {
  const { sampleStoreFrom } = await import('./ports')
  return {
    planStore: async () => ({ own: false, sample: true }),
    storeForPlan: (_db: unknown, _plan: unknown, start: string) =>
      sampleStoreFrom(start)
  }
})
import { memoryFallbackLog } from '@/features/fallback/log'
import { logger } from '@/lib/logger'
import { runEmailBuilds } from './worker'
import type { BuiltEmail, PlannedEmail } from './build'

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
  audience: { id: 'sample-engaged', label: 'Engaged subscribers (sample)' },
  evidence: [
    {
      id: 'bestseller:p-linen-throw',
      fact: 'Linen throw sold 42 in the last 30 days.'
    }
  ]
}
const start = inDays(1)

type Call = { fn: string; args: Record<string, unknown> }
/** A database that runs one build's saved steps and records the calls. */
function fakeDb() {
  const queue: Record<string, unknown>[] = [
    {
      id: 'build-1',
      tenant_id: tenant,
      state: 'build_queued',
      step: 'sections',
      progress: {},
      run_id: 'run-1',
      slot: 0,
      planned,
      email: null,
      push_key: 'key-1',
      timezone: 'UTC',
      start_on: start,
      lease_token: 'lease-1'
    }
  ]
  let claimed: Record<string, unknown> = {}
  const calls: Call[] = []
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
    calls.push({ fn, args })
    if (fn === 'claim_email_build') {
      const next = queue.shift()
      if (next) claimed = next
      return { data: next ? [next] : [], error: null }
    }
    if (fn === 'finish_email_step') {
      const order = ['sections', 'content', 'copy', 'design']
      const done = String(args.done)
      queue.unshift({
        ...claimed,
        step: order[order.indexOf(done) + 1],
        progress: {
          ...(claimed.progress as object),
          [done]: JSON.parse(JSON.stringify(args.output))
        }
      })
      return { data: order[order.indexOf(done) + 1], error: null }
    }
    return { data: fn === 'fail_email_step' ? 'retry' : null, error: null }
  })
  const query: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'neq', 'or']) query[m] = () => query
  query.then = (done: (r: unknown) => unknown) =>
    Promise.resolve({ data: [], error: null }).then(done)
  return { db: { rpc, from: () => query } as never, calls }
}
const stored = (calls: Call[]) =>
  calls.find((c) => c.fn === 'finish_email_build')?.args.result as
    BuiltEmail | undefined
const sold =
  'The hero shows Linen throw because it is one of your bestsellers: it sold 42 in the 30 days before the plan starting'

describe('the design reasons in the stored email (PICK-104)', () => {
  it('stores them through finish_email_build, dated to the plan', async () => {
    const { db, calls } = fakeDb()
    await runEmailBuilds(db, { fallbacks: memoryFallbackLog() })
    const email = stored(calls)!
    expect(email.reasons).toHaveLength(1)
    // The plan's first day, as the sales figure's date ("2 Mar").
    const day = new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC'
    }).format(new Date(`${start}T00:00:00Z`))
    expect(email.reasons![0]!.text).toBe(`${sold} ${day}.`)
    expect(email.reasons![0]!.facts).toEqual([
      { from: 'plan', key: 'evidence:bestseller:p-linen-throw' }
    ])
    expect(calls.some((c) => c.fn === 'fail_email_step')).toBe(false)
  })

  it('stores the email without reasons when making them throws, and logs it', async () => {
    knobs.throwReasons = true
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    try {
      const { db, calls } = fakeDb()
      await runEmailBuilds(db, { fallbacks: memoryFallbackLog() })
      const email = stored(calls)!
      expect(email.subject).toBeTruthy()
      expect(email).not.toHaveProperty('reasons')
      expect(calls.some((c) => c.fn === 'fail_email_step')).toBe(false)
      expect(warn).toHaveBeenCalledWith('Email design reasons not made', {
        build: 'build-1'
      })
    } finally {
      knobs.throwReasons = false
      warn.mockRestore()
    }
  })

  it('drops the reasons, not the email, when they would make it too large', async () => {
    const first = fakeDb()
    await runEmailBuilds(first.db, { fallbacks: memoryFallbackLog() })
    const full = stored(first.calls)!
    const bare = { ...full }
    delete bare.reasons
    const size = (e: object) => Buffer.byteLength(JSON.stringify(e))
    knobs.maxBytes = size(bare)
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    try {
      const { db, calls } = fakeDb()
      await runEmailBuilds(db, { fallbacks: memoryFallbackLog() })
      expect(stored(calls)).toEqual(bare)
      expect(calls.some((c) => c.fn === 'fail_email_step')).toBe(false)
      // One byte less: too large on its own, refused as before.
      knobs.maxBytes = size(bare) - 1
      const again = fakeDb()
      await runEmailBuilds(again.db, { fallbacks: memoryFallbackLog() })
      expect(stored(again.calls)).toBeUndefined()
      expect(
        again.calls.find((c) => c.fn === 'fail_email_step')?.args
      ).toMatchObject({ code: 'email_too_large' })
    } finally {
      knobs.maxBytes = null
      warn.mockRestore()
    }
  })
})
