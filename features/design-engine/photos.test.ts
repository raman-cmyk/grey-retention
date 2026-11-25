// @vitest-environment node
import { createServer } from 'node:net'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import type { Browser } from '@playwright/test'
import {
  headerSize,
  httpsOpener,
  photoLimits,
  photoOrigins,
  photoTools,
  photoWords,
  safeLookup,
  type PhotoOpener
} from './photos'
import { noisyPng } from './golden/noisy'
import { picture } from './golden/pictures'

/** A PNG header that claims `w` × `h` (no pixels needed to read it). */
const pngHeader = (w: number, h: number) => {
  const b = Buffer.alloc(33)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  b.writeUInt32BE(13, 8)
  b.write('IHDR', 12, 'ascii')
  b.writeUInt32BE(w, 16)
  b.writeUInt32BE(h, 20)
  return b
}

const answer = (
  body: Buffer | Buffer[],
  type = 'image/png',
  status = 200
): ReturnType<PhotoOpener> =>
  Promise.resolve({
    status,
    contentType: type,
    body: (async function* () {
      for (const c of Array.isArray(body) ? body : [body]) yield c
    })(),
    cancel: () => {}
  })

const shopify = 'https://cdn.shopify.com/s/files/a.png'

describe('store photos (DES-ENGINE-002b)', () => {
  it('come only from a fixed list of hosts, never a store’s own', () => {
    expect(photoOrigins({})).toEqual([
      'https://cdn.shopify.com',
      'https://d3k81ch9hvuctc.cloudfront.net'
    ])
    expect(
      photoOrigins({ NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co' })
    ).toContain('https://abc.supabase.co')
  })

  it('reads sizes from the header of PNG, GIF, JPEG and WebP', () => {
    expect(headerSize('image/png', pngHeader(30, 10))).toEqual({
      width: 30,
      height: 10
    })
    const gif = Buffer.from('GIF89a\x20\x00\x10\x00', 'latin1')
    expect(headerSize('image/gif', gif)).toEqual({ width: 32, height: 16 })
    // SOI, an APP0 of 4 bytes, then SOF0 with 16 × 40.
    const jpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11,
      0x08, 0x00, 0x10, 0x00, 0x28, 0x03, 0x00, 0x00, 0x00, 0x00
    ])
    expect(headerSize('image/jpeg', jpeg)).toEqual({ width: 40, height: 16 })
    const webp = Buffer.alloc(30)
    webp.write('RIFF', 0, 'ascii')
    webp.write('WEBPVP8X', 8, 'ascii')
    webp.writeUIntLE(99, 24, 3)
    webp.writeUIntLE(49, 27, 3)
    expect(headerSize('image/webp', webp)).toEqual({ width: 100, height: 50 })
  })

  it('refuses another host, a redirect, a lie about the type, too many pixels and a stream past 8 MB', async () => {
    const calls: string[] = []
    const open: PhotoOpener = (url) => {
      calls.push(url.pathname)
      if (url.pathname.endsWith('moved.png'))
        return answer(Buffer.alloc(0), 'image/png', 301)
      if (url.pathname.endsWith('page.png'))
        return answer(Buffer.from('<html>'), 'image/png')
      if (url.pathname.endsWith('huge.png'))
        return answer(pngHeader(10_000, 10_000))
      if (url.pathname.endsWith('endless.png'))
        return answer(
          Array.from({ length: 9 }, () => Buffer.alloc(1024 * 1024))
        )
      return answer(noisyPng(30, 10))
    }
    const tools = photoTools({} as Browser, { open })
    expect(await tools.sizeOf(shopify)).toEqual({ width: 30, height: 10 })
    const why = async (src: string) => {
      const got = await tools.sizeOf(src)
      return 'failed' in got ? got.failed : null
    }
    expect(await why('https://shop.example/a.png')).toBe(photoWords.host)
    expect(await why('http://cdn.shopify.com/a.png')).toBe(photoWords.host)
    expect(await why('https://cdn.shopify.com/moved.png')).toBe(
      photoWords.fetch
    )
    expect(await why('https://cdn.shopify.com/page.png')).toBe(photoWords.type)
    expect(await why('https://cdn.shopify.com/huge.png')).toBe(
      photoWords.pixels
    )
    expect(await why('https://cdn.shopify.com/endless.png')).toBe(
      photoWords.big
    )
    expect(await why('data:image/jpeg;base64,iVBORw0KGgo=')).toBe(
      photoWords.type
    )
    expect(calls).not.toContain('/a.png'.replace('/a', '/shop'))
    expect(photoLimits.bytes).toBe(8 * 1024 * 1024)
  })

  it('refuses a host on a private, loopback, link-local, CGNAT or metadata address', async () => {
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '::1',
      'fe80::1',
      '::ffff:127.0.0.1'
    ]) {
      const lookup = safeLookup((_host, cb) =>
        cb(null, [{ address, family: address.includes(':') ? 6 : 4 }])
      )
      const error = await new Promise<Error | null>((ok) =>
        (
          lookup as unknown as (
            h: string,
            o: object,
            cb: (e: Error | null) => void
          ) => void
        )('cdn.shopify.com', {}, (e) => ok(e))
      )
      expect((error as { code?: string } | null)?.code, address).toBe(
        'EBLOCKED'
      )
    }
    const fine = safeLookup((_host, cb) =>
      cb(null, [{ address: '23.1.2.3', family: 4 }])
    )
    const got = await new Promise<string>((ok) =>
      (
        fine as unknown as (
          h: string,
          o: object,
          cb: (e: Error | null, a: string) => void
        ) => void
      )('cdn.shopify.com', {}, (_e, a) => ok(a))
    )
    expect(got).toBe('23.1.2.3')
  })

  it('answers Node’s all-addresses lookup with every checked address', async () => {
    const lookup = safeLookup((_host, cb) =>
      cb(null, [
        { address: '23.1.2.3', family: 4 },
        { address: '2606:4700::1111', family: 6 }
      ])
    )
    const got = await new Promise<unknown>((ok) =>
      (
        lookup as unknown as (
          h: string,
          o: object,
          cb: (e: Error | null, a: unknown) => void
        ) => void
      )('cdn.shopify.com', { all: true }, (_e, a) => ok(a))
    )
    expect(got).toEqual([
      { address: '23.1.2.3', family: 4 },
      { address: '2606:4700::1111', family: 6 }
    ])
  })

  it('connects through the real https.get to the address it checked', async () => {
    // A plain TCP server: reaching it proves https.get accepted the lookup's
    // answer (Node 20+ calls it with `all: true`). TLS then fails, which is fine.
    const server = createServer()
    const reached = new Promise<void>((ok) => {
      server.once('connection', (socket) => {
        socket.destroy()
        ok()
      })
    })
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
    const { port } = server.address() as AddressInfo
    const open = httpsOpener(
      (_host, cb) => cb(null, [{ address: '127.0.0.1', family: 4 }]),
      () => false
    )
    const attempt = open(new URL(`https://photos.test:${port}/x.png`)).catch(
      (e: Error) => e
    )
    await reached
    const result = await attempt
    server.close()
    expect(result).toBeInstanceOf(Error)
    expect((result as NodeJS.ErrnoException).code).not.toBe(
      'ERR_INVALID_IP_ADDRESS'
    )
  })

  it('refuses to cut a photo smaller than half the slot', async () => {
    const tools = photoTools({} as Browser)
    const tiny = {
      src: picture(20, 40, '#336633'),
      width: 0,
      height: 0,
      alt: 'x'
    }
    // The test picture is 2 × 4 px: a 600 × 300 slot would be a smear.
    expect(await tools.cropTo(tiny, 600, 300)).toEqual({
      failed: photoWords.small
    })
  })
})
