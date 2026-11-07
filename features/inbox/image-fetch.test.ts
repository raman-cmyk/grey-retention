// @vitest-environment node
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import {
  createImageFetcher,
  liveImageFetcher,
  reservedAddress,
  sampleImageFetcher
} from './image-fetch'

const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
let server: Server
let port = ''

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = req.url ?? '/'
    if (path === '/a.png') return res.writeHead(200).end(png)
    if (path === '/missing.png') return res.writeHead(404).end()
    if (path === '/declared-big.png')
      return res.writeHead(200, { 'content-length': '999999' }).end()
    if (path === '/streams-big.png') {
      res.writeHead(200)
      return res.end(Buffer.alloc(4096))
    }
    if (path.startsWith('/hop/')) {
      const n = Number(path.slice(5))
      return res
        .writeHead(302, { location: n ? `/hop/${n - 1}` : '/a.png' })
        .end()
    }
    if (path === '/to-private')
      return res
        .writeHead(302, { location: `http://inside.test:${port}/a.png` })
        .end()
    if (path === '/bad-location')
      return res.writeHead(302, { location: 'http://[' }).end()
    if (path === '/slow') return // never answers
    res.writeHead(500).end()
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  port = String((server.address() as AddressInfo).port)
})
afterAll(() => {
  server.closeAllConnections()
  server.close()
})

// "shop.test" plays a public host and "inside.test" a private one, both on
// this machine; only 10.x counts as private here.
const fetcher = () =>
  createImageFetcher({
    ports: [port],
    isReserved: (a) => a.startsWith('10.') || a === '::ffff:10.0.0.9',
    resolve: (host, done) =>
      host === 'shop.test'
        ? done(null, [{ address: '127.0.0.1', family: 4 }])
        : host === 'inside.test'
          ? done(null, [
              { address: '127.0.0.1', family: 4 },
              { address: '10.0.0.9', family: 4 }
            ])
          : done(Object.assign(new Error('nope'), { code: 'ENOTFOUND' }), [])
  })
const limits = { maxBytes: 1024, timeoutMs: 2_000 }
const at = (path: string, host = 'shop.test') => `http://${host}:${port}${path}`

describe('the live image fetcher', () => {
  it('downloads an image', async () => {
    const got = await fetcher().fetch(at('/a.png'), limits)
    expect(got).toMatchObject({ ok: true })
    expect(Buffer.from((got as { bytes: Uint8Array }).bytes).equals(png)).toBe(
      true
    )
  })

  it('reports broken links, oversized files and slow servers', async () => {
    const f = fetcher()
    expect(await f.fetch(at('/missing.png'), limits)).toEqual({
      ok: false,
      failure: 'broken'
    })
    expect(await f.fetch(at('/declared-big.png'), limits)).toEqual({
      ok: false,
      failure: 'too_large'
    })
    expect(await f.fetch(at('/streams-big.png'), limits)).toEqual({
      ok: false,
      failure: 'too_large'
    })
    expect(
      await f.fetch(at('/slow'), { maxBytes: 1024, timeoutMs: 200 })
    ).toEqual({ ok: false, failure: 'timeout' })
    expect(await f.fetch(at('/a.png', 'nowhere.test'), limits)).toEqual({
      ok: false,
      failure: 'broken'
    })
  })

  it('treats a redirect to a link that does not parse as a broken image, never a crash', async () => {
    expect(await fetcher().fetch(at('/bad-location'), limits)).toEqual({
      ok: false,
      failure: 'broken'
    })
  })

  it('follows at most 3 redirects', async () => {
    expect(await fetcher().fetch(at('/hop/2'), limits)).toMatchObject({
      ok: true
    })
    expect(await fetcher().fetch(at('/hop/3'), limits)).toEqual({
      ok: false,
      failure: 'broken'
    })
  })

  it('never reaches a private address, also not through a redirect', async () => {
    const f = fetcher()
    expect(await f.fetch(at('/a.png', 'inside.test'), limits)).toEqual({
      ok: false,
      failure: 'blocked'
    })
    expect(await f.fetch(at('/to-private'), limits)).toEqual({
      ok: false,
      failure: 'blocked'
    })
  })

  it('opens only http(s) links on the standard ports', async () => {
    const live = liveImageFetcher
    for (const link of [
      'ftp://cdn.shop.example/a.png',
      'file:///etc/passwd',
      'https://cdn.shop.example:8443/a.png',
      'https://user:pass@cdn.shop.example/a.png',
      'http://127.0.0.1/a.png',
      'http://[::1]/a.png',
      'http://169.254.169.254/latest/meta-data',
      'http://printer.local/a.png',
      'http://intranet/a.png'
    ])
      expect(await live.fetch(link, limits)).toEqual({
        ok: false,
        failure: 'blocked'
      })
  })
})

describe('reservedAddress', () => {
  it('knows private, local and reserved addresses, also inside IPv6', () => {
    for (const a of [
      '10.1.2.3',
      '127.0.0.1',
      '169.254.169.254',
      '172.20.0.1',
      '192.168.1.1',
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      '::',
      'fd00::1',
      'fe80::1',
      '::ffff:10.0.0.1',
      '[::ffff:127.0.0.1]',
      '::7f00:1',
      '64:ff9b::a00:1',
      '64:ff9b::7f00:1',
      '2002:7f00:1::1',
      'not an ip'
    ])
      expect(reservedAddress(a), a).toBe(true)
    for (const a of ['93.184.216.34', '8.8.8.8', '2606:4700::1111'])
      expect(reservedAddress(a), a).toBe(false)
  })
})

describe('the sample fetcher', () => {
  it('never uses the network and can play every failure', async () => {
    expect(
      await sampleImageFetcher.fetch(
        'https://mail.northwind.example/hero.png',
        limits
      )
    ).toMatchObject({ ok: true })
    expect(
      await sampleImageFetcher.fetch('https://x.example/broken.png', limits)
    ).toEqual({ ok: false, failure: 'broken' })
    expect(
      await sampleImageFetcher.fetch('https://x.example/huge.png', limits)
    ).toEqual({ ok: false, failure: 'too_large' })
  })
})
