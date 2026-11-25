import { crc32, deflateSync } from 'node:zlib'

/**
 * DES-ENGINE-001 golden set: plain coloured pictures, made in code, so the
 * test emails have pictures of exact proportions without any real photo
 * (the repository is public, D8). A picture is a small PNG at a tenth of
 * its shown size: the email's width and height attributes draw it full
 * size, and its own proportions match them (a phone's `height:auto` keeps
 * the shape).
 */

function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body) >>> 0)
  return Buffer.concat([len, body, crc])
}

const cache = new Map<string, string>()

/** A `data:image/png` picture `width` × `height` (shown size) in one colour. */
export function picture(width: number, height: number, color: string): string {
  const w = Math.max(1, Math.round(width / 10))
  const h = Math.max(1, Math.round(height / 10))
  const key = `${w}x${h}${color}`
  const known = cache.get(key)
  if (known) return known
  const rgb = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16))
  const row = Buffer.alloc(1 + w * 3)
  for (let x = 0; x < w; x++) row.set(rgb, 1 + x * 3)
  const raw = Buffer.concat(Array.from({ length: h }, () => row))
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
  const uri = `data:image/png;base64,${png.toString('base64')}`
  cache.set(key, uri)
  return uri
}

/** A one-frame GIF: a stand-in for a countdown timer (it cannot be copied). */
export const timerPicture =
  'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=='
