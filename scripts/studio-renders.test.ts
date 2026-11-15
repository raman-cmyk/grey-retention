// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Browser } from '@playwright/test'

const draw = vi.hoisted(() => ({ renderSection: vi.fn() }))
vi.mock('./section-render.mjs', () => draw)
import { perRun, run, runBudgetMs } from './studio-renders.mjs'

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
/** The app hands out `jobs` one per call, then none; uploads answer `upload`. */
function app(
  options: {
    jobs?: number
    upload?: number
    post?: number
    get?: number
    link?: string
  } = {}
) {
  let left = options.jobs ?? 1
  let n = 0
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
      return Response.json({
        jobs: left-- > 0 ? [job(++n, options.link)] : []
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
const counts = (line: string) => [[line]]

describe('the section browser job (DST-001c)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    draw.renderSection.mockReset()
  })

  it('draws each section, uploads it as a JPEG through its own link and reports its size, logging counts only', async () => {
    const calls = app({ jobs: 2 })
    draw.renderSection.mockResolvedValue(picture)
    const log = vi.fn()
    expect(await run({ base, secret, browser, log })).toEqual({
      drawn: 2,
      failed: 0,
      lost: 0
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
        lost: 0
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
        lost: 0
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
      lost: 2
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
})
