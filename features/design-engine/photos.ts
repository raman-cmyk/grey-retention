import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import https from 'node:https'
import type { Browser, Page } from '@playwright/test'
import { reservedAddress } from '@/lib/reserved-address'
import {
  swapBrand,
  type Cropper,
  type SwapInput,
  type SwapPicture,
  type SwapResult
} from './swap'

/**
 * DES-ENGINE-002b: the store's photos measured and cut to a slot's shape,
 * in code, with no image service and no new dependency (owner plan: no
 * paid service; a smart crop stays out of scope).
 *
 * - **Where photos come from**: a fixed list of hosts (`photoOrigins`),
 *   never one built from a store's own data (its catalog links, its
 *   domain). Each host is resolved first and a private, loopback,
 *   link-local, CGNAT or metadata address is refused; the connection uses
 *   the address that was checked (no second lookup); https only, never a
 *   redirect, at most 8 MB read as it streams in.
 * - **What a photo is**: its first bytes must be a PNG, JPEG, WebP or GIF
 *   of the type its server says, and its size is read from that header on
 *   the server (at most 40 million pixels), before any browser sees it.
 * - **The cut**: the centre of the photo at the slot's shape, drawn on a
 *   canvas in a page that blocks every request (the photo is handed in
 *   inline), under a deadline. A photo smaller than half the slot is
 *   refused (it would be a smear). The JPEG steps down in size and quality
 *   until it is under 2.5 MB.
 * Every refusal is a plain reason for that one photo; its section is then
 * built from a library block with the reason, never the whole email.
 */

export const photoLimits = {
  bytes: 8 * 1024 * 1024,
  pixels: 40_000_000,
  /** One photo's fetch, and one cut. */
  ms: 20_000,
  /** The cut's largest JPEG (the bucket keeps 3 MiB). */
  cutBytes: 2_500_000
} as const

/**
 * The hosts store photos may be fetched from, and why:
 * - `cdn.shopify.com`: Shopify stores' catalog photos (most Klaviyo
 *   catalogs point there; the onboarding readers already read it);
 * - `d3k81ch9hvuctc.cloudfront.net`: Klaviyo's own image host (pictures
 *   uploaded to Klaviyo, rule 11);
 * - our own Supabase Storage (the brand's assets and the inbox's stored
 *   pictures), from the server's own setting, never a tenant's.
 * Any other host is refused with a plain reason.
 */
export function photoOrigins(
  env: Readonly<Record<string, string | undefined>> = process.env
): string[] {
  const own = [env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_URL].flatMap((u) => {
    try {
      const url = new URL(u ?? '')
      return url.protocol === 'https:' ? [url.origin] : []
    } catch {
      return []
    }
  })
  return [
    'https://cdn.shopify.com',
    'https://d3k81ch9hvuctc.cloudfront.net',
    ...new Set(own)
  ]
}

/** Why a photo could not be used, in the owner's words. */
export const photoWords = {
  host: 'it is hosted on a site GROS doesn’t load photos from yet',
  address: 'its site is on a private network address',
  fetch: 'it could not be fetched',
  big: 'it is larger than 8 MB',
  type: 'it is not a PNG, JPEG, WebP or GIF picture',
  pixels: 'it has more than 40 million pixels',
  small: 'it is too small to cut to this shape without blurring',
  cut: 'it could not be cut to this shape'
} as const

export type PhotoSize = { width: number; height: number }
type Failed = { failed: string }
const failed = (reason: string): Failed => ({ failed: reason })
const isFailed = (v: unknown): v is Failed =>
  !!v && typeof v === 'object' && 'failed' in v

/** A response as the photo fetcher reads it (streamed). */
export type PhotoResponse = {
  status: number
  contentType: string
  body: AsyncIterable<Uint8Array>
  cancel: () => void
}
/** Opens one https photo (the default checks every address first). */
export type PhotoOpener = (url: URL) => Promise<PhotoResponse>

type Resolve = (
  host: string,
  cb: (e: Error | null, a: LookupAddress[]) => void
) => void
const systemResolve: Resolve = (host, cb) => dnsLookup(host, { all: true }, cb)

/** A lookup that refuses any private address and connects to the one checked. */
export function safeLookup(resolve: Resolve = systemResolve) {
  return ((
    host: string,
    _options: unknown,
    cb: (e: Error | null, address: string, family: number) => void
  ) =>
    resolve(host, (error, addresses) => {
      if (error) return cb(error, '', 0)
      if (
        !addresses.length ||
        addresses.some((a) => reservedAddress(a.address))
      )
        return cb(
          Object.assign(new Error('blocked address'), { code: 'EBLOCKED' }),
          '',
          0
        )
      const first = addresses[0]!
      cb(null, first.address, first.family)
    })) as unknown as NonNullable<https.RequestOptions['lookup']>
}

/** The real opener: https, the checked address, no redirect, a deadline. */
export const httpsOpener =
  (resolve?: Resolve): PhotoOpener =>
  (url) =>
    new Promise((ok, fail) => {
      const req = https.get(
        url,
        { lookup: safeLookup(resolve), timeout: photoLimits.ms },
        (res) =>
          ok({
            status: res.statusCode ?? 0,
            contentType: String(res.headers['content-type'] ?? ''),
            body: res,
            cancel: () => res.destroy()
          })
      )
      req.on('timeout', () => req.destroy(new Error('timeout')))
      req.on('error', fail)
    })

const magic: Record<string, (b: Uint8Array) => boolean> = {
  'image/png': (b) =>
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/gif': (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46,
  'image/webp': (b) =>
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
}

/** A picture's size from its header (PNG, JPEG, WebP, GIF), or null. */
export function headerSize(type: string, b: Uint8Array): PhotoSize | null {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength)
  try {
    if (type === 'image/png' && b.length >= 24)
      return { width: view.getUint32(16), height: view.getUint32(20) }
    if (type === 'image/gif' && b.length >= 10)
      return { width: view.getUint16(6, true), height: view.getUint16(8, true) }
    if (type === 'image/webp' && b.length >= 30) {
      const chunk = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!)
      if (chunk === 'VP8 ')
        return {
          width: view.getUint16(26, true) & 0x3fff,
          height: view.getUint16(28, true) & 0x3fff
        }
      if (chunk === 'VP8L') {
        const bits = view.getUint32(21, true)
        return {
          width: (bits & 0x3fff) + 1,
          height: ((bits >> 14) & 0x3fff) + 1
        }
      }
      if (chunk === 'VP8X')
        return {
          width: 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16)),
          height: 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16))
        }
      return null
    }
    if (type === 'image/jpeg') {
      let i = 2
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) return null
        const marker = b[i + 1]!
        const length = view.getUint16(i + 2)
        // Start of frame (not DHT 0xC4, JPG 0xC8, DAC 0xCC).
        if (
          marker >= 0xc0 &&
          marker <= 0xcf &&
          marker !== 0xc4 &&
          marker !== 0xc8 &&
          marker !== 0xcc
        )
          return { width: view.getUint16(i + 7), height: view.getUint16(i + 5) }
        i += 2 + length
      }
    }
  } catch {
    return null
  }
  return null
}

type Loaded = { type: string; bytes: Buffer; size: PhotoSize }

/** Checks a picture's bytes: its type's magic, its size, its pixels. */
function checked(type: string, bytes: Buffer): Loaded | Failed {
  const t = type.split(';')[0]!.trim().toLowerCase()
  if (!magic[t] || !magic[t]!(bytes)) return failed(photoWords.type)
  const size = headerSize(t, bytes)
  if (!size || size.width < 1 || size.height < 1) return failed(photoWords.type)
  if (size.width * size.height > photoLimits.pixels)
    return failed(photoWords.pixels)
  return { type: t, bytes, size }
}

export type PhotoTools = {
  /** A photo's own size, or why it cannot be used. */
  sizeOf: (src: string) => Promise<PhotoSize | Failed>
  /**
   * The photo's centre at `width` × `height` (an inline JPEG, with its own
   * pixel size), or why it cannot be cut.
   */
  cropTo: (
    photo: SwapPicture,
    width: number,
    height: number
  ) => Promise<SwapPicture | Failed>
}

/** Resolves `work`, or rejects after `ms` (and runs `stop`). */
function deadline<T>(work: Promise<T>, ms: number, stop: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      stop()
      reject(new Error('timeout'))
    }, ms)
  })
  return Promise.race([work, late]).finally(() => clearTimeout(timer))
}

export function photoTools(
  browser: Browser,
  options: { origins?: readonly string[]; open?: PhotoOpener } = {}
): PhotoTools {
  const allowed = new Set(options.origins ?? photoOrigins())
  const open = options.open ?? httpsOpener()
  const cache = new Map<string, Promise<Loaded | Failed>>()
  const fetchOne = async (src: string): Promise<Loaded | Failed> => {
    const inline = /^data:(image\/[a-z]+);base64,([a-z0-9+/]+={0,2})$/i.exec(
      src
    )
    if (inline) {
      const bytes = Buffer.from(inline[2]!, 'base64')
      if (bytes.byteLength > photoLimits.bytes) return failed(photoWords.big)
      return checked(inline[1]!, bytes)
    }
    let url: URL
    try {
      url = new URL(src)
    } catch {
      return failed(photoWords.fetch)
    }
    if (url.protocol !== 'https:' || !allowed.has(url.origin))
      return failed(photoWords.host)
    let res: PhotoResponse
    try {
      res = await open(url)
    } catch (e) {
      return failed(
        (e as { code?: string })?.code === 'EBLOCKED'
          ? photoWords.address
          : photoWords.fetch
      )
    }
    // Never a redirect: the address asked for is the one answered.
    if (res.status !== 200) {
      res.cancel()
      return failed(photoWords.fetch)
    }
    const chunks: Buffer[] = []
    let total = 0
    try {
      for await (const chunk of res.body) {
        total += chunk.byteLength
        if (total > photoLimits.bytes) {
          res.cancel()
          return failed(photoWords.big)
        }
        chunks.push(Buffer.from(chunk))
      }
    } catch {
      return failed(photoWords.fetch)
    }
    return checked(res.contentType, Buffer.concat(chunks))
  }
  const load = (src: string) => {
    let got = cache.get(src)
    if (!got) {
      got = fetchOne(src)
      cache.set(src, got)
    }
    return got
  }
  /** Runs `work` with the photo in a locked page, under a deadline. */
  const inPage = async <T>(
    photo: Loaded,
    work: (page: Page) => Promise<T>
  ): Promise<T | null> => {
    const context = await browser.newContext({
      viewport: { width: 400, height: 400 },
      javaScriptEnabled: true,
      serviceWorkers: 'block'
    })
    const stop = () => void context.close().catch(() => {})
    try {
      return await deadline(
        (async () => {
          const page = await context.newPage()
          await page.route('**/*', (route) =>
            route.request().url().startsWith('data:') &&
            !route.request().isNavigationRequest()
              ? route.continue().catch(() => {})
              : route.abort().catch(() => {})
          )
          await page.setContent('<!doctype html><html><body></body></html>')
          const ok = await page.evaluate(
            (src) =>
              new Promise<boolean>((resolve) => {
                const img = new Image()
                img.id = 'photo'
                img.onload = () => {
                  document.body.appendChild(img)
                  resolve(img.naturalWidth > 0)
                }
                img.onerror = () => resolve(false)
                img.src = src
              }),
            `data:${photo.type};base64,${photo.bytes.toString('base64')}`
          )
          return ok ? await work(page) : null
        })(),
        photoLimits.ms,
        stop
      )
    } catch {
      return null
    } finally {
      stop()
    }
  }
  return {
    async sizeOf(src) {
      const got = await load(src)
      return isFailed(got) ? got : got.size
    },
    async cropTo(photo, width, height) {
      if (!(width > 0 && height > 0)) return failed(photoWords.cut)
      const got = await load(photo.src)
      if (isFailed(got)) return got
      // The centre at the slot's shape: refused under half the slot.
      const want = width / height
      const { width: nw, height: nh } = got.size
      const sw = nw / nh > want ? nh * want : nw
      const sh = nw / nh > want ? nh : nw / want
      if (sw < width / 2 || sh < height / 2) return failed(photoWords.small)
      const cut = await inPage(got, (page) =>
        page.evaluate(
          ({ w, h, limit }) => {
            const img = document.getElementById('photo') as HTMLImageElement
            const nw = img.naturalWidth
            const nh = img.naturalHeight
            const ratio = w / h
            const sw = nw / nh > ratio ? nh * ratio : nw
            const sh = nw / nh > ratio ? nh : nw / ratio
            // Twice the slot where the photo has the pixels; then smaller
            // and lower quality until it is under the limit.
            for (const scale of [2, 1.5, 1])
              for (const quality of [0.86, 0.72, 0.6]) {
                const ow = Math.max(1, Math.round(Math.min(w * scale, sw)))
                const oh = Math.max(1, Math.round(ow / ratio))
                const canvas = document.createElement('canvas')
                canvas.width = ow
                canvas.height = oh
                const ctx = canvas.getContext('2d')!
                ctx.fillStyle = '#ffffff'
                ctx.fillRect(0, 0, ow, oh)
                ctx.drawImage(
                  img,
                  (nw - sw) / 2,
                  (nh - sh) / 2,
                  sw,
                  sh,
                  0,
                  0,
                  ow,
                  oh
                )
                const url = canvas.toDataURL('image/jpeg', quality)
                if (url.length * 0.75 <= limit) return { url, ow, oh }
              }
            return null
          },
          { w: width, h: height, limit: photoLimits.cutBytes }
        )
      )
      if (!cut || !/^data:image\/jpeg;base64,/.test(cut.url))
        return failed(photoWords.cut)
      return { src: cut.url, width: cut.ow, height: cut.oh, alt: photo.alt }
    }
  }
}

/**
 * Photos with their sizes read (a catalog keeps none). One that cannot be
 * used is kept with its reason (`unusable`), never dropped silently: the
 * swap then builds its section from a library block and says why.
 */
export async function sizedPhotos(
  tools: PhotoTools,
  photos: readonly SwapPicture[]
): Promise<SwapPicture[]> {
  const out: SwapPicture[] = []
  for (const p of photos) {
    if (p.width > 0 && p.height > 0) {
      out.push(p)
      continue
    }
    const size = await tools.sizeOf(p.src)
    out.push(
      isFailed(size) ? { ...p, unusable: size.failed } : { ...p, ...size }
    )
  }
  return out
}

/** A cut photo, as the drawing carries it until it is hosted. */
export type Cut = {
  placeholder: string
  inline: string
  width: number
  height: number
}

/** Where a cut photo stands in the email until it is uploaded. */
export const cutPlaceholder = (index: number) =>
  `https://email-copies.invalid/${index}.jpg`

/**
 * The brand swap with real cuts: a first pass records which photo each
 * slot wants at which shape, the photos are cut (centre, canvas), and the
 * swap runs again with each cut as a short placeholder address (a cut is
 * far larger than a blueprint keeps a picture); `cuts` says which inline
 * JPEG each placeholder stands for. A photo that cannot be cut leaves its
 * section to a library block, with the reason; the rest of the email is
 * still copied.
 */
export async function swapWithCrops(
  input: SwapInput,
  tools: PhotoTools
): Promise<SwapResult & { cuts?: Cut[] }> {
  const key = (p: SwapPicture, w: number, h: number) =>
    `${Math.round(w)}x${Math.round(h)}:${p.src}`
  const wanted = new Map<string, { photo: SwapPicture; w: number; h: number }>()
  const recorder: Cropper = (photo, w, h) => {
    wanted.set(key(photo, w, h), { photo, w, h })
    return { ...photo, src: cutPlaceholder(wanted.size), width: w, height: h }
  }
  const first = swapBrand({ ...input, cropper: recorder })
  if (!first.ok) return first
  const cuts: Cut[] = []
  const byKey = new Map<string, SwapPicture | Failed>()
  for (const [k, want] of wanted) {
    const got = await tools.cropTo(want.photo, want.w, want.h)
    if (isFailed(got)) {
      byKey.set(k, got)
      continue
    }
    const placeholder = cutPlaceholder(cuts.length)
    cuts.push({
      placeholder,
      inline: got.src,
      width: got.width,
      height: got.height
    })
    byKey.set(k, { ...got, src: placeholder })
  }
  const second = swapBrand({
    ...input,
    cropper: (photo, w, h) => byKey.get(key(photo, w, h)) ?? null
  })
  return second.ok ? { ...second, cuts } : second
}
