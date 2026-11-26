import { browserLimits, markedHtml } from '@/features/design-engine/browser'
import {
  loadPicture,
  photoWords,
  uploadPhotoOrigins,
  type PhotoOpener
} from '@/features/design-engine/photos'
import type { UploadDesign } from './limits'
import { uploadLimits } from './limits'

/**
 * DES-ENGINE-003: an uploaded email made ready to measure and keep. Every
 * `<img>` of the file is read once:
 * - a picture **inside the file** (an inline `data:` picture, or an .eml's
 *   `cid:` part) is read from the file itself;
 * - a picture **on the web** is fetched by the server only from the fixed
 *   list of email-tool picture hosts (`uploadPhotoOrigins`: Shopify,
 *   Klaviyo, Mailchimp), each address checked first (no private network
 *   address, no redirect, at most 8 MB, `photos.ts loadPicture`); a
 *   picture on any other site is never fetched and is listed in
 *   `missing` with its site, so the owner can be told in plain words;
 * - every picture read is checked (PNG, JPEG, WebP or GIF by its first
 *   bytes, its size from its header) and drawn as an empty picture of
 *   its own size, its placeholder address
 *   (`https://email-uploads.invalid/<n>.<ext>`) kept beside it, so the
 *   measuring browser lays out its exact box without loading anything.
 * For the brand's **own design** the pictures are kept (`pictures`, the
 * bytes the server stores beside the file); for **another brand's email**
 * nothing of its pictures is kept (rule 8), only their sizes for the
 * measuring. The result is marked into sections by the inbox's splitter.
 * Never throws; nothing in the file runs.
 */

export const placeholderHost = 'email-uploads.invalid'

const extensions: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp'
}

/** The placeholder a kept (or measured) picture has in the prepared HTML. */
export const picturePlaceholder = (index: number, type: string) =>
  `https://${placeholderHost}/${index}.${extensions[type] ?? 'png'}`

/** The picture index a placeholder names, or null. */
export function placeholderIndex(src: string | null | undefined) {
  const m =
    /^https:\/\/email-uploads\.invalid\/(\d{1,2})\.(?:png|jpg|gif|webp)$/.exec(
      src ?? ''
    )
  return m ? Number(m[1]) : null
}

export type PreparedPicture = {
  index: number
  type: string
  width: number
  height: number
  bytes: Buffer
  from: 'file' | 'web'
}

export type MissingPicture = { host: string; count: number; why: string }

export type Prepared =
  | {
      ok: true
      /** Marked, every picture read at its placeholder. */
      html: string
      /** Kept pictures (own design only). */
      pictures: PreparedPicture[]
      /** Pictures that could not be read, by site. */
      missing: MissingPicture[]
    }
  | { ok: false; code: 'too_large_to_measure' }

const imgTag = /<img\b[^>]*>/gi
const srcAttr = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i
const decodeAttr = (v: string) =>
  v
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .trim()

type Read =
  | {
      ok: true
      type: string
      bytes: Buffer
      width: number
      height: number
      from: 'file' | 'web'
    }
  | { ok: false; host: string; why: string }

function hostOf(src: string) {
  if (/^cid:/i.test(src)) return 'the file'
  try {
    return new URL(src).hostname.replace(/^www\./, '') || 'an unknown site'
  } catch {
    return 'an unknown site'
  }
}

export async function prepareUpload(
  html: string,
  related: readonly { contentId: string; type: string; bytes: Uint8Array }[],
  design: UploadDesign,
  options: {
    open?: PhotoOpener
    origins?: readonly string[]
    budgetMs?: number
  } = {}
): Promise<Prepared> {
  const origins = options.origins ?? uploadPhotoOrigins
  const byCid = new Map(related.map((r) => [r.contentId, r]))
  const sources: string[] = []
  for (const tag of html.match(imgTag) ?? []) {
    const m = srcAttr.exec(tag)
    const src = decodeAttr(m?.[1] ?? m?.[2] ?? m?.[3] ?? '')
    if (src && !sources.includes(src)) sources.push(src)
  }
  const until = Date.now() + (options.budgetMs ?? uploadLimits.fetchBudgetMs)
  const read = async (src: string): Promise<Read> => {
    let inline = src
    let from: 'file' | 'web' = 'file'
    if (/^cid:/i.test(src)) {
      let id = src.slice(4).trim()
      try {
        id = decodeURIComponent(id)
      } catch {
        // kept as written
      }
      const part = byCid.get(id.replace(/^<|>$/g, '').toLowerCase())
      if (!part)
        return { ok: false, host: 'the file', why: 'it is not inside the file' }
      inline = `data:${part.type || 'image/png'};base64,${Buffer.from(part.bytes).toString('base64')}`
    } else if (!/^data:/i.test(src)) {
      from = 'web'
      if (Date.now() > until)
        return { ok: false, host: hostOf(src), why: photoWords.fetch }
    }
    const got = await loadPicture(inline, { origins, open: options.open })
    if ('failed' in got)
      return { ok: false, host: hostOf(src), why: got.failed }
    return {
      ok: true,
      type: got.type,
      bytes: got.bytes,
      width: got.size.width,
      height: got.size.height,
      from
    }
  }
  // A few at a time: the fetches are bounded, each and in all.
  const results = new Map<string, Read>()
  const queue = sources.slice(0, uploadLimits.pictures * 2)
  for (const src of sources.slice(queue.length))
    results.set(src, {
      ok: false,
      host: hostOf(src),
      why: 'the email has too many pictures'
    })
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let src = queue.shift(); src !== undefined; src = queue.shift())
        results.set(src, await read(src))
    })
  )
  const pictures: PreparedPicture[] = []
  const index = new Map<
    string,
    { n: number; type: string; width: number; height: number }
  >()
  const missing = new Map<string, MissingPicture>()
  let measured = 0
  let keptBytes = 0
  for (const src of sources) {
    const r = results.get(src)!
    if (!r.ok) {
      const key = `${r.host}\u0000${r.why}`
      const m = missing.get(key) ?? { host: r.host, count: 0, why: r.why }
      m.count++
      missing.set(key, m)
      continue
    }
    if (design === 'own') {
      if (
        pictures.length >= uploadLimits.pictures ||
        r.bytes.byteLength > uploadLimits.pictureBytes ||
        keptBytes + r.bytes.byteLength > uploadLimits.picturesBytes
      ) {
        const why =
          r.bytes.byteLength > uploadLimits.pictureBytes
            ? 'it is larger than 3 MB'
            : 'the email has too many pictures'
        const key = `${hostOf(src)}\u0000${why}`
        const m = missing.get(key) ?? { host: hostOf(src), count: 0, why }
        m.count++
        missing.set(key, m)
        continue
      }
      keptBytes += r.bytes.byteLength
      pictures.push({
        index: pictures.length,
        type: r.type,
        width: r.width,
        height: r.height,
        bytes: r.bytes,
        from: r.from
      })
      index.set(src, {
        n: pictures.length - 1,
        type: r.type,
        width: r.width,
        height: r.height
      })
    } else {
      index.set(src, {
        n: measured++,
        type: r.type,
        width: r.width,
        height: r.height
      })
    }
  }
  // Marked first (the file's own marks, if any, are removed), then each
  // picture read is swapped for an empty drawing of its own size, its
  // placeholder kept beside it (`data-de-src`, our own mark, as the
  // measuring tool's held pictures): the browser lays it out exactly as
  // the picture, and loads nothing.
  const marked = markedHtml(html, false).replace(imgTag, (tag) => {
    const m = srcAttr.exec(tag)
    const src = decodeAttr(m?.[1] ?? m?.[2] ?? m?.[3] ?? '')
    const pic = index.get(src)
    if (!m || !pic) return tag
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${pic.width}" height="${pic.height}"/>`
    ).toString('base64')
    // A function, so `$&` in an address is never expanded.
    return tag.replace(
      srcAttr,
      () =>
        ` src="data:image/svg+xml;base64,${svg}" data-de-src="${picturePlaceholder(pic.n, pic.type)}"`
    )
  })
  if (Buffer.byteLength(marked) > browserLimits.inputBytes)
    return { ok: false, code: 'too_large_to_measure' }
  return {
    ok: true,
    html: marked,
    pictures,
    missing: [...missing.values()].slice(0, 20)
  }
}
