// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Browser } from '@playwright/test'

const draw = vi.hoisted(() => ({
  renderSection: vi.fn(),
  renderEmail: vi.fn()
}))
vi.mock('./section-render.mjs', () => draw)
// DST-004b2c: the grids (no grid unless a test gives one).
const grids = vi.hoisted(() => ({
  lumaGrid: vi.fn(
    async (): Promise<{
      width: number
      height: number
      values: number[]
    } | null> => null
  ),
  fetchCrop: vi.fn(async () => new Uint8Array([1]))
}))
vi.mock('./luma-grid.mjs', () => grids)
import {
  carryOn,
  carryOnMs,
  perRun,
  run,
  runBudgetMs
} from './studio-renders.mjs'

const secret = 's'.repeat(40)
const base = 'https://app.test'
const browser = {} as Browser
const job = (n: number, upload?: string) => ({
  job: `j${n}`,
  lease: `l${n}`,
  render: `r${n}`,
  document: '<!doctype html><p>x</p>',
  height: 320,
  origins: ['https://cdn.shop.example'],
  upload: upload ?? `https://db.test/upload/render/r${n}.jpg?token=u${n}`
})

type Call = {
  url: string
  method: string
  body?: unknown
  raw?: unknown
  headers: Record<string, string>
}
/** One view of a built email to draw (DST-005b). */
const view = (n: number) => ({
  job: `v${n}`,
  lease: `w${n}`,
  render: `e${n}`,
  document: '<!doctype html><p>email</p>',
  view: 'phone',
  origins: ['https://cdn.shop.example'],
  upload: `https://db.test/upload/email/e${n}.jpg?token=x${n}`
})
/**
 * The app hands out `jobs` sections one per call, then none, and `views`
 * the same way; uploads answer `upload`.
 */
function app(
  options: {
    jobs?: number
    views?: number
    /** The previews route's own answer to a GET, when not 200. */
    viewsGet?: number
    upload?: number
    post?: number
    get?: number
    link?: string
    /** DST-004b2c: the crop's signed link handed with each section. */
    reference?: string
  } = {}
) {
  let left = options.jobs ?? 1
  let viewsLeft = options.views ?? 0
  let n = 0
  let v = 0
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const call: Call = {
        url,
        method: init.method ?? 'GET',
        raw: init.body,
        headers: (init.headers ?? {}) as Record<string, string>
      }
      if (typeof init.body === 'string') call.body = JSON.parse(init.body)
      calls.push(call)
      if (url.startsWith('https://db.test/upload/'))
        return new Response(null, { status: options.upload ?? 200 })
      if (call.method === 'POST')
        return Response.json({ ok: true }, { status: options.post ?? 200 })
      if (options.get) return Response.json({}, { status: options.get })
      if (url.endsWith('/api/internal/studio/previews')) {
        if (options.viewsGet)
          return Response.json({}, { status: options.viewsGet })
        return Response.json({ jobs: viewsLeft-- > 0 ? [view(++v)] : [] })
      }
      return Response.json({
        jobs:
          left-- > 0
            ? [
                {
                  ...job(++n, options.link),
                  ...(options.reference ? { reference: options.reference } : {})
                }
              ]
            : []
      })
    })
  )
  return calls
}
const picture = {
  image: Buffer.from('jpeg'),
  contentType: 'image/jpeg',
  width: 1200,
  height: 640
}
const quiet = () => {}
const none = { drawn: 0, failed: 0, lost: 0 }
/** The run's two lines: its sections, then its email views. */
const counts = (
  line: string,
  views = 'Email views drawn: 0. Failed: 0. Not recorded: 0.',
  grids = 'Grids read: 0. Reference grids read: 0 of 0.'
) => [[line], [views], [grids]]

describe('the section browser job (DST-001c)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    draw.renderSection.mockReset()
    draw.renderEmail.mockReset()
    grids.lumaGrid.mockReset().mockResolvedValue(null)
    grids.fetchCrop.mockReset().mockResolvedValue(new Uint8Array([1]))
  })

  it('draws each section, uploads it as a JPEG through its own link and reports its size, logging counts only', async () => {
    const calls = app({ jobs: 2 })
    draw.renderSection.mockResolvedValue(picture)
    const log = vi.fn()
    expect(await run({ base, secret, browser, log })).toEqual({
      drawn: 2,
      failed: 0,
      lost: 0,
      views: none
    })
    expect(draw.renderSection).toHaveBeenCalledWith(browser, {
      document: '<!doctype html><p>x</p>',
      height: 320,
      origins: ['https://cdn.shop.example']
    })
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ['GET', `${base}/api/internal/studio/renders`],
      ['PUT', 'https://db.test/upload/render/r1.jpg?token=u1'],
      ['POST', `${base}/api/internal/studio/renders`],
      ['GET', `${base}/api/internal/studio/renders`],
      ['PUT', 'https://db.test/upload/render/r2.jpg?token=u2'],
      ['POST', `${base}/api/internal/studio/renders`],
      ['GET', `${base}/api/internal/studio/renders`],
      ['GET', `${base}/api/internal/studio/previews`]
    ])
    expect(calls[2].body).toEqual({
      job: 'j1',
      lease: 'l1',
      height: 640,
      bytes: 4
    })
    // The picture itself, as a JPEG (the bucket takes nothing else), with no secret.
    expect(calls[1].headers).toEqual({
      'content-type': 'image/jpeg',
      'x-upsert': 'true'
    })
    expect(calls[1].raw).toBe(picture.image)
    expect(
      calls
        .filter((c) => c.headers.authorization)
        .every((c) => c.url.startsWith(base))
    ).toBe(true)
    expect(log.mock.calls).toEqual(
      counts('Sections drawn: 2. Failed: 0. Not recorded: 0.')
    )
  })

  it('reports why a section was not drawn, never claiming a refusal, and logs counts only', async () => {
    for (const [thrown, failure] of [
      ['timeout', 'timeout'],
      ['too_large', 'too_large'],
      ['navigated', 'navigated'],
      ['refused', 'failed'],
      ['something else', 'failed']
    ]) {
      const calls = app()
      draw.renderSection.mockRejectedValueOnce(new Error(thrown))
      const log = vi.fn()
      expect(await run({ base, secret, browser, log })).toEqual({
        drawn: 0,
        failed: 1,
        lost: 0,
        views: none
      })
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
        job: 'j1',
        lease: 'l1',
        failure
      })
      expect(log.mock.calls).toEqual(
        counts('Sections drawn: 0. Failed: 1. Not recorded: 0.')
      )
      vi.unstubAllGlobals()
    }
  })

  it('reports an upload that fails, and never uploads to a link that is not https', async () => {
    for (const options of [
      { upload: 403 },
      { link: 'http://db.test/upload/render/r1.jpg' }
    ]) {
      const calls = app(options)
      draw.renderSection.mockResolvedValue(picture)
      expect(await run({ base, secret, browser, log: quiet })).toEqual({
        drawn: 0,
        failed: 1,
        lost: 0,
        views: none
      })
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
        job: 'j1',
        lease: 'l1',
        failure: 'upload_failed'
      })
      expect(calls.some((c) => c.url.startsWith('http://'))).toBe(false)
      vi.unstubAllGlobals()
    }
  })

  it('counts a section whose report did not arrive as not recorded, never as drawn', async () => {
    app({ jobs: 2, post: 500 })
    draw.renderSection.mockResolvedValue(picture)
    const log = vi.fn()
    expect(await run({ base, secret, browser, log })).toEqual({
      drawn: 0,
      failed: 0,
      lost: 2,
      views: none
    })
    expect(log.mock.calls).toEqual(
      counts('Sections drawn: 0. Failed: 0. Not recorded: 2.')
    )
  })

  it('stops when the browser stops, without spending the waiting sections’ attempts', async () => {
    const calls = app({ jobs: 3 })
    let up = true
    const dying = { isConnected: () => up } as unknown as Browser
    draw.renderSection.mockImplementation(async () => {
      up = false
      throw new Error('failed')
    })
    const log = vi.fn()
    await expect(run({ base, secret, browser: dying, log })).rejects.toThrow(
      'The browser stopped.'
    )
    // The section being drawn is not reported (its lease brings it back);
    // no other is claimed.
    expect(calls.filter((c) => c.method === 'POST')).toEqual([])
    expect(calls.filter((c) => c.method === 'GET')).toHaveLength(1)
    expect(log.mock.calls).toEqual(
      counts('Sections drawn: 0. Failed: 0. Not recorded: 0.')
    )
  })

  it('stops when the app cannot hand out, after perRun sections, or when its time is up', async () => {
    app({ get: 500 })
    await expect(run({ base, secret, browser, log: quiet })).rejects.toThrow(
      'The app answered 500.'
    )
    vi.unstubAllGlobals()
    app({ jobs: perRun + 5 })
    draw.renderSection.mockResolvedValue(picture)
    expect((await run({ base, secret, browser, log: quiet })).drawn).toBe(
      perRun
    )
    vi.unstubAllGlobals()
    app({ jobs: 5 })
    let t = 0
    const now = () => (t += runBudgetMs / 4)
    expect(
      (await run({ base, secret, browser, log: quiet, now })).drawn
    ).toBeLessThan(5)
  })

  it('then draws the email’s views, uploads each through its own link and reports its height and cut (DST-005b)', async () => {
    const calls = app({ jobs: 1, views: 2 })
    draw.renderSection.mockResolvedValue(picture)
    draw.renderEmail
      .mockResolvedValueOnce({
        ...picture,
        width: 375,
        height: 2100,
        cut: false,
        wide: true
      })
      .mockRejectedValueOnce(new Error('too_large'))
    const log = vi.fn()
    expect(await run({ base, secret, browser, log })).toEqual({
      drawn: 1,
      failed: 0,
      lost: 0,
      views: { drawn: 1, failed: 1, lost: 0 }
    })
    expect(draw.renderEmail).toHaveBeenCalledWith(browser, {
      document: '<!doctype html><p>email</p>',
      view: 'phone',
      origins: ['https://cdn.shop.example']
    })
    const previews = `${base}/api/internal/studio/previews`
    expect(calls.slice(3).map((c) => [c.method, c.url])).toEqual([
      ['GET', `${base}/api/internal/studio/renders`],
      ['GET', previews],
      ['PUT', 'https://db.test/upload/email/e1.jpg?token=x1'],
      ['POST', previews],
      ['GET', previews],
      ['POST', previews],
      ['GET', previews]
    ])
    expect(
      calls
        .filter((c) => c.method === 'POST' && c.url === previews)
        .map((c) => c.body)
    ).toEqual([
      {
        job: 'v1',
        lease: 'w1',
        height: 2100,
        cut: false,
        wide: true,
        bytes: 4
      },
      { job: 'v2', lease: 'w2', failure: 'too_large' }
    ])
    expect(log.mock.calls).toEqual(
      counts(
        'Sections drawn: 1. Failed: 0. Not recorded: 0.',
        'Email views drawn: 1. Failed: 1. Not recorded: 0.'
      )
    )
  })

  it('reports a view whose upload fails, and stops when the browser dies drawing one', async () => {
    const calls = app({ jobs: 0, views: 1, upload: 403 })
    draw.renderEmail.mockResolvedValue({
      ...picture,
      height: 900,
      cut: false,
      wide: false
    })
    expect((await run({ base, secret, browser, log: quiet })).views).toEqual({
      drawn: 0,
      failed: 1,
      lost: 0
    })
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      job: 'v1',
      lease: 'w1',
      failure: 'upload_failed'
    })
    vi.unstubAllGlobals()
    const dyingCalls = app({ jobs: 0, views: 2 })
    let up = true
    const dying = { isConnected: () => up } as unknown as Browser
    draw.renderEmail.mockImplementation(async () => {
      up = false
      throw new Error('failed')
    })
    const log = vi.fn()
    await expect(run({ base, secret, browser: dying, log })).rejects.toThrow(
      'The browser stopped.'
    )
    expect(dyingCalls.filter((c) => c.method === 'POST')).toEqual([])
    expect(log.mock.calls).toEqual(
      counts('Sections drawn: 0. Failed: 0. Not recorded: 0.')
    )
  })

  it('logs both counts when the views cannot be handed out after the sections were drawn', async () => {
    app({ jobs: 1, viewsGet: 500 })
    draw.renderSection.mockResolvedValue(picture)
    const log = vi.fn()
    await expect(run({ base, secret, browser, log })).rejects.toThrow(
      'The app answered 500.'
    )
    expect(log.mock.calls).toEqual(
      counts('Sections drawn: 1. Failed: 0. Not recorded: 0.')
    )
  })

  it('imports both drawings from the real browser module', async () => {
    const real = await vi.importActual<typeof import('./section-render.mjs')>(
      './section-render.mjs'
    )
    expect(typeof real.renderSection).toBe('function')
    expect(typeof real.renderEmail).toBe('function')
  })

  it('counts sections and views together against perRun', async () => {
    app({ jobs: perRun - 1, views: 5 })
    draw.renderSection.mockResolvedValue(picture)
    draw.renderEmail.mockResolvedValue({
      ...picture,
      height: 900,
      cut: false,
      wide: false
    })
    const done = await run({ base, secret, browser, log: quiet })
    expect(done.drawn).toBe(perRun - 1)
    expect(done.views.drawn).toBe(1)
  })

  it('then carries on the designs waiting for their pictures, logging a count only (DST-006b)', async () => {
    for (const [answer, line, builds] of [
      [{ off: false, builds: 2, ran: 3 }, 'Designs carried on: 2.', 2],
      [{ off: true, builds: 0, ran: 0 }, 'Design studio off.', 0],
      [{ builds: 'many' }, 'Designs carried on: 0.', 0]
    ] as const) {
      const seen: { url: string; init: RequestInit }[] = []
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init: RequestInit) => {
          seen.push({ url, init })
          return Response.json(answer)
        })
      )
      const log = vi.fn()
      expect(await carryOn({ base, secret, log })).toBe(builds)
      expect(seen.map((c) => [c.init.method ?? 'GET', c.url])).toEqual([
        ['GET', `${base}/api/internal/studio/builds`]
      ])
      expect(seen[0].init).toMatchObject({
        redirect: 'error',
        headers: { authorization: `Bearer ${secret}` }
      })
      expect(log.mock.calls).toEqual([[line]])
      vi.unstubAllGlobals()
    }
    // The studio's job runs up to 2 minutes; an app error is the run's error.
    expect(carryOnMs).toBeGreaterThan(120_000)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({}, { status: 500 }))
    )
    await expect(carryOn({ base, secret, log: quiet })).rejects.toThrow(
      'The app answered 500.'
    )
  })

  it('reports the drawing’s grid and its reference crop’s, never printing the crop’s link (DST-004b2c)', async () => {
    const link = 'https://db.test/sign/inbox-assets/sect/x/1.jpg?token=SECRET'
    const calls = app({ jobs: 1, reference: link })
    draw.renderSection.mockResolvedValue(picture)
    const own = { width: 48, height: 26, values: [] as number[] }
    const theirs = { width: 48, height: 30, values: [] as number[] }
    grids.lumaGrid.mockResolvedValueOnce(own).mockResolvedValueOnce(theirs)
    grids.fetchCrop.mockResolvedValue(new Uint8Array([7]))
    const log = vi.fn()
    await run({ base, secret, browser, log })
    expect(grids.lumaGrid).toHaveBeenNthCalledWith(1, browser, picture.image)
    expect(grids.fetchCrop).toHaveBeenCalledWith(link)
    expect(grids.lumaGrid).toHaveBeenNthCalledWith(
      2,
      browser,
      new Uint8Array([7])
    )
    const report = calls.find((c) => c.method === 'POST')?.body
    expect(report).toEqual({
      job: 'j1',
      lease: 'l1',
      height: 640,
      bytes: 4,
      grid: own,
      referenceGrid: theirs
    })
    expect(JSON.stringify(log.mock.calls)).not.toContain('SECRET')
    // Counts only: both grids read, for the one section that asked.
    expect(log.mock.calls.at(-1)).toEqual([
      'Grids read: 1. Reference grids read: 1 of 1.'
    ])
  })

  it('leaves the crop out when the lease runs short after its own grid', async () => {
    const calls = app({ jobs: 1, reference: 'https://db.test/sign/x' })
    draw.renderSection.mockResolvedValue(picture)
    // Reading its own grid takes most of what is left of the lease.
    let t = 0
    grids.lumaGrid.mockImplementation(async () => {
      t += 80_000
      return { width: 1, height: 1, values: [3] }
    })
    const log = vi.fn()
    await run({ base, secret, browser, log, now: () => t })
    expect(grids.lumaGrid).toHaveBeenCalledTimes(1)
    expect(grids.fetchCrop).not.toHaveBeenCalled()
    expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({
      grid: { width: 1, height: 1, values: [3] }
    })
    expect(log.mock.calls.at(-1)).toEqual([
      'Grids read: 1. Reference grids read: 0 of 1.'
    ])
  })

  it('reports the picture with what grids it could read: none, or only its own', async () => {
    // The crop cannot be fetched: its own grid only.
    let calls = app({ jobs: 1, reference: 'https://db.test/sign/x' })
    draw.renderSection.mockResolvedValue(picture)
    const own = { width: 1, height: 1, values: [3] }
    grids.lumaGrid.mockResolvedValue(own)
    grids.fetchCrop.mockRejectedValue(new Error('reference_failed'))
    await run({ base, secret, browser, log: quiet })
    expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({
      grid: own
    })
    expect(calls.find((c) => c.method === 'POST')?.body).not.toHaveProperty(
      'referenceGrid'
    )
    // Its own picture cannot be read: no grids, the crop never fetched.
    grids.lumaGrid.mockReset().mockResolvedValue(null)
    grids.fetchCrop.mockReset()
    calls = app({ jobs: 1, reference: 'https://db.test/sign/x' })
    await run({ base, secret, browser, log: quiet })
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      job: 'j1',
      lease: 'l1',
      height: 640,
      bytes: 4
    })
    expect(grids.fetchCrop).not.toHaveBeenCalled()
  })

  it('leaves the grids out when the lease has too little time left for them', async () => {
    const calls = app({ jobs: 1, reference: 'https://db.test/sign/x' })
    draw.renderSection.mockResolvedValue(picture)
    grids.lumaGrid.mockResolvedValue({ width: 1, height: 1, values: [3] })
    // Each reading of the clock is a minute later: the lease is nearly gone.
    let t = 0
    const now = () => (t += 60_000)
    await run({ base, secret, browser, log: quiet, now })
    expect(grids.lumaGrid).not.toHaveBeenCalled()
    expect(calls.find((c) => c.method === 'POST')?.body).not.toHaveProperty(
      'grid'
    )
  })
})
