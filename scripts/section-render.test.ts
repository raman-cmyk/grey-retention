// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { Browser } from '@playwright/test'
import { maxBytes, renderSection } from './section-render.mjs'

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
    route?: (route: unknown) => unknown
    shot?: Record<string, unknown>
    closed: boolean
  } = { closed: false }
  const page = {
    route: async (_: string, handler: (route: unknown) => unknown) => {
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
/** What the route handler does with a request. */
async function routed(
  handler: (route: unknown) => unknown,
  url: string,
  navigation = false
) {
  let done = ''
  await handler({
    request: () => ({ url: () => url, isNavigationRequest: () => navigation }),
    continue: async () => {
      done = 'continue'
    },
    abort: async () => {
      done = 'abort'
    }
  })
  return done
}

describe('the designed-section browser (DST-001)', () => {
  it('draws at 600 CSS px and twice the pixels, with JavaScript off', async () => {
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
      type: 'png',
      clip: { x: 0, y: 0, width: 600, height: 300 }
    })
    expect(out).toEqual({
      png: Buffer.from([1, 2, 3]),
      width: 1200,
      height: 600
    })
    expect(seen.closed).toBe(true)
  })

  it('loads only from its origins and inline pictures, and never navigates', async () => {
    const { browser, seen } = fakeBrowser()
    await renderSection(browser, input)
    const handler = seen.route!
    expect(await routed(handler, 'https://cdn.shop.example/a.png')).toBe(
      'continue'
    )
    expect(await routed(handler, 'data:image/png;base64,AAAA')).toBe('continue')
    expect(await routed(handler, 'https://evil.example/a.png')).toBe('abort')
    expect(await routed(handler, 'not a link')).toBe('abort')
    expect(await routed(handler, 'https://cdn.shop.example/next', true)).toBe(
      'abort'
    )
  })

  it('stops for a page that navigated, timed out, failed, or a picture too large, and always closes', async () => {
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
      [{ screenshot: async () => Buffer.alloc(maxBytes + 1) }, 'too_large']
    ]
    for (const [over, reason] of cases) {
      const { browser, seen } = fakeBrowser(over)
      await expect(renderSection(browser, input)).rejects.toThrow(reason)
      expect(seen.closed).toBe(true)
    }
  })
})
