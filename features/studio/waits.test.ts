// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import {
  buildRenders,
  buildViews,
  claimWaitingDesign,
  designStudioOn,
  waitForPictures
} from './waits'

const build = '44444444-4444-4444-8444-444444444444'
const tenant = '00000000-0000-4000-8000-000000000101'
const lease = '22222222-2222-4222-8222-222222222222'
const id = (n: number) => `3333333${n}-3333-4333-8333-333333333333`

type Answer = { data: unknown; error: null | Record<string, string> }
/** A database that answers each RPC and query with `answer`, recording calls. */
function database(answer: Answer) {
  const calls: unknown[][] = []
  const query = {
    select: (...a: unknown[]) => (calls.push(['select', ...a]), query),
    eq: (...a: unknown[]) => (calls.push(['eq', ...a]), query),
    gt: (...a: unknown[]) => (calls.push(['gt', ...a]), query),
    not: (...a: unknown[]) => (calls.push(['not', ...a]), query),
    order: (...a: unknown[]) => (calls.push(['order', ...a]), query),
    limit: async (...a: unknown[]) => (calls.push(['limit', ...a]), answer)
  }
  return {
    calls,
    rpc: vi.fn(async (...a: unknown[]) => (calls.push(['rpc', ...a]), answer)),
    from: (table: string) => (calls.push(['from', table]), query)
  }
}
type Fake = ReturnType<typeof database>
const db = (d: Fake) => d as unknown as Parameters<typeof waitForPictures>[0]

describe('the owner’s switch for the design studio (DST-006b)', () => {
  it('is on only when DESIGN_STUDIO is exactly on', () => {
    expect(designStudioOn({ DESIGN_STUDIO: 'on' })).toBe(true)
    expect(designStudioOn({ DESIGN_STUDIO: ' on ' })).toBe(true)
    for (const value of [undefined, '', 'off', 'ON', 'true', '1'])
      expect(designStudioOn({ DESIGN_STUDIO: value })).toBe(false)
  })
})

describe('waiting for the pictures (DST-006b)', () => {
  const wait = (d: Fake, seconds = 600.4) =>
    waitForPictures(db(d), { build, lease, work: { round: 1 }, seconds })

  it('saves the work and waits whole seconds under the lease', async () => {
    const d = database({ data: 2, error: null })
    expect(await wait(d)).toEqual({ ok: true, waits: 2 })
    expect(d.calls).toEqual([
      [
        'rpc',
        'wait_email_round',
        { build, lease, work: { round: 1 }, seconds: 600 }
      ]
    ])
  })

  it('keeps the wait within 1 minute to 1 hour, and never sends a time that is not a number', async () => {
    for (const [asked, sent] of [
      [30, 60],
      [5_000, 3_600]
    ]) {
      const d = database({ data: 1, error: null })
      await wait(d, asked)
      expect(d.calls[0][2]).toMatchObject({ seconds: sent })
    }
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const d = database({ data: 1, error: null })
      await expect(wait(d, bad)).rejects.toThrow(
        'A wait needs a number of seconds'
      )
      expect(d.calls).toEqual([])
    }
  })

  it('says why it could not wait: the claim is gone, the wrong step, too many waits, refused work', async () => {
    expect(
      await wait(database({ data: null, error: { code: 'PT409' } }))
    ).toEqual({ ok: false, reason: 'lease' })
    expect(
      await wait(
        database({
          data: null,
          error: { code: 'PT409', details: 'not_design_step' }
        })
      )
    ).toEqual({ ok: false, reason: 'step' })
    expect(
      await wait(
        database({
          data: null,
          error: { code: '22023', details: 'too_many_waits' }
        })
      )
    ).toEqual({ ok: false, reason: 'too_many' })
    expect(
      await wait(database({ data: null, error: { code: '22023' } }))
    ).toEqual({ ok: false, reason: 'refused' })
    await expect(
      wait(database({ data: null, error: { code: 'XX000' } }))
    ).rejects.toMatchObject({ code: 'XX000' })
  })
})

describe('finding and claiming a waiting design step (DST-006b)', () => {
  it('claims a named step or the readiest, or nothing when none is ready', async () => {
    const claimed = { id: build, step: 'design', lease_token: lease }
    const d = database({ data: [claimed], error: null })
    expect(await claimWaitingDesign(db(d), build)).toEqual(claimed)
    expect(d.calls).toEqual([['rpc', 'claim_studio_build', { target: build }]])
    // Unnamed: the one waiting longest that is ready.
    const any = database({ data: [claimed], error: null })
    expect(await claimWaitingDesign(db(any))).toEqual(claimed)
    expect(any.calls).toEqual([['rpc', 'claim_studio_build', {}]])
    // An empty name is a name, never "any".
    const empty = database({ data: [], error: null })
    await claimWaitingDesign(db(empty), '')
    expect(empty.calls).toEqual([['rpc', 'claim_studio_build', { target: '' }]])
    expect(
      await claimWaitingDesign(db(database({ data: [], error: null })), build)
    ).toBeNull()
    await expect(
      claimWaitingDesign(
        db(database({ data: null, error: { code: '42501' } })),
        build
      )
    ).rejects.toMatchObject({ code: '42501' })
  })
})

describe('reading a build’s pictures (DST-006b)', () => {
  const row = (n: number, change: Record<string, unknown>) => ({
    id: id(n),
    section_key: `s2-r${n}`,
    state: 'queued',
    failure: null,
    path: null,
    height: null,
    bytes: null,
    etag: null,
    ...change
  })

  it('reads each picture in its own shape, oldest first, at most a build’s 12', async () => {
    const d = database({
      data: [
        row(1, {
          state: 'drawn',
          path: `render/${id(1)}.jpg`,
          height: 640,
          bytes: 120_000,
          etag: '"abc"'
        }),
        row(2, { state: 'failed', failure: 'timeout' }),
        row(3, {})
      ],
      error: null
    })
    expect(await buildRenders(db(d), { tenant, build })).toEqual([
      {
        id: id(1),
        key: 's2-r1',
        state: 'drawn',
        path: `render/${id(1)}.jpg`,
        // CSS px: the picture is twice as tall.
        height: 320,
        bytes: 120_000,
        etag: '"abc"'
      },
      { id: id(2), key: 's2-r2', state: 'failed', failure: 'timeout' },
      { id: id(3), key: 's2-r3', state: 'queued' }
    ])
    expect(d.calls).toEqual([
      ['from', 'section_renders'],
      ['select', 'id,section_key,state,failure,path,height,bytes,etag'],
      ['eq', 'tenant_id', tenant],
      ['eq', 'build_id', build],
      ['order', 'created_at'],
      ['order', 'id'],
      ['limit', 12]
    ])
  })

  it('reads a row it cannot trust as failed, never as drawn, and leaves out one it cannot read', async () => {
    const drawn = {
      state: 'drawn',
      path: `render/${id(1)}.jpg`,
      height: 640,
      bytes: 1,
      etag: 'e'
    }
    const d = database({
      data: [
        row(1, { ...drawn, path: null }),
        row(2, { ...drawn, path: `render/${id(9)}.jpg` }),
        row(3, { ...drawn, height: 641 }),
        row(4, { state: 'failed', failure: null }),
        row(5, { state: 'gone' }),
        { id: 7, section_key: {} }
      ],
      error: null
    })
    expect(
      (await buildRenders(db(d), { tenant, build })).map((r) => [
        r.key,
        r.state
      ])
    ).toEqual([
      ['s2-r1', 'failed'],
      ['s2-r2', 'failed'],
      ['s2-r3', 'failed'],
      ['s2-r4', 'failed']
    ])
    await expect(
      buildRenders(db(database({ data: null, error: { code: 'XX000' } })), {
        tenant,
        build
      })
    ).rejects.toMatchObject({ code: 'XX000' })
  })
})

describe('the build’s email views (DST-006d)', () => {
  const row = (n: number, change: Record<string, unknown>) => ({
    id: id(n),
    render_key: 'e-abc',
    view: 'phone',
    state: 'queued',
    failure: null,
    path: null,
    height: null,
    cut: null,
    wide: null,
    bytes: null,
    etag: null,
    ...change
  })
  const drawn = (n: number) => ({
    state: 'drawn',
    path: `email/${id(n)}.jpg`,
    height: 2100,
    cut: false,
    wide: false,
    bytes: 90_000,
    etag: '"v"'
  })

  it('reads each view in its own shape, oldest first, at most a build’s 9, in its own workspace', async () => {
    const d = database({
      data: [
        row(1, drawn(1)),
        row(2, { view: 'dark', state: 'failed', failure: 'timeout' }),
        row(3, { view: 'desktop' })
      ],
      error: null
    })
    expect(await buildViews(db(d), { tenant, build })).toEqual([
      {
        id: id(1),
        key: 'e-abc',
        view: 'phone',
        state: 'drawn',
        path: `email/${id(1)}.jpg`,
        height: 2100,
        cut: false,
        wide: false,
        bytes: 90_000,
        etag: '"v"'
      },
      {
        id: id(2),
        key: 'e-abc',
        view: 'dark',
        state: 'failed',
        failure: 'timeout'
      },
      { id: id(3), key: 'e-abc', view: 'desktop', state: 'queued' }
    ])
    expect(d.calls).toEqual([
      ['from', 'email_renders'],
      [
        'select',
        'id,render_key,view,state,failure,path,height,cut,wide,bytes,etag'
      ],
      ['eq', 'tenant_id', tenant],
      ['eq', 'build_id', build],
      ['order', 'created_at'],
      ['order', 'id'],
      ['limit', 9]
    ])
  })

  it('reads a row it cannot trust as failed, never as drawn, and leaves out one it cannot read', async () => {
    const d = database({
      data: [
        row(1, { ...drawn(1), path: null }),
        row(2, { ...drawn(2), path: `email/${id(9)}.jpg` }),
        row(3, { ...drawn(3), cut: true }),
        row(4, { ...drawn(4), wide: null }),
        row(5, { ...drawn(5), height: 6001 }),
        row(6, { state: 'gone' }),
        row(7, { view: 'tablet' }),
        { id: 8, render_key: {} }
      ],
      error: null
    })
    expect(
      (await buildViews(db(d), { tenant, build })).map((v) => v.state)
    ).toEqual(['failed', 'failed', 'failed', 'failed', 'failed', 'failed'])
    await expect(
      buildViews(db(database({ data: null, error: { code: 'XX000' } })), {
        tenant,
        build
      })
    ).rejects.toMatchObject({ code: 'XX000' })
  })
})
