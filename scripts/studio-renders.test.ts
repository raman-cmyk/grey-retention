// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Browser } from '@playwright/test'

const draw = vi.hoisted(() => ({ renderSection: vi.fn() }))
vi.mock('./section-render.mjs', () => draw)
import { perRun, run, runBudgetMs } from './studio-renders.mjs'

const secret = 's'.repeat(40)
const base = 'https://app.test'
const browser = {} as Browser
const job = (n: number) => ({
  job: `j${n}`,
  lease: `l${n}`,
  render: `r${n}`,
  document: '<!doctype html><p>x</p>',
  height: 320,
  origins: ['https://cdn.shop.example'],
  upload: `https://db.test/upload/render/r${n}.jpg?token=u${n}`
})

type Call = { url: string; method: string; body?: unknown; auth?: string }
/** The app hands out `jobs` one per call, then none; uploads answer `upload`. */
function app(
  options: { jobs?: number; upload?: number; post?: number; get?: number } = {}
) {
  let left = options.jobs ?? 1
  let n = 0
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const headers = (init.headers ?? {}) as Record<string, string>
      const call: Call = {
        url,
        method: init.method ?? 'GET',
        auth: headers.authorization
      }
      if (typeof init.body === 'string') call.body = JSON.parse(init.body)
      calls.push(call)
      if (url.startsWith('https://db.test/upload/'))
        return new Response(null, { status: options.upload ?? 200 })
      if (call.method === 'POST')
        return Response.json({ ok: true }, { status: options.post ?? 200 })
      if (options.get) return Response.json({}, { status: options.get })
      return Response.json({ jobs: left-- > 0 ? [job(++n)] : [] })
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

describe('the section browser job (DST-001c)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    draw.renderSection.mockReset()
  })

  it('draws each section, uploads it through its own link and reports its size, logging counts only', async () => {
    const calls = app({ jobs: 2 })
    draw.renderSection.mockResolvedValue(picture)
    const log = vi.fn()
    expect(await run({ base, secret, browser, log })).toEqual({
      drawn: 2,
      failed: 0
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
      ['GET', `${base}/api/internal/studio/renders`]
    ])
    expect(calls[2].body).toEqual({
      job: 'j1',
      lease: 'l1',
      height: 640,
      bytes: 4
    })
    // The secret goes to the app only, never to the upload link.
    expect(
      calls.filter((c) => c.auth).every((c) => c.url.startsWith(base))
    ).toBe(true)
    expect(log.mock.calls).toEqual([['Sections drawn: 2. Failed: 0.']])
  })

  it('reports why a section was not drawn, never claiming a refusal', async () => {
    for (const [thrown, failure] of [
      ['timeout', 'timeout'],
      ['too_large', 'too_large'],
      ['navigated', 'navigated'],
      ['refused', 'failed'],
      ['something else', 'failed']
    ]) {
      const calls = app()
      draw.renderSection.mockRejectedValueOnce(new Error(thrown))
      expect(await run({ base, secret, browser, log: () => {} })).toEqual({
        drawn: 0,
        failed: 1
      })
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
        job: 'j1',
        lease: 'l1',
        failure
      })
      vi.unstubAllGlobals()
    }
  })

  it('reports an upload that fails, and goes on when a report does not arrive', async () => {
    const calls = app({ jobs: 2, upload: 403, post: 500 })
    draw.renderSection.mockResolvedValue(picture)
    expect(await run({ base, secret, browser, log: () => {} })).toEqual({
      drawn: 0,
      failed: 2
    })
    expect(
      calls
        .filter((c) => c.method === 'POST')
        .map((c) => (c.body as { failure: string }).failure)
    ).toEqual(['upload_failed', 'upload_failed'])
  })

  it('stops when the app cannot hand out, after perRun sections, or when its time is up', async () => {
    app({ get: 500 })
    await expect(run({ base, secret, browser, log: () => {} })).rejects.toThrow(
      'The app answered 500.'
    )
    vi.unstubAllGlobals()
    app({ jobs: perRun + 5 })
    draw.renderSection.mockResolvedValue(picture)
    expect((await run({ base, secret, browser, log: () => {} })).drawn).toBe(
      perRun
    )
    vi.unstubAllGlobals()
    app({ jobs: 5 })
    let t = 0
    const now = () => (t += runBudgetMs / 2)
    expect(
      (await run({ base, secret, browser, log: () => {}, now })).drawn
    ).toBe(1)
  })
})
