import { crc32, deflateSync } from 'node:zlib'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { PhotoOpener } from '../photos'

/**
 * DES-ENGINE-002b gate: a detailed, noisy photo (made in code, the same
 * for the same seed) served by a loopback server, so the real cut is
 * tested on a photo whose JPEG is large, fetched as the browser job
 * fetches a store's photo (streamed, its header read, its bytes checked).
 */

/** A `width` × `height` PNG of coloured noise (no real picture, D8). */
export function noisyPng(width: number, height: number, seed = 7): Buffer {
  let s = seed
  const row = () => {
    const r = Buffer.alloc(1 + width * 3)
    for (let i = 1; i < r.length; i++) {
      s = (s * 1103515245 + 12345) % 2147483648
      r[i] = s >> 23
    }
    return r
  }
  const raw = Buffer.concat(Array.from({ length: height }, row))
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body) >>> 0)
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 1 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/** A loopback server for `files` (path → PNG) and an opener that reads https photos from it. */
export async function photoServer(files: Record<string, Buffer>) {
  const server: Server = createServer((req, res) => {
    const file = files[req.url ?? '']
    if (!file) {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, { 'content-type': 'image/png' })
    // Sent in pieces, with no length: the reader must bound it itself.
    for (let i = 0; i < file.length; i += 64 * 1024)
      res.write(file.subarray(i, i + 64 * 1024))
    res.end()
  })
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
  const port = (server.address() as AddressInfo).port
  const open: PhotoOpener = async (url) => {
    const got = await fetch(`http://127.0.0.1:${port}${url.pathname}`)
    return {
      status: got.status,
      contentType: got.headers.get('content-type') ?? '',
      body: got.body as unknown as AsyncIterable<Uint8Array>,
      cancel: () => void got.body?.cancel().catch(() => {})
    }
  }
  return {
    open,
    close: () => new Promise<void>((ok) => server.close(() => ok()))
  }
}
