// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const auth = vi.hoisted(() => ({ requireRequestContext: vi.fn() }))
const supabase = vi.hoisted(() => ({ createClient: vi.fn() }))
const after = vi.hoisted(() => vi.fn())
const worker = vi.hoisted(() => ({ runEmailBuilds: vi.fn() }))
const pushers = vi.hoisted(() => ({ draftPusherFor: vi.fn() }))
const checks = vi.hoisted(() => ({ restoreRefusal: vi.fn() }))
const service = vi.hoisted(() => ({ client: {} as unknown }))
vi.mock('@/features/auth/application/request-context', () => auth)
vi.mock('@/lib/supabase/server', () => supabase)
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => service.client
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('next/server', () => ({ after }))
vi.mock('./worker', () => worker)
vi.mock('./restore-checks', () => checks)
vi.mock('@/features/klaviyo-push/live', async (real) => ({
  ...(await real<typeof import('@/features/klaviyo-push/live')>()),
  draftPusherFor: pushers.draftPusherFor
}))

import { redirect } from 'next/navigation'
import { restoreEmailVersion } from './actions'

const tenantId = '00000000-0000-4000-8000-000000000101'
const build = '00000000-0000-4000-8000-0000000000bb'
const run = '00000000-0000-4000-8000-0000000000aa'
const key = '00000000-0000-4000-8000-0000000000cc'

const email = (over: Record<string, unknown> = {}) => ({
  sample: false,
  ai: true,
  name: 'Bestseller: Cedar candle',
  subject: 'Our cedar candle is back',
  preheader: 'Warm nights start here.',
  html: '<p>B</p>',
  approach: 'A',
  copy: 'written',
  plannedSendAt: '2026-11-20T18:00:00Z',
  audienceId: 'a1',
  productIds: ['p1'],
  code: 'CANDLE10',
  changes: [],
  ...over
})

const rpc = vi.fn()
const reads: { table: string; eq: unknown[][] }[] = []
let rows: Record<string, { data: unknown; error: unknown }> = {}
function db() {
  return {
    rpc,
    from(table: string) {
      const read = { table, eq: [] as unknown[][] }
      reads.push(read)
      const result = () => rows[table] ?? { data: null, error: null }
      const query = {
        select: () => query,
        eq: (...args: unknown[]) => {
          read.eq.push(args)
          return query
        },
        maybeSingle: () => Promise.resolve(result()),
        then: (done: (r: unknown) => unknown) =>
          Promise.resolve(result()).then(done)
      }
      return query
    }
  }
}
const form = (fields: Record<string, string>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.append(k, v)
  return f
}
const restore = (over: Record<string, string> = {}) =>
  restoreEmailVersion({}, form({ build, version: '1', shown: '2', ...over }))

const env = (vars: Record<string, string | undefined>) => {
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v)
}
const draft = (over: Record<string, unknown> = {}) => ({
  data: { run_id: run, slot: 2, sample_draft: false, push_key: key, ...over },
  error: null
})

beforeEach(() => {
  vi.clearAllMocks()
  reads.length = 0
  auth.requireRequestContext.mockResolvedValue({
    tenantId,
    tenantRole: 'owner'
  })
  supabase.createClient.mockResolvedValue(db())
  rpc.mockResolvedValue({ data: 3, error: null })
  checks.restoreRefusal.mockResolvedValue(null)
  rows = {
    email_builds: draft(),
    email_versions: { data: { email: email() }, error: null },
    strategy_runs: { data: { start_on: '2026-11-18' }, error: null },
    klaviyo_draft_pushes: { data: [{ campaign_id: 'CmpV01' }], error: null }
  }
  pushers.draftPusherFor.mockReturnValue({ createDraft: vi.fn() })
  env({
    KLAVIYO_MODE: 'live',
    KLAVIYO_DRAFT_PUSH: 'live',
    KLAVIYO_WRITE_LOCK: 'unlocked'
  })
})
afterEach(() => vi.unstubAllEnvs())

describe('Use this version (PICK-106)', () => {
  it('checks the version, brings it back for the owner, then pushes it through the push path', async () => {
    expect(await restore()).toBeUndefined()
    // What can be known now is checked first, with the worker's client.
    expect(checks.restoreRefusal).toHaveBeenCalledWith(service.client, {
      tenantId,
      runId: run,
      startOn: '2026-11-18',
      pushKey: key,
      email: expect.objectContaining({ code: 'CANDLE10' })
    })
    expect(rpc).toHaveBeenCalledWith('restore_email_version', {
      t: tenantId,
      build,
      version: 1,
      shown: 2
    })
    // Read in the owner's own workspace (row security, and named here).
    expect(reads.every((r) => r.eq[0]?.[1] === tenantId)).toBe(true)
    expect(reads.find((r) => r.table === 'email_versions')!.eq).toEqual([
      ['tenant_id', tenantId],
      ['run_id', run],
      ['slot', 2],
      ['number', 1]
    ])
    expect(redirect).toHaveBeenCalledWith(`/plan/email/${build}`)
    // After the reply, the same worker and the same pusher as Create email.
    expect(after).toHaveBeenCalledOnce()
    expect(worker.runEmailBuilds).not.toHaveBeenCalled()
    await after.mock.calls[0]![0]()
    expect(pushers.draftPusherFor).toHaveBeenCalledOnce()
    expect(worker.runEmailBuilds).toHaveBeenCalledWith(
      service.client,
      expect.objectContaining({
        build,
        pusher: pushers.draftPusherFor.mock.results[0]!.value
      })
    )
  })

  it('is the owner’s only', async () => {
    for (const role of ['staff', 'admin'])
      auth.requireRequestContext.mockResolvedValueOnce({
        tenantId,
        tenantRole: role
      })
    for (let i = 0; i < 2; i++)
      expect(await restore()).toEqual({
        error: 'Only this workspace’s owner changes emails.'
      })
    expect(rpc).not.toHaveBeenCalled()
    expect(after).not.toHaveBeenCalled()
  })

  it('mirrors the push exactly: a draft Klaviyo holds is never queued while it cannot be written', async () => {
    const off = {
      error:
        'Putting emails into Klaviyo is switched off right now, so your draft in Klaviyo cannot be changed.'
    }
    const cases: [
      Record<string, string | undefined>,
      ReturnType<typeof draft>
    ][] = [
      // A real draft: the push switch off would send it to the fake.
      [{ KLAVIYO_DRAFT_PUSH: undefined }, draft()],
      [{ KLAVIYO_MODE: 'fake' }, draft()],
      // The write lock on: the live pusher refuses every push.
      [{ KLAVIYO_WRITE_LOCK: undefined }, draft()],
      [{ KLAVIYO_WRITE_LOCK: 'locked' }, draft()],
      // A sample draft of the store's own email, the switch on, the lock on.
      [{ KLAVIYO_WRITE_LOCK: 'locked' }, draft({ sample_draft: true })]
    ]
    for (const [vars, b] of cases) {
      env({
        KLAVIYO_MODE: 'live',
        KLAVIYO_DRAFT_PUSH: 'live',
        KLAVIYO_WRITE_LOCK: 'unlocked',
        ...vars
      })
      rows.email_builds = b
      expect(await restore()).toEqual(off)
    }
    // A sample draft whose key the live pusher wrote: Klaviyo holds it.
    env({ KLAVIYO_DRAFT_PUSH: undefined })
    rows.email_builds = draft({ sample_draft: true })
    expect(await restore()).toEqual(off)
    expect(rpc).not.toHaveBeenCalled()
    expect(after).not.toHaveBeenCalled()
  })

  it('puts back a sample draft with the switches off, and a sample store’s email', async () => {
    env({ KLAVIYO_DRAFT_PUSH: undefined, KLAVIYO_WRITE_LOCK: undefined })
    // A push row that never made a campaign: Klaviyo holds no draft.
    rows.klaviyo_draft_pushes = { data: [{ campaign_id: null }], error: null }
    rows.email_builds = draft({ sample_draft: true })
    expect(await restore()).toBeUndefined()
    rows.email_versions = {
      data: { email: email({ sample: true }) },
      error: null
    }
    expect(await restore()).toBeUndefined()
    expect(rpc).toHaveBeenCalledTimes(2)
  })

  it('stops before the command when a check refuses it', async () => {
    checks.restoreRefusal.mockResolvedValueOnce(
      'This version’s discount code CANDLE10 is no longer one of your working codes within your max discount, so it is not used again.'
    )
    expect(await restore()).toEqual({
      error:
        'This version’s discount code CANDLE10 is no longer one of your working codes within your max discount, so it is not used again.'
    })
    expect(rpc).not.toHaveBeenCalled()
    expect(after).not.toHaveBeenCalled()
  })

  it('says why in plain words when the command refuses', async () => {
    const cases: [string, string, string][] = [
      [
        'PT409',
        'version_scheduled',
        'This email is scheduled in Klaviyo, so GROS will not change it. Unschedule it in Klaviyo first.'
      ],
      [
        'PT409',
        'version_sent',
        'This email was already sent from Klaviyo, so it cannot be changed.'
      ],
      [
        'PT409',
        'version_busy',
        'This email is being made or put in Klaviyo right now. Wait until it is done, then try again.'
      ],
      [
        'PT409',
        'version_stale',
        'This email changed since you opened the page. Reload the page to see its versions.'
      ],
      [
        'PT409',
        'version_plan_replaced',
        'This email’s plan has been replaced by a newer one, so it is not changed any more.'
      ],
      [
        'PT409',
        'version_edited',
        'You changed this draft in Klaviyo, so GROS leaves it as it is.'
      ],
      [
        '22023',
        'version_current',
        'This is already the version your email has.'
      ],
      ['42501', 'version_no_email', 'This email is not one of yours.']
    ]
    for (const [code, hint, words] of cases) {
      rpc.mockResolvedValueOnce({ data: null, error: { code, hint } })
      expect(await restore()).toEqual({ error: words })
    }
    rpc.mockResolvedValueOnce({ data: null, error: { code: '42501' } })
    expect(await restore()).toEqual({
      error: 'Only this workspace’s owner changes emails.'
    })
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'XX000' } })
    expect(await restore()).toEqual({
      error: 'We could not use this version. Try again.'
    })
    // Nothing is pushed after a refusal.
    expect(after).not.toHaveBeenCalled()
    expect(redirect).not.toHaveBeenCalled()
  })

  it('refuses a broken form, a missing email and a version it cannot use', async () => {
    for (const over of <Record<string, string>[]>[
      { build: 'x' },
      { version: '0' },
      { version: 'one' },
      { shown: '' }
    ])
      expect(await restore(over)).toEqual({
        error: 'Reload the page to see the versions.'
      })
    rows.email_builds = { data: null, error: null }
    expect(await restore()).toEqual({
      error: 'This email is not one of yours.'
    })
    rows.email_builds = draft()
    rows.email_versions = { data: null, error: null }
    expect(await restore()).toEqual({
      error:
        'This version is no longer kept. Reload the page to see the versions there are.'
    })
    // Stored the way an older app stored it, or too large: the push would refuse it.
    for (const kept of [
      { html: '<p>' },
      email({ html: 'x'.repeat(290_000) })
    ]) {
      rows.email_versions = { data: { email: kept }, error: null }
      expect(await restore()).toEqual({
        error:
          'This version was kept by an older version of the app, so it cannot be used again.'
      })
    }
    expect(rpc).not.toHaveBeenCalled()
  })
})
