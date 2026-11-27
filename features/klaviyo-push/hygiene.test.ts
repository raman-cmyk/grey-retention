// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import {
  klaviyoClient,
  type KlaviyoTransport
} from '@/lib/providers/klaviyo/client'
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
  type HygieneStep,
  type HygieneStore,
  type StoredHygieneSegment
} from './hygiene'
import { liveDraftPusher, type PushProgress, type PushStore } from './pusher'

const tenantId = '00000000-0000-4000-8000-000000000101'
const ref = { tenantId, build: 'b1', lease: 'l1' }
const name = 'GROS list hygiene · 180 days · v1'

/** The hygiene rows in memory; `busy` makes "creating" refused (another push). */
function memoryHygiene(
  settings: HygieneSettings = { enabled: true, days: 180 }
) {
  const rows = new Map<string, StoredHygieneSegment>()
  const saves: HygieneStep[] = []
  let clock = () => new Date()
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
      const row = rows.get(key) ?? {
        state: 'creating',
        segmentId: null,
        reason: null,
        createStartedAt: null,
        profileCount: null,
        countedAt: null,
        updatedAt: ''
      }
      rows.set(key, { ...row, ...step, updatedAt: clock().toISOString() })
    }
  }
  return {
    store,
    rows,
    saves,
    state,
    setClock: (c: () => Date) => (clock = c)
  }
}

const client = (transport: KlaviyoTransport) =>
  klaviyoClient('pk_SAMPLE0123456789abcdefghij', { transport, maxWaits: 0 })

describe('list hygiene segment (fake Klaviyo)', () => {
  beforeEach(() => vi.stubEnv('KLAVIYO_WRITE_LOCK', 'unlocked'))
  afterEach(() => vi.unstubAllEnvs())

  const setup = (faults: SegmentFaults = {}, size?: number) => {
    let now = Date.parse('2026-11-27T12:00:00Z')
    const account = fakeSegmentAccount({
      faults,
      now: () => new Date(now),
      size
    })
    const memory = memoryHygiene()
    memory.setClock(() => new Date(now))
    return {
      account,
      memory,
      run: () =>
        hygieneExclusion(
          client(account.transport),
          ref,
          memory.store,
          () => new Date(now)
        ),
      later: (ms: number) => (now += ms)
    }
  }
  const posts = (calls: string[]) =>
    calls.filter((c) => c === 'POST /api/segments').length

  it('makes the segment once, then reuses it', async () => {
    const { account, memory, run } = setup({}, 930)
    const first = await run()
    expect(first).toEqual({ excluded: ['SegGros001'] })
    const made = [...account.segments.values()]
    expect(made).toHaveLength(1)
    expect(made[0]!.name).toBe(name)
    expect(memory.rows.get('v1-180')).toMatchObject({
      state: 'ready',
      segmentId: 'SegGros001'
    })
    const calls = account.calls.length
    expect(await run()).toEqual({ excluded: ['SegGros001'] })
    expect(await run()).toEqual({ excluded: ['SegGros001'] })
    expect(posts(account.calls)).toBe(1)
    // Reused without asking Klaviyo again, except one size read.
    expect(account.calls.slice(calls)).toEqual(['GET /api/segments/SegGros001'])
    expect(memory.rows.get('v1-180')!.profileCount).toBe(930)
  })

  it('finds the segment it made when the answer was lost', async () => {
    const { account, run } = setup({ loseCreate: true })
    await expect(run()).rejects.toThrow()
    expect(await run()).toEqual({ excluded: ['SegGros001'] })
    expect(posts(account.calls)).toBe(1)
    expect(account.segments.size).toBe(1)
  })

  it('reuses a segment already in Klaviyo with the rule name', async () => {
    const { account, run } = setup()
    account.segments.set('SegOld', {
      name,
      definition: {},
      created: '2026-01-01T00:00:00Z',
      profileCount: 5
    })
    expect(await run()).toEqual({ excluded: ['SegOld'] })
    expect(posts(account.calls)).toBe(0)
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
    expect(await run()).toEqual({ excluded: ['SegGros002'] })
    expect([...account.segments.values()].map((s) => s.name)).toEqual([
      name,
      'GROS list hygiene · 90 days · v1'
    ])
  })

  it('leaves nobody out with hygiene off, and calls Klaviyo for nothing', async () => {
    const { account, memory, run } = setup()
    memory.state.settings = { enabled: false, days: 180 }
    expect(await run()).toEqual({ excluded: [] })
    expect(account.calls).toEqual([])
  })

  it('never holds an email back: no metrics, no scope or a refusal', async () => {
    for (const [faults, reason] of [
      [{ without: ['Received Email'] }, 'no_email_metrics'],
      [{ noWriteScope: true }, 'missing_scope'],
      [{ refuseCreate: true }, 'refused']
    ] as const) {
      const { memory, run, later, account } = setup(faults)
      expect(await run()).toEqual({ excluded: [] })
      expect(memory.rows.get('v1-180')!.reason).toBe(reason)
      // Not asked again for a day.
      const calls = account.calls.length
      expect(await run()).toEqual({ excluded: [] })
      expect(account.calls.length).toBe(calls)
      later(25 * 3600_000)
      await run()
      expect(account.calls.length).toBeGreaterThan(calls)
    }
  })

  it('is refused by the write lock before any network call', async () => {
    vi.stubEnv('KLAVIYO_WRITE_LOCK', '')
    const { account, run } = setup()
    await expect(run()).rejects.toMatchObject({ kind: 'write_locked' })
    expect(posts(account.calls)).toBe(0)
  })

  it('the client refuses any other segment write', async () => {
    const c = client(fakeSegmentAccount().transport)
    for (const body of [
      {
        data: { type: 'segment', attributes: { name: 'VIP', definition: {} } }
      },
      {
        data: {
          type: 'segment',
          attributes: { name, definition: {}, is_starred: true }
        }
      },
      { data: { type: 'segment', attributes: { name } } },
      { data: { type: 'list', attributes: { name, definition: {} } } }
    ])
      await expect(
        c.write('POST', '/api/segments', body, 'segments:write')
      ).rejects.toMatchObject({ kind: 'rejected' })
    await expect(
      c.write('DELETE', '/api/segments/SegGros001', null, 'segments:write')
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

  function setup(settings?: HygieneSettings, hygiene = true) {
    const drafts = fakeDraftAccount()
    const segments = fakeSegmentAccount()
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
    return { drafts, segments, pusher }
  }

  it('two emails: one segment made, both drafts leave it out', async () => {
    const { drafts, segments, pusher } = setup()
    const a = await pusher.createDraft(
      draft('6f1c2d3e-4b5a-4c6d-8e7f-0123456789ab')
    )
    const b = await pusher.createDraft(
      draft('7f1c2d3e-4b5a-4c6d-8e7f-0123456789ab')
    )
    expect(a.ok && b.ok).toBe(true)
    expect(segments.segments.size).toBe(1)
    const campaigns = [...drafts.campaigns.values()]
    expect(campaigns.map((c) => [c.included, c.excluded])).toEqual([
      [['SegEng90'], ['SegGros001']],
      [['SegEng90'], ['SegGros001']]
    ])
  })

  it('with hygiene off (or not wired) the draft leaves nobody out', async () => {
    for (const s of [
      setup({ enabled: false, days: 180 }),
      setup(undefined, false)
    ]) {
      const r = await s.pusher.createDraft(
        draft('6f1c2d3e-4b5a-4c6d-8e7f-0123456789ab')
      )
      expect(r.ok).toBe(true)
      expect([...s.drafts.campaigns.values()][0]!.excluded).toEqual([])
      // Only the audience check (the planned segment is there): no metrics,
      // no hygiene segment looked up or made.
      expect(s.segments.calls).toEqual(['GET /api/segments/SegEng90'])
    }
  })
})
