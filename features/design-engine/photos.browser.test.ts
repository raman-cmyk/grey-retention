// @vitest-environment node
import { crc32, deflateSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Browser } from '@playwright/test'
import { launch } from '@/lib/sandbox/browser.mjs'
import { photoTools, sizedPhotos } from './photos'

/**
 * DES-ENGINE-002b: the centre cut and the photo sizes, in Chromium (with
 * `DESIGN_ENGINE_BROWSER=on`). A 30 × 10 photo in three stripes (red,
 * green, blue) cut to a square is all green: the centre, never stretched.
 */
const on = process.env.DESIGN_ENGINE_BROWSER === 'on'

function stripes(): string {
  const w = 30
  const h = 10
  const colours = [
    [255, 0, 0],
    [0, 160, 0],
    [0, 0, 255]
  ]
  const row = Buffer.alloc(1 + w * 3)
  for (let x = 0; x < w; x++) row.set(colours[Math.floor(x / 10)]!, 1 + x * 3)
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body) >>> 0)
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk(
      'IDAT',
      deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))
    ),
    chunk('IEND', Buffer.alloc(0))
  ])
  return `data:image/png;base64,${png.toString('base64')}`
}

describe.skipIf(!on)('photo sizes and the centre cut', () => {
  let browser: Browser
  beforeAll(async () => {
    const { chromium } = await import('@playwright/test')
    browser = await launch(chromium)
  })
  afterAll(async () => {
    await browser?.close()
  })

  it('reads a photo’s size and cuts its centre at the slot’s shape', async () => {
    const tools = photoTools(browser)
    const src = stripes()
    expect(await tools.sizeOf(src)).toEqual({ width: 30, height: 10 })
    const cut = await tools.cropTo(
      { src, width: 30, height: 10, alt: 'Tea' },
      100,
      100
    )
    expect(cut).toMatchObject({ width: 100, height: 100, alt: 'Tea' })
    expect(cut!.src).toMatch(/^data:image\/jpeg;base64,/)
    // Every corner of the cut is the middle stripe.
    const context = await browser.newContext({ javaScriptEnabled: true })
    const page = await context.newPage()
    const corners = await page.evaluate(
      (s) =>
        new Promise<number[][]>((resolve) => {
          const img = new Image()
          img.onload = () => {
            const c = document.createElement('canvas')
            c.width = img.naturalWidth
            c.height = img.naturalHeight
            const g = c.getContext('2d')!
            g.drawImage(img, 0, 0)
            const at = (x: number, y: number) => [
              ...g.getImageData(x, y, 1, 1).data.slice(0, 3)
            ]
            resolve([
              at(1, 1),
              at(c.width - 2, 1),
              at(1, c.height - 2),
              at(c.width - 2, c.height - 2)
            ])
          }
          img.src = s
        }),
      cut!.src
    )
    await context.close()
    for (const [r, g, b] of corners) {
      expect(r).toBeLessThan(60)
      expect(g).toBeGreaterThan(110)
      expect(b).toBeLessThan(60)
    }
  })

  it('fetches only https photos from allowed origins, never through a redirect', async () => {
    const calls: { url: string; redirect?: string }[] = []
    const png = Buffer.from(stripes().split(',')[1]!, 'base64')
    const fetcher = (async (url: URL, init?: RequestInit) => {
      calls.push({ url: String(url), redirect: init?.redirect })
      if (String(url).includes('big'))
        return new Response('x', {
          headers: {
            'content-type': 'image/png',
            'content-length': String(9 * 1024 * 1024)
          }
        })
      if (String(url).includes('page'))
        return new Response('<html>', {
          headers: { 'content-type': 'text/html' }
        })
      return new Response(png, { headers: { 'content-type': 'image/png' } })
    }) as unknown as typeof fetch
    const tools = photoTools(browser, {
      origins: ['https://cdn.shop.test'],
      fetcher
    })
    expect(await tools.sizeOf('https://cdn.shop.test/a.png')).toEqual({
      width: 30,
      height: 10
    })
    expect(await tools.sizeOf('https://other.test/a.png')).toBe(null)
    expect(await tools.sizeOf('http://cdn.shop.test/a.png')).toBe(null)
    expect(await tools.sizeOf('https://cdn.shop.test/big.png')).toBe(null)
    expect(await tools.sizeOf('https://cdn.shop.test/page.png')).toBe(null)
    expect(await tools.sizeOf('data:text/html;base64,PGI+')).toBe(null)
    expect(calls.every((c) => c.redirect === 'error')).toBe(true)
    expect(calls.map((c) => c.url)).not.toContain('https://other.test/a.png')
    // Unknown sizes are read; an unreadable photo is left out.
    const photos = await sizedPhotos(tools, [
      { src: 'https://cdn.shop.test/a.png', width: 0, height: 0, alt: 'a' },
      { src: 'https://other.test/b.png', width: 0, height: 0, alt: 'b' },
      { src: 'https://cdn.shop.test/c.png', width: 8, height: 8, alt: 'c' }
    ])
    expect(photos.map((p) => [p.alt, p.width, p.height])).toEqual([
      ['a', 30, 10],
      ['c', 8, 8]
    ])
  })
})
