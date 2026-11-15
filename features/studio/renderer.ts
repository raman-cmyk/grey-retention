import { deflateSync } from 'node:zlib'
import {
  sectionDocument,
  sectionProblems,
  sectionWidth,
  type DesignedSection
} from './section'

/**
 * DST-001: the renderer draws a designed section in a browser at twice
 * its CSS size, so the picture stays sharp on high-density screens: 1,200
 * px wide, shown at 600 (AGENT_MAP §4 layer 3, step 4). The live renderer
 * is a headless browser (`scripts/section-render.mjs`, run by a job like
 * the inbox screenshots); `fakeSectionRenderer` stands in everywhere else.
 */
export const renderScale = 2
export const renderWidth = sectionWidth * renderScale
/** A section's picture stays well under what Klaviyo takes for one image. */
export const maxSectionBytes = 3 * 1024 * 1024

export type RenderedSection = {
  id: string
  /** The picture: JPEG from the browser, PNG from the fake. */
  bytes: Uint8Array
  contentType: 'image/jpeg' | 'image/png'
  /** Pixels: `renderWidth` wide, `renderScale` × the section's height. */
  width: number
  height: number
}

export type RenderResult =
  | { ok: true; image: RenderedSection }
  | {
      ok: false
      /**
       * `refused`: the section failed its checks (never drawn);
       * `timeout`, `too_large`, `navigated`, `failed`: the browser could
       * not draw it.
       */
      reason: 'refused' | 'timeout' | 'too_large' | 'navigated' | 'failed'
      problems?: string[]
    }

export interface SectionRenderer {
  render(
    section: unknown,
    /** Hostnames its pictures and fonts may come from. */
    hosts: readonly string[]
  ): Promise<RenderResult>
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(bytes: Uint8Array) {
  let c = 0xffffffff
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type: string, data: Uint8Array) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  Buffer.from(data).copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

/** A plain white PNG of this size (one bit per pixel): the fake's picture. */
export function blankPng(width: number, height: number) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  // Bit depth 1, greyscale, no interlace.
  header.set([1, 0, 0, 0, 0], 8)
  const row = 1 + Math.ceil(width / 8)
  const raw = Buffer.alloc(row * height, 0xff)
  for (let y = 0; y < height; y++) raw[y * row] = 0
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', new Uint8Array())
    ])
  )
}

/**
 * The renderer without a browser: the same checks first, then a white
 * picture of the size the browser would give.
 */
export const fakeSectionRenderer: SectionRenderer = {
  async render(section, hosts) {
    const problems = sectionProblems(section, hosts)
    if (problems.length) return { ok: false, reason: 'refused', problems }
    const checked = section as DesignedSection
    // The page the browser would get; building it proves it can be built.
    sectionDocument(checked)
    const width = renderWidth
    const height = checked.height * renderScale
    return {
      ok: true,
      image: {
        id: checked.id,
        bytes: blankPng(width, height),
        contentType: 'image/png',
        width,
        height
      }
    }
  }
}
