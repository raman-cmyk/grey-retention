// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import {
  klaviyoClient,
  type KlaviyoTransport
} from '@/lib/providers/klaviyo/client'
import { hygieneSegmentDefinition } from '@/lib/providers/klaviyo/hygiene-segment'
import { fakeDraftAccount } from '@/lib/providers/klaviyo/recorded-drafts'
import {
  fakeSegmentAccount,
  segmentPaths,
  type SegmentFaults
} from '@/lib/providers/klaviyo/recorded-segments'
import type { HygieneSettings } from '@/features/audiences/hygiene'
import {
  HygieneBusy,
  hygieneExclusion,
  hygieneRetryMs,
  hygieneShortRetryMs,
  type HygieneStep,
  type HygieneStore,
  type StoredHygieneSegment
} from './hygiene'
import { liveDraftPusher, type PushProgress, type PushStore } from './pusher'

const tenantId = '00000000-0000-4000-8000-000000000101'
const ref = { tenantId, build: 'b1', lease: 'l1' }
const namePattern = /^List hygiene · 180 days · v1 · [a-f0-9]{8}$/

/**
 * The hygiene rows in memory, kept as `save_hygiene_segment` keeps them:
 * entering `creating` stamps the time itself and refuses while another
 * build's claim is live (`busy` makes every claim refused, as another push).
 */
function memoryHygiene(
  settings: HygieneSettings = { enabled: true, days: 180 },
  clock: () => Date = () => new Date()
) {
  const rows = new Map<string, StoredHygieneSegment>()
  const saves: HygieneStep[] = []
  const state = { busy: false, settings }
  const store: HygieneStore = {
    async settings() {
      return state.settings
    },
    async load(_t, key) {
      const row = rows.get(key)
      return row ? { ...row } : null
    },
    async save(_ref, key, step) {
      if (state.busy && step.state === 'creating') throw new HygieneBusy()
      saves.push(step)
      const row: StoredHygieneSegment = rows.get(key) ?? {
        state: 'failed',
        segmentId: null,
        reason: null,
        accountId: null,
        fingerprint: null,
        createStartedAt: null,
        profileCount: null,
        countedAt: null,
        updatedAt: ''
      }
      const creating = step.state === 'creating'
      rows.set(key, {
        ...row,
        ...step,
        ...(creating
          ? { createStartedAt: clock().toISOString(), reason: null }
          : {}),
        updatedAt: clock().toISOString()
      })
    }
  }
  return { store, rows, saves, state }
}

const client = (transport: KlaviyoTransport) =>
  klaviyoClient('pk_SAMPLE0123456789abcdefghij', { transport, maxWaits: 0 })

const posts = (calls: string[]) =>
  calls.filter((c) => c === 'POST /api/segments').length

describe('list hygiene segment (fake Klaviyo)', () => {
  beforeEach(() => vi.stubEnv('KLAVIYO_WRITE_LOCK', 'unlocked'))
  afterEach(() => vi.unstubAllEnvs())

  const setup = (faults: SegmentFaults = {}, size?: number) => {
    let now = Date.parse('2026-11-27T12:00:00Z')
    const clock = () => new Date(now)
    const account = fakeSegmentAccount({ faults, now: clock, size })
    const memory = memoryHygiene(undefined, clock)
    return {
      account,
      memory,
      run: () =>
        hygieneExclusion(client(account.transport), ref, memory.store, {
          now: clock
        }),
      later: (ms: number) => (now += ms),
      row: () => memory.rows.get('v1-180')
    }
  }

  it('makes the segment once, then reuses it (checking it is still there)', async () => {
    const { account, run, row } = setup({}, 930)
    expect(await run()).toEqual({ excluded: ['SegHyg001'] })
    const made = [...account.segments.values()]
    expect(made).toHaveLength(1)
    expect(made[0]!.name).toMatch(namePattern)
    expect(row()).toMatchObject({
      state: 'ready',
      segmentId: 'SegHyg001',
      accountId: 'AcctCedar'
    })
    const calls = account.calls.length
    expect(await run()).toEqual({ excluded: ['SegHyg001'] })
    expect(await run()).toEqual({ excluded: ['SegHyg001'] })
    expect(posts(account.calls)).toBe(1)
    // Each reuse: the account, the metrics, the segment itself.
    expect(account.calls.slice(calls, calls + 3)).toEqual([
      'GET /api/accounts',
      'GET /api/metrics',
      'GET /api/segments/SegHyg001'
    ])
    expect(row()!.profileCount).toBe(930)
  })

  it('reads every Placed Order metric and Active on Site under API', async () => {
    const { account, run } = setup({
      extra: [
        ['MetOrdWoo', 'Placed Order', 'WooCommerce'],
        ['MetSite2', 'Active on Site', 'Klaviyo']
      ]
    })
    await run()
    const [made] = [...account.segments.values()]
    const ids = (
      made!.definition as {
        condition_groups: { conditions: { metric_id: string }[] }[]
      }
    ).condition_groups.map((g) => g.conditions[0]!.metric_id)
    expect(ids).toEqual(
      expect.arrayContaining([
        'MetSite',
        'MetSite2',
        'MetOrd',
        'MetOrdApi',
        'MetOrdWoo'
      ])
    )
  })

  it('makes no segment when a keep-signal is missing or the read is unsure', async () => {
    for (const [faults, reason] of [
      [{ brokenMetric: true }, 'metrics_unread'],
      [{ without: ['Placed Order'] }, 'no_order_metric'],
      [{ without: ['Received Email'] }, 'no_email_metrics']
    ] as const) {
      const { account, run, row } = setup(faults)
      expect(await run()).toEqual({ excluded: [] })
      expect(posts(account.calls)).toBe(0)
      expect(row()).toMatchObject({ state: 'no_data', reason })
    }
  })

  it('finds the segment it made when the answer was lost', async () => {
    const { account, run, later } = setup({ loseCreate: true })
    // This draft goes in without it; the next push finds it by name.
    expect(await run()).toEqual({ excluded: [] })
    later(hygieneShortRetryMs + 1)
    expect(await run()).toEqual({ excluded: ['SegHyg001'] })
    expect(posts(account.calls)).toBe(1)
    expect(account.segments.size).toBe(1)
  })

  it('adopts a segment with its name only when the definition is the same', async () => {
    const first = setup()
    await first.run()
    const [, mine] = [...first.account.segments.entries()][0]!
    // Another store state: the row lost, the segment still in Klaviyo.
    const ours = setup()
    ours.account.segments.set('SegOld', {
      ...mine,
      created: '2026-01-01T00:00:00Z'
    })
    expect(await ours.run()).toEqual({ excluded: ['SegOld'] })
    expect(posts(ours.account.calls)).toBe(0)
    // Same name, other rules: not ours, not used, nothing made over it.
    const theirs = setup()
    theirs.account.segments.set('SegOther', {
      ...mine,
      definition: { condition_groups: [] }
    })
    expect(await theirs.run()).toEqual({ excluded: [] })
    expect(posts(theirs.account.calls)).toBe(0)
    expect(theirs.row()).toMatchObject({
      state: 'failed',
      reason: 'name_taken'
    })
  })

  it('a stored segment deleted in Klaviyo is not made again until asked', async () => {
    const { account, run, row, later } = setup()
    await run()
    account.segments.clear()
    expect(await run()).toEqual({ excluded: [] })
    expect(row()).toMatchObject({ state: 'deleted', reason: 'segment_deleted' })
    later(10 * hygieneRetryMs)
    expect(await run()).toEqual({ excluded: [] })
    expect(posts(account.calls)).toBe(1)
  })

  it('a reconnect to another account or other metrics makes a new segment', async () => {
    const { account, run } = setup()
    expect(await run()).toEqual({ excluded: ['SegHyg001'] })
    // Another account: it does not have the first one's segments.
    account.faults.accountId = 'AcctOther'
    account.segments.clear()
    expect(await run()).toEqual({ excluded: ['SegHyg002'] })
    account.faults.extra = [['MetOrdNew', 'Placed Order', 'Shopify']]
    expect(await run()).toEqual({ excluded: ['SegHyg003'] })
    const names = [...account.segments.values()].map((s) => s.name)
    expect(names).toHaveLength(2)
    expect(names[0]).not.toBe(names[1])
  })

  it('waits while another push is making it', async () => {
    const { account, memory, run } = setup()
    memory.state.busy = true
    expect(await run()).toBe('wait')
    expect(posts(account.calls)).toBe(0)
  })

  it('makes a new segment when the owner changes the days', async () => {
    const { account, memory, run } = setup()
    await run()
    memory.state.settings = { enabled: true, days: 90 }
    expect(await run()).toEqual({ excluded: ['SegHyg002'] })
    expect([...account.segments.values()].map((s) => s.name)[1]).toMatch(
      /^List hygiene · 90 days · v1 · /
    )
  })

  it('leaves nobody out with hygiene off, and calls Klaviyo for nothing', async () => {
    const { account, memory, run } = setup()
    memory.state.settings = { enabled: false, days: 180 }
    expect(await run()).toEqual({ excluded: [] })
    expect(account.calls).toEqual([])
  })

  it('never holds an email back: any refusal or outage gives no exclusion', async () => {
    for (const [faults, reason, retry] of [
      [{ noWriteScope: true }, 'missing_scope', hygieneRetryMs],
      [{ refuseCreate: true }, 'refused', hygieneRetryMs],
      [{ refuse: ['GET /api/metrics'] }, 'refused', hygieneRetryMs],
      [{ refuse: ['GET /api/segments'] }, 'refused', hygieneRetryMs],
      [{ outage: '/api/metrics' }, 'klaviyo_unavailable', hygieneShortRetryMs]
    ] as const) {
      const { row, run, later, account } = setup(faults)
      expect(await run()).toEqual({ excluded: [] })
      expect(row()).toMatchObject({ state: 'failed', reason })
      const calls = account.calls.length
      expect(await run()).toEqual({ excluded: [] })
      expect(account.calls.length).toBe(calls)
      later(retry + 1)
      await run()
      expect(account.calls.length).toBeGreaterThan(calls)
    }
  })

  it('is refused by the write lock before any network call', async () => {
    vi.stubEnv('KLAVIYO_WRITE_LOCK', '')
    const { account, run, row } = setup()
    expect(await run()).toEqual({ excluded: [] })
    expect(posts(account.calls)).toBe(0)
    expect(row()).toMatchObject({ state: 'failed', reason: 'write_locked' })
  })

  it('the client refuses any other segment write', async () => {
    const c = client(fakeSegmentAccount().transport)
    const def = hygieneSegmentDefinition({
      version: 1,
      days: 180,
      recentOrderDays: 180,
      minEmails: 5,
      privacyFilter: false,
      metrics: {
        receivedEmail: 'R',
        clickedEmail: 'C',
        openedEmail: 'O',
        activeOnSite: [],
        placedOrders: ['P']
      }
    })
    for (const body of [
      {
        data: {
          type: 'segment',
          attributes: { name: 'VIP', definition: def, is_starred: false }
        }
      },
      {
        data: {
          type: 'segment',
          attributes: {
            name: 'List hygiene · 180 days · v1 · 0123abcd',
            definition: {
              condition_groups: [{ conditions: [{ type: 'profile-property' }] }]
            },
            is_starred: false
          }
        }
      }
    ])
      await expect(
        c.write('POST', '/api/segments', body, 'segments:write')
      ).rejects.toMatchObject({ kind: 'rejected' })
    await expect(
      c.write('DELETE', '/api/segments/SegHyg001', null, 'segments:write')
    ).rejects.toMatchObject({ kind: 'rejected' })
  })
})

describe('the live pusher leaves the hygiene segment out of the draft', () => {
  beforeEach(() => vi.stubEnv('KLAVIYO_WRITE_LOCK', 'unlocked'))
  afterEach(() => vi.unstubAllEnvs())

  function memoryPushes(): PushStore {
    const rows = new Map<string, PushProgress>()
    return {
      async load({ key }) {
        const row = rows.get(key)
        return row ? structuredClone(row) : null
      },
      async save({ key }, step) {
        const { images, ...rest } = step
        delete rest.checks
        const row = rows.get(key) ?? {
          state: 'started',
          images: {},
          templates: [],
          campaignId: null,
          messageId: null,
          createStartedAt: null,
          messageStartedAt: null,
          templateStartedAt: null,
          deleteAnsweredAt: null,
          audienceId: null,
          designs: null,
          fallback: null,
          ab: null,
          reason: null,
          written: null,
          target: null,
          shown: null
        }
        rows.set(key, {
          ...row,
          ...rest,
          images: { ...row.images, ...(images ?? {}) }
        })
      }
    }
  }
  const footer =
    '<p>{{ organization.name }}<br>{{ organization.full_address }}<br>{% unsubscribe "Unsubscribe" %} · {% manage_preferences "Preferences" %}<br>{% web_view "View in browser" %}</p>'
  const draft = (key: string) => ({
    tenantId,
    idempotencyKey: key,
    name: 'Tue 17 Nov · Offer',
    subject: '20% off knitwear',
    preheader: 'This weekend only.',
    html: `<html><body><h1>A</h1><a href="https://cedar.example/p/1">Shop</a>${footer}</body></html>`,
    plannedSendAt: '2026-11-17T18:00:00Z',
    audienceId: 'SegEng90',
    sample: false,
    lease: { build: `build-${key}`, token: 'lease-1' },
    contentChecked: true
  })
  const keyA = '6f1c2d3e-4b5a-4c6d-8e7f-0123456789ab'
  const keyB = '7f1c2d3e-4b5a-4c6d-8e7f-0123456789ab'

  function setup(
    settings?: HygieneSettings,
    hygiene = true,
    faults: SegmentFaults = {}
  ) {
    const drafts = fakeDraftAccount()
    const segments = fakeSegmentAccount({ faults })
    const memory = memoryHygiene(settings)
    const pusher = liveDraftPusher({
      source: {
        async client() {
          return client((request) =>
            segmentPaths(new URL(request.url).pathname)
              ? segments.transport(request)
              : drafts.transport(request)
          )
        },
        async timezone() {
          return 'America/Los_Angeles'
        }
      },
      store: memoryPushes(),
      ...(hygiene ? { hygiene: memory.store } : {})
    })
    return { drafts, segments, pusher, memory }
  }

  it('two emails: one segment made, both drafts leave it out', async () => {
    const { drafts, segments, pusher } = setup()
    const a = await pusher.createDraft(draft(keyA))
    const b = await pusher.createDraft(draft(keyB))
    expect(a.ok && b.ok).toBe(true)
    expect(segments.segments.size).toBe(1)
    const campaigns = [...drafts.campaigns.values()]
    expect(campaigns.map((c) => [c.included, c.excluded])).toEqual([
      [['SegEng90'], ['SegHyg001']],
      [['SegEng90'], ['SegHyg001']]
    ])
  })

  it('a refused name lookup or metrics read still gives a draft', async () => {
    for (const refuse of [['GET /api/segments'], ['GET /api/metrics']]) {
      const { drafts, pusher } = setup(undefined, true, { refuse })
      const r = await pusher.createDraft(draft(keyA))
      expect(r.ok).toBe(true)
      expect([...drafts.campaigns.values()][0]!.excluded).toEqual([])
    }
  })

  it('a draft Klaviyo refuses with the exclusion goes in without it', async () => {
    const { drafts, memory, pusher } = setup()
    // Klaviyo will not take the excluded segment (made, then refused).
    const original = drafts.transport
    drafts.transport = async (request) => {
      if (
        request.method === 'POST' &&
        new URL(request.url).pathname === '/api/campaigns' &&
        (request.body ?? '').includes('SegHyg')
      )
        return { status: 400, headers: {}, body: '{"errors":[]}' }
      return original(request)
    }
    const r = await pusher.createDraft(draft(keyA))
    expect(r.ok).toBe(true)
    expect([...drafts.campaigns.values()][0]!.excluded).toEqual([])
    expect(memory.rows.get('v1-180')).toMatchObject({
      state: 'failed',
      reason: 'draft_refused'
    })
  })

  it('with hygiene off (or not wired) the draft leaves nobody out', async () => {
    for (const s of [
      setup({ enabled: false, days: 180 }),
      setup(undefined, false)
    ]) {
      const r = await s.pusher.createDraft(draft(keyA))
      expect(r.ok).toBe(true)
      expect([...s.drafts.campaigns.values()][0]!.excluded).toEqual([])
      // Only the audience check (the planned segment is there).
      expect(s.segments.calls).toEqual(['GET /api/segments/SegEng90'])
    }
  })
})
