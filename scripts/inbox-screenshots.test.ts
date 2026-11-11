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

  it('removes meta refresh, which would navigate away after loading', () => {
    expect(
      prepareHtml(
        '<head><META HTTP-EQUIV="Refresh" content="0;url=https://elsewhere.test"><meta charset="utf-8"></head>',
        []
      )
    ).toBe('<head><meta charset="utf-8"></head>')
    expect(
      prepareHtml(
        '<link rel="prefetch" href="https://x.test/p"><link rel=stylesheet href=https://x.test/s.css><p>Hi</p>',
        []
      )
    ).toBe('<p>Hi</p>')
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
    expect(counts).toEqual({ taken: 1, failed: 1 })
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
  })
})
