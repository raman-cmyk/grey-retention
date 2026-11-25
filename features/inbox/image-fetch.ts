import 'server-only'
import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import { isIP } from 'node:net'
import { reservedAddress } from '@/lib/reserved-address'
import type { FetchedImage, ImageFetcher } from '@/lib/providers/image-fetch'

export { reservedAddress }

type Lookup = NonNullable<http.RequestOptions['lookup']>
type Resolve = (
  hostname: string,
  callback: (error: Error | null, addresses: LookupAddress[]) => void
) => void
const systemResolve: Resolve = (hostname, callback) =>
  dnsLookup(hostname, { all: true }, callback)

/**
 * A DNS lookup that refuses a host with any private address and hands the
 * checked address straight to the connection (no second lookup to trick).
 */
const safeLookup =
  (resolve: Resolve, isReserved: (address: string) => boolean): Lookup =>
  (hostname, options, callback) =>
    resolve(hostname, (error, addresses) => {
      if (error) return callback(error, '', 0)
      if (!addresses.length || addresses.some((a) => isReserved(a.address)))
        return callback(
          Object.assign(new Error('blocked address'), { code: 'EBLOCKED' }),
          '',
          0
        )
      if ((options as { all?: boolean }).all)
        return (callback as unknown as (e: null, a: LookupAddress[]) => void)(
          null,
          addresses
        )
      callback(null, addresses[0]!.address, addresses[0]!.family)
    })

type Hop =
  { kind: 'redirect'; to: string } | { kind: 'done'; result: FetchedImage }

function hop(
  url: URL,
  maxBytes: number,
  deadline: number,
  lookup: Lookup,
  headers: { accept: string; userAgent: string },
  types?: RegExp
): Promise<Hop> {
  return new Promise((resolve) => {
    const client = url.protocol === 'https:' ? https : http
    let settled = false
    const finish = (value: Hop) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      request.destroy()
      resolve(value)
    }
    const fail = (failure: FetchedImage & { ok: false }) =>
      finish({ kind: 'done', result: failure })
    const request = client.get(
      url,
      {
        lookup,
        agent: false,
        headers: {
          accept: headers.accept,
          'user-agent': headers.userAgent
        }
      },
      (response) => {
        const status = response.statusCode ?? 0
        if ([301, 302, 303, 307, 308].includes(status)) {
          // A sender controls this header: a link that does not parse is
          // a broken image, never an error for the sweep.
          let to: string | null = null
          try {
            if (response.headers.location)
              to = new URL(response.headers.location, url).toString()
          } catch {
            to = null
          }
          return to
            ? finish({ kind: 'redirect', to })
            : fail({ ok: false, failure: 'broken' })
        }
        if (status !== 200) return fail({ ok: false, failure: 'broken' })
        if (
          types &&
          !types.test(String(response.headers['content-type'] ?? ''))
        )
          return fail({ ok: false, failure: 'broken' })
        if (Number(response.headers['content-length'] ?? 0) > maxBytes)
          return fail({ ok: false, failure: 'too_large' })
        const chunks: Buffer[] = []
        let size = 0
        response.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > maxBytes) return fail({ ok: false, failure: 'too_large' })
          chunks.push(chunk)
        })
        response.on('end', () =>
          finish({
            kind: 'done',
            result: size
              ? {
                  ok: true,
                  bytes: new Uint8Array(Buffer.concat(chunks)),
                  url: url.toString()
                }
              : { ok: false, failure: 'broken' }
          })
        )
        response.on('error', () => fail({ ok: false, failure: 'broken' }))
      }
    )
    const timer = setTimeout(
      () => fail({ ok: false, failure: 'timeout' }),
      Math.max(1, deadline - Date.now())
    )
    request.on('error', (error: NodeJS.ErrnoException) =>
      fail({
        ok: false,
        failure: error.code === 'EBLOCKED' ? 'blocked' : 'broken'
      })
    )
  })
}

type FetcherOptions = {
  /** Name lookup (the system's by default). */
  resolve?: Resolve
  /** Addresses never reached (private, local and reserved by default). */
  isReserved?: (address: string) => boolean
  /** Ports allowed (80 and 443 by default). */
  ports?: string[]
  /** What the request asks for (images by default). */
  accept?: string
  /** Who asks (a neutral name by default). */
  userAgent?: string
  /** Content types accepted (any by default), e.g. only HTML pages. */
  types?: RegExp
  /** Schemes allowed on the link and every redirect (http and https). */
  protocols?: ('https:' | 'http:')[]
  /**
   * Hosts the link and every redirect may reach (any public host by
   * default): a hop elsewhere is blocked, never opened.
   */
  allowHost?: (host: string) => boolean
}

/**
 * An image fetcher for the open internet: plain GETs (no cookies, no
 * credentials), http(s) on the standard ports only, never a private
 * address (checked again on every redirect, at most 3), a byte cap and one
 * deadline per image. The options exist for tests.
 */
export function createImageFetcher(options: FetcherOptions = {}): ImageFetcher {
  const isReserved = options.isReserved ?? reservedAddress
  const ports = options.ports ?? ['80', '443']
  const headers = {
    accept: options.accept ?? 'image/avif,image/webp,image/png,image/*;q=0.8',
    userAgent: options.userAgent ?? 'Mozilla/5.0 (compatible; ImageFetch/1.0)'
  }
  const allowHost = options.allowHost ?? (() => true)
  const protocols: string[] = options.protocols ?? ['https:', 'http:']
  const lookup = safeLookup(options.resolve ?? systemResolve, isReserved)
  const allowed = (url: URL) => {
    if (!protocols.includes(url.protocol)) return false
    if (url.username || url.password) return false
    const port = url.port || (url.protocol === 'https:' ? '443' : '80')
    if (!ports.includes(port)) return false
    const host = url.hostname.replace(/^\[|\]$/g, '')
    if (!allowHost(host.toLowerCase())) return false
    if (isIP(host)) return !isReserved(host)
    return host.includes('.') && !/\.(local|internal|localhost)$/i.test(host)
  }
  return {
    async fetch(link, { maxBytes, timeoutMs }) {
      const deadline = Date.now() + timeoutMs
      let url: URL
      try {
        url = new URL(link)
      } catch {
        return { ok: false, failure: 'broken' }
      }
      for (let redirects = 0; ; redirects++) {
        if (!allowed(url)) return { ok: false, failure: 'blocked' }
        const next = await hop(
          url,
          maxBytes,
          deadline,
          lookup,
          headers,
          options.types
        )
        if (next.kind === 'done') return next.result
        if (redirects === 3) return { ok: false, failure: 'broken' }
        url = new URL(next.to)
      }
    }
  }
}

/** The live image fetcher: the open internet, with every guard on. */
export const liveImageFetcher = createImageFetcher()

/** A 1×1 grey PNG: what every sample image looks like. */
const samplePng = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
    'base64'
  )
)

/**
 * The sample fetcher for sample (.example) emails: no network. A path with
 * "broken", "huge" or "not-image" in it answers like a bad link would.
 */
export const sampleImageFetcher: ImageFetcher = {
  async fetch(link, { maxBytes }) {
    if (/broken/i.test(link)) return { ok: false, failure: 'broken' }
    if (/huge/i.test(link) || samplePng.byteLength > maxBytes)
      return { ok: false, failure: 'too_large' }
    if (/not-image/i.test(link))
      return { ok: true, bytes: new TextEncoder().encode('<html></html>') }
    return { ok: true, bytes: samplePng }
  }
}
