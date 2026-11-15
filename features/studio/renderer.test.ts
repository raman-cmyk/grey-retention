// @vitest-environment node
import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import * as browser from '@/scripts/section-render.mjs'
import {
  blankPng,
  fakeSectionRenderer,
  maxSectionBytes,
  renderScale,
  renderWidth
} from './renderer'
import { maxSectionHeight, minSectionHeight, sectionWidth } from './section'

const size = (png: Uint8Array) => {
  const b = Buffer.from(png)
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
}
/** Each chunk's CRC, as a PNG reader checks it. */
function crcsOk(png: Buffer) {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  let at = 8
  while (at < png.length) {
    const length = png.readUInt32BE(at)
    const body = png.subarray(at + 4, at + 8 + length)
    let c = 0xffffffff
    for (const b of body) c = table[(c ^ b) & 0xff] ^ (c >>> 8)
    if ((c ^ 0xffffffff) >>> 0 !== png.readUInt32BE(at + 8 + length))
      return false
    at += 12 + length
  }
  return true
}

describe('the section renderer (DST-001)', () => {
  it('draws at twice the CSS size: 1,200 px wide', async () => {
    const out = await fakeSectionRenderer.render(
      { id: 's1', html: '<h1>Hi</h1>', css: 'h1{margin:0}', height: 300 },
      []
    )
    expect(out).toMatchObject({
      ok: true,
      image: { id: 's1', contentType: 'image/png', width: 1200, height: 600 }
    })
    if (!out.ok) return
    expect(size(out.image.bytes)).toEqual({ width: 1200, height: 600 })
  })

  it('never draws a section that fails its checks or is in the wrong shape', async () => {
    for (const section of [
      { id: 's1', html: '<script></script>', css: '', height: 300 },
      { id: 's1', css: '', height: 300 }
    ])
      expect(await fakeSectionRenderer.render(section, [])).toMatchObject({
        ok: false,
        reason: 'refused',
        problems: [expect.any(String)]
      })
  })

  it('makes a real PNG: signature, size, CRCs and white pixels', () => {
    const png = Buffer.from(blankPng(10, 3))
    expect([...png.subarray(0, 8)]).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
    ])
    expect(size(png)).toEqual({ width: 10, height: 3 })
    expect(crcsOk(png)).toBe(true)
    const idat = png.indexOf('IDAT')
    const length = png.readUInt32BE(idat - 4)
    const raw = inflateSync(png.subarray(idat + 4, idat + 4 + length))
    // Each row: a filter byte, then 2 bytes of white bits.
    expect([...raw]).toEqual([0, 255, 255, 0, 255, 255, 0, 255, 255])
    expect(crcsOk(Buffer.from(blankPng(1200, 3200)))).toBe(true)
  })

  it('keeps the same sizes as the browser script', () => {
    expect([renderScale, sectionWidth, maxSectionBytes]).toEqual([
      browser.scale,
      browser.width,
      browser.maxBytes
    ])
    expect(renderWidth).toBe(1200)
    expect([minSectionHeight, maxSectionHeight]).toEqual([
      browser.minHeight,
      browser.maxHeight
    ])
  })
})
