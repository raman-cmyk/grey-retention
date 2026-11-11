// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { memoryFallbackLog } from '@/features/fallback/log'
import { runEmailBuilds } from './worker'
import { buildEmail, type BuiltEmail, type PlannedEmail } from './build'
import {
  fakeDraftPusher,
  sampleOffers,
  sampleStoreSource,
  type DraftPusher,
  type DraftResult
} from './ports'

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

type Call = { fn: string; args: Record<string, unknown> }
/** A database that hands out the given steps, then nothing, and records calls. */
function fakeDb(
  steps: Record<string, unknown>[],
  fail: Record<string, { code: string }> = {}
) {
  const queue = [...steps]
  const calls: Call[] = []
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
    calls.push({ fn, args })
    if (fail[fn]) return { data: null, error: fail[fn] }
    if (fn === 'claim_email_build') {
      const next = queue.shift()
      return { data: next ? [next] : [], error: null }
    }
    return { data: fn === 'fail_email_step' ? 'retry' : null, error: null }
  })
  return { db: { rpc } as never, calls }
}
const step = (over: Record<string, unknown> = {}) => ({
  id: 'build-1',
  tenant_id: tenant,
  state: 'build_queued',
  run_id: 'run-1',
  slot: 0,
  planned,
  email: null,
  lease_token: 'lease-1',
  ...over
})
const built = async (): Promise<BuiltEmail> => {
  const result = await buildEmail(
    {
      planned,
      store: await sampleStoreSource.read(tenant),
      offers: sampleOffers
    },
    { tenantId: tenant, callerKey: 'x', fallbacks: memoryFallbackLog() }
  )
  if (!result.ok) throw new Error('sample build failed')
  return result.email
}
const failure = (calls: Call[]) =>
  calls.find((c) => c.fn === 'fail_email_step')?.args

describe('building and pushing (code-only, fake pusher)', () => {
  it('builds the email and stores it for the push', async () => {
    const { db, calls } = fakeDb([step()])
    expect(
      await runEmailBuilds(db, { fallbacks: memoryFallbackLog() })
    ).toEqual({ ran: 1 })
    const finish = calls.find((c) => c.fn === 'finish_email_build')!
    expect(finish.args).toMatchObject({ build: 'build-1', lease: 'lease-1' })
    expect(finish.args.result).toMatchObject({
      sample: true,
      ai: false,
      approach: 'A',
      productIds: ['p-linen-throw']
    })
  })

  it('pushes a built email as a draft, keyed by the build', async () => {
    const pusher = fakeDraftPusher()
    const email = await built()
    const { db, calls } = fakeDb([step({ state: 'push_queued', email })])
    expect(await runEmailBuilds(db, { pusher })).toEqual({ ran: 1 })
    expect(pusher.calls).toEqual([
      expect.objectContaining({
        tenantId: tenant,
        idempotencyKey: 'build-1',
        subject: email.subject,
        html: email.html,
        audienceId: 'sample-engaged'
      })
    ])
    expect(calls.find((c) => c.fn === 'finish_email_push')!.args).toEqual({
      build: 'build-1',
      lease: 'lease-1',
      campaign: 'sample-draft-build-1',
      sample: true
    })
  })

  it('runs the owner’s own build, then its push, and nothing else', async () => {
    const email = await built()
    const { db, calls } = fakeDb([
      step(),
      step({ state: 'push_queued', email })
    ])
    expect(
      await runEmailBuilds(db, {
        build: 'build-1',
        fallbacks: memoryFallbackLog()
      })
    ).toEqual({ ran: 2 })
    expect(calls.filter((c) => c.fn === 'claim_email_build')).toEqual([
      { fn: 'claim_email_build', args: { target: 'build-1' } },
      { fn: 'claim_email_build', args: { target: 'build-1' } }
    ])
  })

  it('stops at its deadline', async () => {
    const { db, calls } = fakeDb([step()])
    expect(
      await runEmailBuilds(db, { deadline: 1000, now: () => 2000 })
    ).toEqual({ ran: 0 })
    expect(calls).toEqual([])
  })
})

describe('failed steps', () => {
  it('wait as long as a busy Klaviyo asks, and fail at once when it refuses', async () => {
    const email = await built()
    for (const [result, args] of [
      [
        { ok: false, code: 'rate_limited', retryAfterSeconds: 90 },
        { code: 'klaviyo_rate_limited', final: false, retry_after_seconds: 90 }
      ],
      [
        { ok: false, code: 'unavailable' },
        { code: 'klaviyo_unavailable', final: false }
      ],
      [
        { ok: false, code: 'rejected', checks: ['images'] },
        { code: 'klaviyo_rejected', final: true }
      ],
      [
        { ok: false, code: 'auth' },
        { code: 'klaviyo_auth', final: true }
      ]
    ] as [DraftResult, Record<string, unknown>][]) {
      const pusher: DraftPusher = { createDraft: async () => result }
      const { db, calls } = fakeDb([step({ state: 'push_queued', email })])
      await runEmailBuilds(db, { pusher })
      expect(failure(calls)).toEqual({
        build: 'build-1',
        lease: 'lease-1',
        ...args
      })
      expect(calls.some((c) => c.fn === 'finish_email_push')).toBe(false)
    }
  })

  it('are tried again when the store cannot be read or the pusher throws', async () => {
    const one = fakeDb([step()])
    await runEmailBuilds(one.db, {
      stores: { read: async () => Promise.reject(new Error('down')) }
    })
    expect(failure(one.calls)).toMatchObject({
      code: 'step_error',
      final: false
    })
    const two = fakeDb([step({ state: 'push_queued', email: await built() })])
    await runEmailBuilds(two.db, {
      pusher: {
        createDraft: async () => {
          throw new Error('bug')
        }
      }
    })
    expect(failure(two.calls)).toMatchObject({
      code: 'step_error',
      final: false
    })
  })

  it('fail at once for bad stored data or an email that cannot be built', async () => {
    const cases = [
      [step({ planned: { date: 'soon' } }), 'planned_email_invalid'],
      [
        step({ state: 'push_queued', email: { subject: 's' } }),
        'built_email_invalid'
      ],
      [
        step({ planned: { ...planned, date: '2027-10-03', time: '02:30' } }),
        'slot_time_invalid'
      ]
    ] as const
    for (const [s, code] of cases) {
      const { db, calls } = fakeDb([s])
      await runEmailBuilds(db, { fallbacks: memoryFallbackLog() })
      expect(failure(calls), code).toMatchObject({ code, final: true })
    }
  })

  it('stop the call when a claim fails', async () => {
    const { db } = fakeDb([step()], { claim_email_build: { code: '42501' } })
    await expect(runEmailBuilds(db)).rejects.toMatchObject({ code: '42501' })
  })
})
