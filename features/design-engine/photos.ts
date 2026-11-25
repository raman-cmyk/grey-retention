import type { Browser } from '@playwright/test'
import { loadableOrigins } from '@/lib/sandbox/browser.mjs'
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
 * paid service; a smart crop stays out of scope). A photo is fetched by
 * the server itself (only https from the allowed origins, never a
 * redirect, at most 8 MB, PNG, JPEG, WebP or GIF), handed to a locked
 * page as an inline picture (every request blocked, no navigation), and
 * the page reads its size and draws the **centre** of it at the slot's
 * shape on a canvas (JPEG). Nothing in the photo can run: it is a
 * picture, drawn by the browser's own image code.
 */

export const photoLimits = {
  bytes: 8 * 1024 * 1024,
  /** One photo's fetch and drawing. */
  ms: 20_000,
  /** The longest side of a cut photo, px (twice a 600 px email's widest). */
  side: 1_200
} as const

export type PhotoSize = { width: number; height: number }

const imageType = /^image\/(?:png|jpeg|webp|gif)$/i
const inlinePicture =
  /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/]+={0,2}$/i

export type PhotoTools = {
  /** A photo's own size, or null when it cannot be read. */
  sizeOf: (src: string) => Promise<PhotoSize | null>
  /** The photo's centre at `width` × `height` (as an inline JPEG), or null. */
  cropTo: (
    photo: SwapPicture,
    width: number,
    height: number
  ) => Promise<SwapPicture | null>
}

export function photoTools(
  browser: Browser,
  options: { origins?: readonly string[]; fetcher?: typeof fetch } = {}
): PhotoTools {
  const allowed = loadableOrigins(options.origins ?? [])
  const fetcher = options.fetcher ?? fetch
  /** The photo as an inline picture, or null. */
  const inline = async (src: string): Promise<string | null> => {
    if (src.startsWith('data:')) return inlinePicture.test(src) ? src : null
    let url: URL
    try {
      url = new URL(src)
    } catch {
      return null
    }
    if (url.protocol !== 'https:' || !allowed.has(url.origin)) return null
    try {
      const got = await fetcher(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(photoLimits.ms)
      })
      const type = (got.headers.get('content-type') ?? '').split(';')[0]!
      if (!got.ok || !imageType.test(type.trim())) return null
      const size = Number(got.headers.get('content-length') ?? 0)
      if (size > photoLimits.bytes) return null
      const bytes = Buffer.from(await got.arrayBuffer())
      if (bytes.byteLength > photoLimits.bytes) return null
      return `data:${type.trim().toLowerCase()};base64,${bytes.toString('base64')}`
    } catch {
      return null
    }
  }
  /** Runs `work` with the photo in a locked page (scripts only ours). */
  const inPage = async <T>(
    picture: string,
    work: (page: import('@playwright/test').Page) => Promise<T>
  ): Promise<T | null> => {
    const context = await browser.newContext({
      viewport: { width: 400, height: 400 },
      javaScriptEnabled: true,
      serviceWorkers: 'block'
    })
    try {
      const page = await context.newPage()
      await page.route('**/*', (route) =>
        route.request().url().startsWith('data:') &&
        !route.request().isNavigationRequest()
          ? route.continue().catch(() => {})
          : route.abort().catch(() => {})
      )
      await page.setContent('<!doctype html><html><body></body></html>', {
        timeout: photoLimits.ms
      })
      const loaded = await page.evaluate(
        (src) =>
          new Promise<boolean>((resolve) => {
            const img = new Image()
            img.id = 'photo'
            img.onload = () => {
              document.body.appendChild(img)
              resolve(img.naturalWidth > 0 && img.naturalHeight > 0)
            }
            img.onerror = () => resolve(false)
            img.src = src
          }),
        picture
      )
      if (!loaded) return null
      return await work(page)
    } catch {
      return null
    } finally {
      await context.close().catch(() => {})
    }
  }
  return {
    async sizeOf(src) {
      const picture = await inline(src)
      if (!picture) return null
      return inPage(picture, (page) =>
        page.evaluate(() => {
          const img = document.getElementById('photo') as HTMLImageElement
          return { width: img.naturalWidth, height: img.naturalHeight }
        })
      )
    },
    async cropTo(photo, width, height) {
      if (!(width > 0 && height > 0)) return null
      const picture = await inline(photo.src)
      if (!picture) return null
      const scale = Math.min(2, photoLimits.side / Math.max(width, height))
      const out = await inPage(picture, (page) =>
        page.evaluate(
          ({ w, h }) => {
            const img = document.getElementById('photo') as HTMLImageElement
            const nw = img.naturalWidth
            const nh = img.naturalHeight
            // The centre of the photo at the slot's shape, never stretched.
            const want = w / h
            const sw = nw / nh > want ? nh * want : nw
            const sh = nw / nh > want ? nh : nw / want
            const ow = Math.max(1, Math.min(Math.round(w), Math.round(sw)))
            const oh = Math.max(1, Math.round(ow / want))
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
            return canvas.toDataURL('image/jpeg', 0.86)
          },
          { w: width * scale, h: height * scale }
        )
      )
      if (!out || !inlinePicture.test(out)) return null
      return { src: out, width, height, alt: photo.alt }
    }
  }
}

/** Fills in the sizes of photos whose size is not known (0), dropping unreadable ones. */
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
    if (size) out.push({ ...p, ...size })
  }
  return out
}

/**
 * The brand swap with real cuts: a first pass records which photo each
 * slot wants at which shape, the photos are cut (centre, canvas), and the
 * swap runs again with those cuts (a cut that failed leaves its slot to a
 * photo of the right shape, or to a library block, with the reason).
 */
export async function swapWithCrops(
  input: SwapInput,
  tools: PhotoTools
): Promise<SwapResult> {
  const key = (p: SwapPicture, w: number, h: number) =>
    `${p.src.length}:${p.src.slice(-64)}:${Math.round(w)}x${Math.round(h)}`
  const wanted = new Map<string, { photo: SwapPicture; w: number; h: number }>()
  const recorder: Cropper = (photo, w, h) => {
    wanted.set(key(photo, w, h), { photo, w, h })
    return {
      ...photo,
      src: `https://crop.invalid/${wanted.size}`,
      width: w,
      height: h
    }
  }
  const first = swapBrand({ ...input, cropper: recorder })
  if (!first.ok) return first
  const cuts = new Map<string, SwapPicture | null>()
  for (const [k, want] of wanted)
    cuts.set(k, await tools.cropTo(want.photo, want.w, want.h))
  return swapBrand({
    ...input,
    cropper: (photo, w, h) => cuts.get(key(photo, w, h)) ?? null
  })
}
