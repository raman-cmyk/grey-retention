// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Browser } from '@playwright/test'
import { gridBudget as scoreBudget, gridProblem } from '@/features/studio/match'
import {
  averageGrid,
  cropMs,
  fetchCrop,
  gridBudget,
  lumaGrid,
  maxCropBytes
} from './luma-grid.mjs'

/** An RGBA picture painted by `f(x, y)` → [r, g, b]. */
const rgba = (
  w: number,
  h: number,
  f: (x: number, y: number) => [number, number, number]
) => {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = f(x, y)
      data.set([r, g, b, 255], (y * w + x) * 4)
    }
  return data
}

describe('the grids the browser job makes (DST-004b2c)', () => {
  it('keeps the score’s own budget', () => {
    expect(gridBudget).toEqual(scoreBudget)
  })

  it('averages the brightness of each cell’s pixels, as whole grey levels', () => {
    // Left half black, right half white, 4 × 2 into 2 × 1 at most... the
    // picture's proportions: 2 columns, 1 row.
    const grid = averageGrid(
      rgba(4, 2, (x) => (x < 2 ? [0, 0, 0] : [255, 255, 255])),
      4,
      2,
      { columns: 2, rows: 128 }
    )
    expect(grid).toEqual({ width: 2, height: 1, values: [0, 255] })
    // Brightness weights the colours: pure red, green and blue.
    const colours = averageGrid(
      rgba(3, 1, (x) =>
        x === 0 ? [255, 0, 0] : x === 1 ? [0, 255, 0] : [0, 0, 255]
      ),
      3,
      1,
      { columns: 3, rows: 1 }
    )
    expect(colours.values).toEqual([76, 150, 29])
    // A mean between two levels is rounded to a whole one.
    const half = averageGrid(
      rgba(2, 1, (x) => (x ? [101, 101, 101] : [100, 100, 100])),
      2,
      1,
      { columns: 1, rows: 1 }
    )
    expect(half.values).toEqual([101])
  })

  it('keeps the picture’s proportions within the budget; a taller one is made shorter', () => {
    const drawn = averageGrid(
      rgba(1200, 1280, () => [200, 200, 200]),
      1200,
      1280,
      gridBudget
    )
    expect([drawn.width, drawn.height]).toEqual([48, 51])
    const tall = averageGrid(
      rgba(600, 4000, () => [9, 9, 9]),
      600,
      4000,
      gridBudget
    )
    expect([tall.width, tall.height]).toEqual([48, 128])
    const tiny = averageGrid(
      rgba(1, 1, () => [7, 7, 7]),
      1,
      1,
      gridBudget
    )
    expect(tiny).toEqual({ width: 1, height: 1, values: [7] })
    for (const g of [drawn, tall, tiny]) expect(gridProblem(g)).toBeNull()
  })

  it('works as a function of its own, as the page runs it', () => {
    const copy = new Function(`return (${averageGrid.toString()})`)()
    const picture = rgba(10, 4, (x, y) => [x * 20, y * 40, 0])
    expect(copy(picture, 10, 4, gridBudget)).toEqual(
      averageGrid(picture, 10, 4, gridBudget)
    )
  })
})

/** A fake browser: one context, one page, `evaluate` answering `answer`. */
function fakeBrowser(answer: () => Promise<unknown>) {
  const seen: {
    route?: (route: { abort: () => Promise<void> }) => Promise<void>
    args?: unknown
    closed: boolean
    options?: unknown
  } = { closed: false }
  const page = {
    route: async (
      _: string,
      handler: (route: { abort: () => Promise<void> }) => Promise<void>
    ) => {
      seen.route = handler
    },
    setDefaultTimeout: () => {},
    evaluate: vi.fn(async (_fn: unknown, args: unknown) => {
      seen.args = args
      return answer()
    })
  }
  const browser = {
    newContext: async (options: unknown) => {
      seen.options = options
      return {
        newPage: async () => page,
        close: async () => {
          seen.closed = true
        }
      }
    }
  }
  return { browser: browser as unknown as Browser, seen }
}

describe('reading a picture in its own page', () => {
  const grid = { width: 2, height: 1, values: [10, 20] }

  it('decodes the picture as data, with every request refused, and closes its page', async () => {
    const { browser, seen } = fakeBrowser(async () => grid)
    expect(await lumaGrid(browser, new Uint8Array([1, 2, 3]))).toEqual(grid)
    const [source, base64, budget] = seen.args as [string, string, unknown]
    expect(source).toBe(averageGrid.toString())
    expect(base64).toBe(Buffer.from([1, 2, 3]).toString('base64'))
    expect(budget).toEqual(gridBudget)
    const aborted = vi.fn(async () => {})
    await seen.route!({ abort: aborted })
    expect(aborted).toHaveBeenCalled()
    expect(seen.closed).toBe(true)
  })

  it('gives no grid, never an error, when the picture cannot be read', async () => {
    for (const answer of [
      async () => {
        throw new Error('decode failed')
      },
      async () => null,
      async () => ({ width: 2, height: 2, values: [1] })
    ]) {
      const { browser, seen } = fakeBrowser(answer)
      expect(await lumaGrid(browser, new Uint8Array([1]))).toBeNull()
      expect(seen.closed).toBe(true)
    }
    // No browser at all.
    expect(await lumaGrid({} as Browser, new Uint8Array([1]))).toBeNull()
  })

  it('gives up on a page that never answers, closing it, within its time', async () => {
    const { browser, seen } = fakeBrowser(() => new Promise(() => {}))
    const started = Date.now()
    expect(await lumaGrid(browser, new Uint8Array([1]), 50)).toBeNull()
    expect(Date.now() - started).toBeLessThan(2_000)
    expect(seen.closed).toBe(true)
  })

  it('opens its page offline, as a second guard', async () => {
    const { browser, seen } = fakeBrowser(async () => grid)
    await lumaGrid(browser, new Uint8Array([1]))
    expect(seen.options).toEqual({ offline: true })
  })
})

describe('fetching the reference crop through its link', () => {
  const link = 'https://db.test/sign/inbox-assets/sect/x/1.jpg?token=SECRET'
  const answer = (
    body: Uint8Array,
    headers: Record<string, string> = { 'content-type': 'image/jpeg' },
    status = 200
  ) => new Response(Buffer.from(body), { status, headers })
  afterEach(() => vi.unstubAllGlobals())

  it('takes a JPEG, without following a redirect, within its time', async () => {
    const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
      async () => answer(new Uint8Array([9, 9]))
    )
    vi.stubGlobal('fetch', fetch)
    expect(await fetchCrop(link)).toEqual(new Uint8Array([9, 9]))
    const init = fetch.mock.calls[0]![1]!
    expect(init.redirect).toBe('error')
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(cropMs).toBeLessThanOrEqual(15_000)
  })

  it('fails with one word, never the link or the answer, for anything else', async () => {
    const cases: [string, () => Promise<Response>][] = [
      ['not https', async () => answer(new Uint8Array([1]))],
      ['not ok', async () => answer(new Uint8Array([1]), undefined, 403)],
      [
        'not a JPEG',
        async () => answer(new Uint8Array([1]), { 'content-type': 'text/html' })
      ],
      [
        'said too large',
        async () =>
          answer(new Uint8Array([1]), {
            'content-type': 'image/jpeg',
            'content-length': String(maxCropBytes + 1)
          })
      ],
      ['empty', async () => answer(new Uint8Array([]))],
      [
        'too large, with no length said',
        async () => answer(new Uint8Array(maxCropBytes + 1))
      ],
      [
        'the request fails',
        async () => {
          throw new Error(`could not reach ${link}`)
        }
      ]
    ]
    for (const [name, fetch] of cases) {
      vi.stubGlobal('fetch', vi.fn(fetch))
      const url = name === 'not https' ? link.replace('https', 'http') : link
      const error = await fetchCrop(url).then(
        () => null,
        (e: Error) => e
      )
      expect(error?.message, name).toBe('reference_failed')
      expect(String(error), name).not.toContain('SECRET')
    }
  })
})
