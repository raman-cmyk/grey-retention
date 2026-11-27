// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const auth = vi.hoisted(() => ({ requireRequestContext: vi.fn() }))
const supabase = vi.hoisted(() => ({ createClient: vi.fn() }))
const after = vi.hoisted(() => vi.fn())
const worker = vi.hoisted(() => ({ runEmailBuilds: vi.fn() }))
const pushers = vi.hoisted(() => ({ draftPusherFor: vi.fn() }))
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
vi.mock('@/features/klaviyo-push/live', async (real) => ({
  ...(await real<typeof import('@/features/klaviyo-push/live')>()),
  draftPusherFor: pushers.draftPusherFor
}))

import { redirect } from 'next/navigation'
import { restoreEmailVersion } from './actions'

const tenantId = '00000000-0000-4000-8000-000000000101'
const build = '00000000-0000-4000-8000-0000000000bb'
const run = '00000000-0000-4000-8000-0000000000aa'

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
  code: null,
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
      const query = {
        select: () => query,
        eq: (...args: unknown[]) => {
          read.eq.push(args)
          return query
        },
        maybeSingle: () =>
          Promise.resolve(rows[table] ?? { data: null, error: null })
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

const live = { KLAVIYO_MODE: 'live', KLAVIYO_DRAFT_PUSH: 'live' }
const env = (vars: Record<string, string | undefined>) => {
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v)
}

beforeEach(() => {
  vi.clearAllMocks()
  reads.length = 0
  auth.requireRequestContext.mockResolvedValue({
    tenantId,
    tenantRole: 'owner'
  })
  supabase.createClient.mockResolvedValue(db())
  rpc.mockResolvedValue({ data: 3, error: null })
  rows = {
    email_builds: {
      data: { run_id: run, slot: 2, sample_draft: false },
      error: null
    },
    email_versions: { data: { email: email() }, error: null }
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
  it('brings the version back for the owner, then pushes it through the push path', async () => {
    expect(await restore()).toBeUndefined()
    expect(rpc).toHaveBeenCalledWith('restore_email_version', {
      t: tenantId,
      build,
      version: 1,
      shown: 2
    })
    // Read in the owner's own workspace (row security, and named here).
    expect(reads.map((r) => [r.table, r.eq[0]])).toEqual([
      ['email_builds', ['tenant_id', tenantId]],
      ['email_versions', ['tenant_id', tenantId]]
    ])
    expect(reads[1]!.eq).toContainEqual(['run_id', run])
    expect(reads[1]!.eq).toContainEqual(['slot', 2])
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

  it('leaves a real draft alone while Klaviyo cannot be written', async () => {
    for (const vars of [
      { KLAVIYO_DRAFT_PUSH: undefined },
      { KLAVIYO_MODE: 'fake' },
      { KLAVIYO_WRITE_LOCK: undefined },
      { KLAVIYO_WRITE_LOCK: 'locked' }
    ]) {
      env({ ...live, KLAVIYO_WRITE_LOCK: 'unlocked', ...vars })
      expect(await restore()).toEqual({
        error:
          'Putting emails into Klaviyo is switched off right now, so your draft was not changed.'
      })
    }
    expect(rpc).not.toHaveBeenCalled()
    expect(after).not.toHaveBeenCalled()
  })

  it('puts back a sample draft, or a sample store’s email, with the switches off', async () => {
    env({ KLAVIYO_DRAFT_PUSH: undefined, KLAVIYO_WRITE_LOCK: undefined })
    rows.email_builds = {
      data: { run_id: run, slot: 2, sample_draft: true },
      error: null
    }
    expect(await restore()).toBeUndefined()
    rows.email_builds = {
      data: { run_id: run, slot: 2, sample_draft: false },
      error: null
    }
    rows.email_versions = {
      data: { email: email({ sample: true }) },
      error: null
    }
    expect(await restore()).toBeUndefined()
    expect(rpc).toHaveBeenCalledTimes(2)
  })

  it('says why in plain words when the command refuses', async () => {
    const cases: [string, string][] = [
      [
        'version_scheduled',
        'This email is scheduled in Klaviyo, so GROS will not change it. Unschedule it in Klaviyo first.'
      ],
      [
        'version_sent',
        'This email was already sent from Klaviyo, so it cannot be changed.'
      ],
      [
        'version_busy',
        'This email is being made or put in Klaviyo right now. Wait until it is done, then try again.'
      ],
      [
        'version_stale',
        'This email changed since you opened the page. Reload the page to see its versions.'
      ],
      [
        'version_edited',
        'You changed this draft in Klaviyo, so GROS leaves it as it is.'
      ]
    ]
    for (const [hint, words] of cases) {
      rpc.mockResolvedValueOnce({
        data: null,
        error: { code: hint === 'version_current' ? '22023' : 'PT409', hint }
      })
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

  it('refuses a broken form, another workspace’s email and a version it cannot use', async () => {
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
    rows.email_builds = {
      data: { run_id: run, slot: 2, sample_draft: false },
      error: null
    }
    rows.email_versions = { data: null, error: null }
    expect(await restore()).toEqual({
      error:
        'This version is no longer kept. Reload the page to see the versions there are.'
    })
    // Stored the way an older app stored it: the push would refuse it.
    rows.email_versions = { data: { email: { html: '<p>' } }, error: null }
    expect(await restore()).toEqual({
      error:
        'This version was kept by an older version of the app, so it cannot be used again.'
    })
    expect(rpc).not.toHaveBeenCalled()
  })
})
