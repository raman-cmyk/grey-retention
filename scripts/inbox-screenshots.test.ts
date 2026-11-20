// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Browser } from '@playwright/test'
import {
  allowedOrigins,
  prepareHtml,
  render,
  run
} from './inbox-screenshots.mjs'

const job = {
  job: 'j1',
  lease: 'l1',
  html: 'https://db.test/sign/inbox-raw/x.html?token=t',
  images: [
    {
      ref: 'https://cdn.shop.test/a.png?x=1&amp;y=2',
      url: 'https://db.test/sign/a?token=1'
    },
    {
      ref: 'https://cdn.shop.test/a.png',
      url: 'https://db.test/sign/b?token=2'
    }
  ],
  upload: 'https://db.test/upload/shot/x.jpg?token=u'
}

describe('the screenshot browser', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('puts each stored image in place of its reference, the longest first', () => {
    const html =
      '<img src="https://cdn.shop.test/a.png?x=1&amp;y=2"><img src="https://cdn.shop.test/a.png">'
    expect(prepareHtml(html, job.images)).toBe(
      '<img src="https://db.test/sign/a?token=1"><img src="https://db.test/sign/b?token=2">'
    )
  })

  it('makes every link, meta and base inert, however it is written (INB-002b review)', () => {
    expect(
      prepareHtml(
        '<head><META HTTP-EQUIV="Refresh" content="0;url=https://elsewhere.test"><meta charset="utf-8"><base href="https://x.test/"></head>',
        []
      )
    ).toBe(
      '<head><gr-meta HTTP-EQUIV="Refresh" content="0;url=https://elsewhere.test"><gr-meta charset="utf-8"><gr-base href="https://x.test/"></head>'
    )
    for (const tag of [
      '<link rel="prefetch" href="https://x.test/p">',
      '<link rel=stylesheet href=https://x.test/s.css>',
      // A "<" inside an attribute kept these past a whole-tag pattern.
      '<link rel=prefetch href="https://x.test/pf?<">',
      '<LINK\nrel=prefetch\ntitle="<"\nhref=https://x.test/p>',
      '<svg><foreignObject><link rel="prefetch" href="https://x.test/s?<"></foreignObject></svg>',
      '<link/rel=prefetch href=https://x.test/p>'
    ])
      expect(prepareHtml(tag, [])).not.toMatch(/<link\b/i)
    // Only those three tags: <linkx>, <metadata> and text are left alone.
    expect(prepareHtml('<metadata></metadata><p>link meta base</p>', [])).toBe(
      '<metadata></metadata><p>link meta base</p>'
    )
  })

  it('may load only from the job’s own signed links', () => {
    expect([...allowedOrigins(job)]).toEqual(['https://db.test'])
  })

  it('stops cropping sections once the time is up, so the report is never late', async () => {
    const page = {
      route: async () => {},
      setContent: async () => {},
      url: () => 'about:blank',
      context: () => ({
        newCDPSession: async () => ({
          send: async () => ({ cssContentSize: { width: 600, height: 900 } }),
          detach: async () => {}
        })
      }),
      screenshot: vi.fn(async () => Buffer.from([0xff, 0xd8, 0xff])),
      locator: vi.fn(() => ({
        all: async () => [
          { boundingBox: async () => ({ x: 0, y: 0, width: 600, height: 120 }) }
        ]
      }))
    }
    const browser = {
      newContext: async () => ({
        newPage: async () => page,
        close: async () => {}
      })
    } as unknown as Browser
    const sectioned = { ...job, sections: [{ ordinal: 1, upload: 'u' }] }
    const late = await render(browser, sectioned, '<p>x</p>', Date.now() - 1)
    expect(late.sections).toEqual([])
    expect(page.locator).not.toHaveBeenCalled()
    const inTime = await render(
      browser,
      sectioned,
      '<p>x</p>',
      Date.now() + 60_000
    )
    expect(inTime.sections).toMatchObject([{ ordinal: 1, top: 0, height: 120 }])
  })

  it('renders, uploads and reports each job, and prints counts only', async () => {
    const calls: { url: string; method: string; body?: string }[] = []
    let handedOut = false
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (url: string, init: { method?: string; body?: string } = {}) => {
          calls.push({
            url,
            method: init.method ?? 'GET',
            body: typeof init.body === 'string' ? init.body : undefined
          })
          if (url.endsWith('/api/internal/inbox/screenshots') && !init.method) {
            const jobs = handedOut ? [] : [job, { ...job, job: 'j2' }]
            handedOut = true
            return new Response(JSON.stringify({ jobs }))
          }
          if (url === job.html) return new Response('<p>Hello</p>')
          if (url === job.upload) return new Response(null, { status: 200 })
          return new Response(JSON.stringify({ ok: true }))
        }
      )
    )
    const shot = {
      image: Buffer.from([0xff, 0xd8, 0xff]),
      width: 600,
      height: 900
    }
    let renders = 0
    const browser = {
      newContext: async () => ({
        newPage: async () => ({
          route: async () => {},
          setContent: async () => {
            if (++renders === 2) throw new Error('crash')
          },
          url: () => 'about:blank',
          context: () => ({
            newCDPSession: async () => ({
              send: async () => ({
                cssContentSize: { width: 600, height: 900 }
              }),
              detach: async () => {}
            })
          }),
          screenshot: async () => shot.image
        }),
        close: async () => {}
      })
    }
    const log = vi.fn()
    const counts = await run({
      base: 'https://app.test',
      secret: 's'.repeat(40),
      browser: browser as unknown as Browser,
      log
    })
    expect(counts).toEqual({ taken: 1, failed: 1, unloaded: 0 })
    const reports = calls
      .filter((c) => c.method === 'POST')
      .map((c) => JSON.parse(c.body!))
    expect(reports).toEqual([
      { job: 'j1', lease: 'l1', width: 600, height: 900, boxes: [] },
      { job: 'j2', lease: 'l1', failure: 'render_failed' }
    ])
    expect(calls.filter((c) => c.method === 'PUT').map((c) => c.url)).toEqual([
      job.upload
    ])
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/token|db\.test|sss/)
    // Counts only, the job's own refused or failed loads among them.
    expect(log).toHaveBeenCalledWith(
      'Screenshots taken: 1. Failed: 1. Stored pictures or styles refused or failed: 0.'
    )
  })

  // INB-002b: the same guard as the designed-section browser (DST-001).
  it('takes only https links (and loopback for tests) as the job’s own origins', () => {
    expect([
      ...allowedOrigins({
        html: 'http://db.test/sign/x.html?token=t',
        images: [
          { ref: 'a', url: 'https://db.test/sign/a?token=1' },
          { ref: 'b', url: 'http://127.0.0.1:54321/sign/b?token=2' }
        ]
      })
    ]).toEqual(['https://db.test', 'http://127.0.0.1:54321'])
  })

  it('never follows a redirect: an allowed link that redirects is refused, wherever it points', async () => {
    type Handler = (route: unknown) => Promise<unknown>
    let handler: Handler | undefined
    const page = {
      route: async (_: string, h: Handler) => {
        handler = h
      },
      setContent: async () => {},
      url: () => 'about:blank',
      context: () => ({
        newCDPSession: async () => ({
          send: async () => ({ cssContentSize: { width: 600, height: 900 } }),
          detach: async () => {}
        })
      }),
      screenshot: async () => Buffer.from([0xff, 0xd8, 0xff])
    }
    const browser = {
      newContext: async () => ({
        newPage: async () => page,
        close: async () => {}
      })
    } as unknown as Browser
    await render(browser, job, '<p>x</p>')
    const routed = async (
      url: string,
      { status = 200, fails = false, navigation = false } = {}
    ) => {
      let done = ''
      let fulfilled: unknown
      const fetch = vi.fn(async () => {
        if (fails) throw new Error('net::ERR_FAILED')
        return { status: () => status }
      })
      await handler!({
        request: () => ({
          url: () => url,
          isNavigationRequest: () => navigation
        }),
        continue: async () => {
          done = 'continue'
        },
        abort: async () => {
          done = 'abort'
        },
        fetch,
        fulfill: async (options: unknown) => {
          done = 'fulfill'
          fulfilled = options
        }
      })
      return { done, fetch, fulfilled }
    }
    const own = await routed('https://db.test/sign/a?token=1')
    expect(own.done).toBe('fulfill')
    // The browser gets the answer fetched here, never one it fetched itself.
    expect(own.fulfilled).toEqual({
      response: await own.fetch.mock.results[0]!.value
    })
    expect(own.fetch).toHaveBeenCalledWith({
      maxRedirects: 0,
      timeout: 20_000
    })
    // To another host, a private address or the next link of a chain: the
    // browser is never told where, the answer is refused.
    for (const status of [301, 302, 303, 307, 308])
      expect((await routed('https://db.test/sign/r', { status })).done).toBe(
        'abort'
      )
    expect((await routed('https://db.test/sign/x', { fails: true })).done).toBe(
      'abort'
    )
    expect((await routed('data:image/png;base64,AAAA')).done).toBe('continue')
    for (const url of [
      'https://cdn.shop.test/a.png',
      'http://169.254.169.254/latest/meta-data',
      'http://10.0.0.1/a.png',
      'http://db.test/sign/a',
      'not a link'
    ])
      expect((await routed(url)).done).toBe('abort')
    expect(
      (await routed('https://db.test/sign/next', { navigation: true })).done
    ).toBe('abort')
  })

  it('fetches the email and sends each upload without following a redirect', async () => {
    const sectioned = {
      ...job,
      sections: [{ ordinal: 1, upload: 'https://db.test/upload/s1.jpg' }]
    }
    const moved = { ...job, job: 'j2', html: 'https://db.test/moved.html' }
    const inits: Record<string, RequestInit | undefined> = {}
    const reports: unknown[] = []
    let handedOut = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith('/api/internal/inbox/screenshots')) {
          if (init?.method === 'POST') {
            reports.push(JSON.parse(String(init.body)))
            return new Response(JSON.stringify({ ok: true }))
          }
          const jobs = handedOut ? [] : [sectioned, moved]
          handedOut = true
          return new Response(JSON.stringify({ jobs }))
        }
        inits[`${init?.method ?? 'GET'} ${url}`] = init
        // A stored email that redirects: fetch refuses it (redirect: error).
        if (url === moved.html)
          throw new TypeError('fetch failed: unexpected redirect')
        if (url === job.html) return new Response('<p>Hello</p>')
        return new Response(null, { status: 200 })
      })
    )
    const page = {
      route: async () => {},
      setContent: async () => {},
      url: () => 'about:blank',
      context: () => ({
        newCDPSession: async () => ({
          send: async () => ({ cssContentSize: { width: 600, height: 900 } }),
          detach: async () => {}
        })
      }),
      screenshot: async () => Buffer.from([0xff, 0xd8, 0xff]),
      locator: () => ({
        all: async () => [
          { boundingBox: async () => ({ x: 0, y: 0, width: 600, height: 120 }) }
        ]
      })
    }
    const browser = {
      newContext: async () => ({
        newPage: async () => page,
        close: async () => {}
      })
    } as unknown as Browser
    const counts = await run({
      base: 'https://app.test',
      secret: 's'.repeat(40),
      browser,
      log: () => {}
    })
    expect(counts).toEqual({ taken: 1, failed: 1, unloaded: 0 })
    for (const key of [
      `GET ${job.html}`,
      `PUT ${job.upload}`,
      'PUT https://db.test/upload/s1.jpg',
      `GET ${moved.html}`
    ])
      expect(inits[key]).toMatchObject({ redirect: 'error' })
    expect(reports).toEqual([
      {
        job: 'j1',
        lease: 'l1',
        width: 600,
        height: 900,
        boxes: [{ ordinal: 1, top: 0, height: 120 }]
      },
      { job: 'j2', lease: 'l1', failure: 'html_unreadable' }
    ])
  })
})
