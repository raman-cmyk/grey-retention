// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { Browser } from '@playwright/test'
import {
  emailWindow,
  loadableOrigins,
  maxBytes,
  maxEmailBytes,
  maxEmailHeight,
  renderEmail,
  renderSection
} from './section-render.mjs'

/** A fake browser that records what the renderer asks of it. */
function fakeBrowser(
  over: {
    setContent?: () => Promise<void>
    screenshot?: () => Promise<Buffer>
    url?: string
    /** What the browser measures (DST-005b), or a failure to. */
    layout?: { width: number; height: number } | 'throw'
    /** The email frame's left and right edges (DST-007); none: no frame. */
    frame?: [number, number]
    close?: () => Promise<void>
  } = {}
) {
  const seen: {
    context?: Record<string, unknown>
    route?: (route: unknown) => Promise<unknown>
    shot?: Record<string, unknown>
    closed: boolean
    detached?: boolean
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
        newCDPSession: async () => ({
          send: async (method: string) => {
            if (over.layout === 'throw') throw new Error('Protocol error')
            if (method === 'DOM.getDocument') return { root: { nodeId: 1 } }
            if (method === 'DOM.querySelector')
              return { nodeId: over.frame ? 2 : 0 }
            if (method === 'DOM.getBoxModel' && over.frame) {
              const [l, r] = over.frame
              return { model: { border: [l, 0, r, 0, r, 400, l, 400] } }
            }
            if (method !== 'Page.getLayoutMetrics')
              throw new Error('Protocol error')
            return {
              cssContentSize: {
                x: 0,
                y: 0,
                ...(over.layout ?? { width: 600, height: 1200 })
              }
            }
          },
          detach: async () => {
            seen.detached = true
          }
        }),
        close: async () => {
          seen.closed = true
          await over.close?.()
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

describe('the whole-email browser (DST-005b)', () => {
  const email = {
    document: '<!doctype html><p>Hi</p>',
    origins: ['https://cdn.shop.example']
  }

  it('draws each view as a plain page in its window, JavaScript off, one pixel a CSS px, in its colour scheme', async () => {
    // Desktop and dark: a 700 px window, wider than the email's phone
    // layout (under 620), and the email's 600 px from its middle (DST-007).
    for (const [view, width, window, colorScheme] of [
      ['desktop', 600, 700, 'light'],
      ['phone', 375, 375, 'light'],
      ['dark', 600, 700, 'dark']
    ] as const) {
      const { browser, page, seen } = fakeBrowser({
        layout: { width: window, height: 1200 }
      })
      const out = await renderEmail(browser, { ...email, view })
      expect(seen.context).toMatchObject({
        viewport: { width: window, height: emailWindow },
        deviceScaleFactor: 1,
        isMobile: false,
        hasTouch: false,
        colorScheme,
        javaScriptEnabled: false,
        serviceWorkers: 'block'
      })
      expect(page.setContent).toHaveBeenCalledWith(email.document, {
        waitUntil: 'load',
        timeout: 30_000
      })
      expect(seen.shot).toMatchObject({
        type: 'jpeg',
        quality: 85,
        fullPage: true,
        clip: { x: (window - width) / 2, y: 0, width, height: 1200 }
      })
      expect(out).toEqual({
        image: Buffer.from([1, 2, 3]),
        contentType: 'image/jpeg',
        width,
        height: 1200,
        cut: false,
        wide: false
      })
      expect(seen.detached).toBe(true)
      expect(seen.closed).toBe(true)
    }
  })

  it('cuts an email taller than the limit and says it is wider than its window, as the browser measures them', async () => {
    // Wider than the email but inside the desktop window: not wide.
    expect(
      await renderEmail(
        fakeBrowser({ layout: { width: 700, height: 900 } }).browser,
        {
          ...email,
          view: 'desktop'
        }
      )
    ).toMatchObject({ width: 600, wide: false })
    // The email's frame inside the 600 px drawn, or grown past them by
    // what is in it (cut by the picture): wide.
    for (const [frame, wide] of [
      [[50, 650], false],
      [[49.6, 650.4], false],
      [[10, 690], true],
      [[50, 652], true]
    ] as [[number, number], boolean][])
      expect(
        await renderEmail(
          fakeBrowser({ layout: { width: 700, height: 900 }, frame }).browser,
          { ...email, view: 'desktop' }
        ),
        JSON.stringify(frame)
      ).toMatchObject({ wide })
    expect(
      await renderEmail(
        fakeBrowser({ layout: { width: 375, height: 900 }, frame: [0, 375] })
          .browser,
        { ...email, view: 'phone' }
      )
    ).toMatchObject({ wide: false })
    const { browser, seen } = fakeBrowser({
      layout: { width: 700.4, height: 7000 }
    })
    expect(
      await renderEmail(browser, { ...email, view: 'desktop' })
    ).toMatchObject({
      width: 600,
      height: maxEmailHeight,
      cut: true,
      wide: true
    })
    expect(seen.shot).toMatchObject({
      clip: { x: 50, y: 0, width: 600, height: maxEmailHeight }
    })
  })

  it('refuses an unknown view, and a page that would reach out past the guard, before opening anything', async () => {
    for (const view of ['tablet', 'toString', '__proto__', 'constructor', 7]) {
      const { browser, seen } = fakeBrowser()
      await expect(
        renderEmail(browser, { ...email, view: view as 'desktop' })
      ).rejects.toThrow('failed')
      expect(seen.context).toBeUndefined()
    }
    for (const document of [
      '<link rel="prefetch" href="https://evil.example/x">',
      '<LINK/rel=dns-prefetch href=//evil.example>',
      '<meta http-equiv="&#114;efresh" content="0;url=https://evil.example">',
      '<iframe src="https://evil.example"></iframe>',
      '<p srcdoc="x">',
      '<object data="https://evil.example/x"></object>',
      '<embed src="https://evil.example/x">'
    ]) {
      const { browser, seen } = fakeBrowser()
      await expect(
        renderEmail(browser, { ...email, document, view: 'desktop' })
      ).rejects.toThrow('navigated')
      expect(seen.context).toBeUndefined()
    }
  })

  it('stops for a page that navigated, timed out, failed, measured empty or a picture too large, and always closes', async () => {
    const cases: [Parameters<typeof fakeBrowser>[0], string][] = [
      [{ url: 'https://evil.example/' }, 'navigated'],
      [
        {
          setContent: async () => {
            throw new Error('Timeout 30000ms exceeded.')
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
      [{ layout: 'throw' }, 'failed'],
      [{ layout: { width: 600, height: emailWindow } }, 'failed'],
      [{ layout: { width: 600, height: Number.NaN } }, 'failed'],
      [
        {
          screenshot: async () => {
            throw new Error('Timeout 30000ms exceeded.')
          }
        },
        'timeout'
      ],
      [
        { screenshot: async () => Buffer.alloc(maxEmailBytes + 1) },
        'too_large'
      ],
      // A browser that died while closing keeps the real reason.
      [
        {
          url: 'https://evil.example/',
          close: async () => {
            throw new Error('Target closed')
          }
        },
        'navigated'
      ]
    ]
    for (const [over, reason] of cases) {
      const { browser, seen } = fakeBrowser(over)
      await expect(
        renderEmail(browser, { ...email, view: 'phone' })
      ).rejects.toThrow(reason)
      expect(seen.closed).toBe(true)
    }
  })
})
