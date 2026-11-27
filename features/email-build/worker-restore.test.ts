// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))

import { memoryFallbackLog } from '@/features/fallback/log'
import {
  fakeDraftPusher,
  type DraftInput,
  type DraftPusher
} from '@/lib/providers/klaviyo-draft'
import { buildEmail, type BuiltEmail, type PlannedEmail } from './build'
import { sampleOffers, sampleStoreSource } from './ports'
import { pushFactsOf, runEmailBuilds } from './worker'

/**
 * PICK-106: a restored email goes through the worker's push step like any
 * push: the planned email's key, so the same draft is updated; and never
 * through the fake pusher once Klaviyo holds the draft.
 */
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
const built = async (): Promise<BuiltEmail> => {
  const made = await buildEmail(
    {
      planned,
      store: await sampleStoreSource.read(tenant),
      offers: sampleOffers
    },
    { tenantId: tenant, callerKey: 'x', fallbacks: memoryFallbackLog() }
  )
  if (!made.ok) throw new Error('sample build failed')
  // The store's own email (not the sample's): it may go to Klaviyo.
  return { ...made.email, sample: false }
}

type Call = { fn: string; args: Record<string, unknown> }
/** One push-queued build to claim; the tables `pushFactsOf` reads. */
function fakeDb(
  email: BuiltEmail,
  tables: {
    klaviyo_draft_pushes?: unknown[]
    email_builds?: unknown[]
  } = {}
) {
  const calls: Call[] = []
  let claimed = false
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
    calls.push({ fn, args })
    if (fn === 'claim_email_build') {
      if (claimed) return { data: [], error: null }
      claimed = true
      return {
        data: [
          {
            id: 'build-1',
            tenant_id: tenant,
            state: 'push_queued',
            step: 'push',
            progress: {},
            run_id: 'run-1',
            slot: 0,
            planned,
            email,
            push_key: 'key-1',
            timezone: 'UTC',
            start_on: inDays(1),
            lease_token: 'lease-1'
          }
        ],
        error: null
      }
    }
    return { data: fn === 'fail_email_step' ? 'failed' : null, error: null }
  })
  const from = (table: keyof typeof tables) => {
    const q = {
      select: () => q,
      eq: (...args: unknown[]) => {
        calls.push({ fn: `${table}.eq`, args: { args } })
        return q
      },
      then: (done: (r: unknown) => unknown) =>
        Promise.resolve({ data: tables[table] ?? [], error: null }).then(done)
    }
    return q
  }
  return { db: { rpc, from } as never, calls }
}
const run = (
  db: never,
  pusher: DraftPusher,
  restoreCheck: () => Promise<string | null> = async () => null
) =>
  runEmailBuilds(db, {
    pusher,
    fallbacks: memoryFallbackLog(),
    klaviyoState: async () => null,
    restoreCheck
  })

describe('a restored email’s push (PICK-106)', () => {
  it('updates the same draft: the planned email’s key, the same campaign back', async () => {
    const drafts = new Map<string, { campaign: string; html: string }>()
    const inputs: DraftInput[] = []
    // A live-like pusher: the same key returns its draft, updated.
    const pusher: DraftPusher = {
      async createDraft(input) {
        inputs.push(input)
        const had = drafts.get(input.idempotencyKey)
        const campaign = had?.campaign ?? `Cmp${drafts.size + 1}`
        drafts.set(input.idempotencyKey, { campaign, html: input.html })
        return { ok: true, campaignId: campaign, sample: false }
      }
    }
    const v2 = await built()
    const v1 = { ...v2, html: v2.html.replace('</body>', '<!-- v1 --></body>') }
    const first = fakeDb(v2)
    await run(first.db, pusher)
    // "Use this version": version 1 on the same build, the same key.
    const restored = fakeDb(v1, {
      email_builds: [{ sample_draft: false, restore_version: 'v3' }]
    })
    await run(restored.db, pusher)
    expect(inputs.map((i) => i.idempotencyKey)).toEqual(['key-1', 'key-1'])
    expect(drafts.size).toBe(1)
    expect(drafts.get('key-1')).toEqual({ campaign: 'Cmp1', html: v1.html })
    expect(
      restored.calls.find((c) => c.fn === 'finish_email_push')?.args
    ).toMatchObject({ build: 'build-1', campaign: 'Cmp1', sample: false })
    expect(restored.calls.some((c) => c.fn === 'fail_email_step')).toBe(false)
  })

  it('never hands a draft Klaviyo holds to the fake pusher (the switch turned off while it waited)', async () => {
    const email = await built()
    for (const tables of [
      // A restore of a real draft.
      { email_builds: [{ sample_draft: false, restore_version: 'v3' }] },
      // A key the live pusher wrote (any build of the planned email).
      { klaviyo_draft_pushes: [{ campaign_id: 'Cmp1' }] }
    ]) {
      const { db, calls } = fakeDb(email, tables)
      const fake = fakeDraftPusher()
      await run(db, fake)
      expect(fake.calls).toEqual([])
      expect(calls.find((c) => c.fn === 'fail_email_step')?.args).toEqual({
        build: 'build-1',
        lease: 'lease-1',
        code: 'push_switched_off',
        final: true
      })
      expect(calls.some((c) => c.fn === 'finish_email_push')).toBe(false)
    }
  })

  it('still makes a sample draft of an email Klaviyo never held', async () => {
    const email = await built()
    for (const tables of [
      {},
      // A restore of a sample draft.
      { email_builds: [{ sample_draft: true, restore_version: 'v3' }] }
    ]) {
      const { db, calls } = fakeDb(email, tables)
      const fake = fakeDraftPusher()
      await run(db, fake)
      expect(fake.calls).toHaveLength(1)
      expect(
        calls.find((c) => c.fn === 'finish_email_push')?.args
      ).toMatchObject({ sample: true })
    }
  })

  it('checks a restore again before it is pushed, and leaves the draft on a refusal', async () => {
    const email = await built()
    const { db, calls } = fakeDb(email, {
      email_builds: [{ sample_draft: false, restore_version: 'v3' }]
    })
    const pusher = { createDraft: vi.fn() }
    const check = vi.fn(
      async () => 'This version no longer passes the email checks: x'
    )
    await run(db, pusher, check)
    expect(check).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: tenant, push_key: 'key-1' }),
      expect.objectContaining({ subject: email.subject })
    )
    expect(pusher.createDraft).not.toHaveBeenCalled()
    expect(calls.find((c) => c.fn === 'fail_email_step')?.args).toMatchObject({
      code: 'restore_unsafe',
      final: true
    })
    // Not a restore: not checked again.
    const plain = fakeDb(email)
    const other = vi.fn(async () => 'x')
    await run(
      plain.db,
      {
        createDraft: async () => ({ ok: true, campaignId: 'C', sample: false })
      },
      other
    )
    expect(other).not.toHaveBeenCalled()
  })

  it('tries a restore again when its checks could not read what they need', async () => {
    const { db, calls } = fakeDb(await built(), {
      email_builds: [{ sample_draft: false, restore_version: 'v3' }]
    })
    const pusher = { createDraft: vi.fn() }
    await run(
      db,
      pusher,
      async () =>
        'This version could not be checked just now. Try again in a moment.'
    )
    expect(pusher.createDraft).not.toHaveBeenCalled()
    expect(calls.find((c) => c.fn === 'fail_email_step')?.args).toMatchObject({
      code: 'restore_unchecked',
      final: false
    })
  })

  it('reads whether Klaviyo holds it in the build’s own workspace', async () => {
    const { db, calls } = fakeDb(await built())
    expect(await pushFactsOf(db)(tenant, 'key-1', 'build-1')).toEqual({
      realDraft: false,
      restore: false
    })
    // A push row that never made a campaign: Klaviyo holds no draft.
    const none = fakeDb(await built(), {
      klaviyo_draft_pushes: [{ campaign_id: null }]
    })
    expect(
      (await pushFactsOf(none.db)(tenant, 'key-1', 'build-1')).realDraft
    ).toBe(false)
    expect(calls.map((c) => [c.fn, c.args.args])).toEqual([
      ['klaviyo_draft_pushes.eq', ['tenant_id', tenant]],
      ['klaviyo_draft_pushes.eq', ['push_key', 'key-1']],
      ['email_builds.eq', ['tenant_id', tenant]],
      ['email_builds.eq', ['id', 'build-1']]
    ])
  })
})
