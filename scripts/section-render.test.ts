// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { Browser } from '@playwright/test'
import { loadableOrigins, maxBytes, renderSection } from './section-render.mjs'

/** A fake browser that records what the renderer asks of it. */
function fakeBrowser(
  over: {
    setContent?: () => Promise<void>
    screenshot?: () => Promise<Buffer>
    url?: string
  } = {}
) {
  const seen: {
    context?: Record<string, unknown>
    route?: (route: unknown) => Promise<unknown>
    shot?: Record<string, unknown>
    closed: boolean
  } = { closed: false }
  const page = {
    route: async (_: string, handler: (route: unknown) => Promise<unknown>) => {
      seen.route = handler
    },
    setContent: vi.fn(over.setContent ?? (async () => {})),
    url: () => over.url ?? 'about:blank',
    screenshot: vi.fn(
      over.screenshot ??
        (async (opts: Record<string, unknown>) => {
          seen.shot = opts
          return Buffer.from([1, 2, 3])
        })
    )
  }
  const browser = {
    newContext: async (opts: Record<string, unknown>) => {
      seen.context = opts
      return {
        newPage: async () => page,
        close: async () => {
          seen.closed = true
        }
      }
    }
  } as unknown as Browser
  return { browser, page, seen }
}
const input = {
  document: '<!doctype html><p>Hi</p>',
  height: 300,
  origins: ['https://cdn.shop.example']
}
/** What the route handler does with a request whose answer is `status`. */
async function routed(
  handler: (route: unknown) => Promise<unknown>,
  url: string,
  { navigation = false, status = 200, fails = false } = {}
) {
  let done = ''
  const fetch = vi.fn(async () => {
    if (fails) throw new Error('net::ERR')
    return { status: () => status }
  })
  await handler({
    request: () => ({ url: () => url, isNavigationRequest: () => navigation }),
    continue: async () => {
      done = 'continue'
    },
    abort: async () => {
      done = 'abort'
    },
    fetch,
    fulfill: async () => {
      done = 'fulfill'
    }
  })
  return { done, fetch }
}

describe('the designed-section browser (DST-001)', () => {
  it('draws at 600 CSS px and twice the pixels, with JavaScript off, as a JPEG', async () => {
    const { browser, page, seen } = fakeBrowser()
    const out = await renderSection(browser, input)
    expect(seen.context).toMatchObject({
      viewport: { width: 600, height: 300 },
      deviceScaleFactor: 2,
      javaScriptEnabled: false,
      serviceWorkers: 'block'
    })
    expect(page.setContent).toHaveBeenCalledWith(input.document, {
      waitUntil: 'load',
      timeout: 20_000
    })
    expect(seen.shot).toMatchObject({
      type: 'jpeg',
      quality: 85,
      clip: { x: 0, y: 0, width: 600, height: 300 }
    })
    expect(out).toEqual({
      image: Buffer.from([1, 2, 3]),
      contentType: 'image/jpeg',
      width: 1200,
      height: 600
    })
    expect(seen.closed).toBe(true)
  })

  it('loads only from its origins and inline pictures, never follows a redirect, never navigates', async () => {
    const { browser, seen } = fakeBrowser()
    await renderSection(browser, input)
    const handler = seen.route!
    const own = await routed(handler, 'https://cdn.shop.example/a.png')
    expect(own.done).toBe('fulfill')
    expect(own.fetch).toHaveBeenCalledWith({ maxRedirects: 0, timeout: 20_000 })
    for (const status of [301, 302, 307, 308])
      expect(
        (await routed(handler, 'https://cdn.shop.example/r', { status })).done
      ).toBe('abort')
    expect(
      (await routed(handler, 'https://cdn.shop.example/x', { fails: true }))
        .done
    ).toBe('abort')
    expect((await routed(handler, 'data:image/png;base64,AAAA')).done).toBe(
      'continue'
    )
    expect((await routed(handler, 'https://evil.example/a.png')).done).toBe(
      'abort'
    )
    expect((await routed(handler, 'not a link')).done).toBe('abort')
    expect(
      (
        await routed(handler, 'https://cdn.shop.example/next', {
          navigation: true
        })
      ).done
    ).toBe('abort')
  })

  it('takes only https origins (and loopback for tests), never an opaque one', () => {
    expect([
      ...loadableOrigins([
        'https://cdn.shop.example',
        'null',
        'http://cdn.shop.example',
        'file://',
        'http://127.0.0.1:4100',
        'https://cdn.shop.example/path'
      ])
    ]).toEqual(['https://cdn.shop.example', 'http://127.0.0.1:4100'])
  })

  it('stops for a bad height, a page that navigated, timed out or failed, a picture too large, and always closes', async () => {
    const cases: [Parameters<typeof fakeBrowser>[0], string][] = [
      [{ url: 'https://evil.example/' }, 'navigated'],
      [
        {
          setContent: async () => {
            throw new Error('Timeout 20000ms exceeded.')
          }
        },
        'timeout'
      ],
      [
        {
          setContent: async () => {
            throw new Error('net::ERR_FAILED')
          }
        },
        'failed'
      ],
      [
        {
          screenshot: async () => {
            throw new Error('Timeout 20000ms exceeded.')
          }
        },
        'timeout'
      ],
      [{ screenshot: async () => Buffer.alloc(maxBytes + 1) }, 'too_large']
    ]
    for (const [over, reason] of cases) {
      const { browser, seen } = fakeBrowser(over)
      await expect(renderSection(browser, input)).rejects.toThrow(reason)
      expect(seen.closed).toBe(true)
    }
    const { browser } = fakeBrowser()
    await expect(
      renderSection(browser, { ...input, height: 2000 })
    ).rejects.toThrow('failed')
  })
})
