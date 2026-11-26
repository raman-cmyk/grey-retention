import { createHash } from 'node:crypto'
import { browserLimits, markedHtml } from '@/features/design-engine/browser'
import {
  loadPicture,
  photoWords,
  sniffType,
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
  /** Its bytes' SHA-256, so a retry knows it is the same picture. */
  sha256: string
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
      /** Kept only for an own design (another brand's are never kept). */
      bytes: Buffer | null
      sha256: string
      width: number
      height: number
      from: 'file' | 'web'
    }
  | { ok: false; host: string; why: string }

function hostOf(src: string) {
  if (/^(?:cid|data):/i.test(src)) return 'the file'
  try {
    return new URL(src).hostname.replace(/^www\./, '') || 'an unknown site'
  } catch {
    return 'an unknown site'
  }
}

const over3 = 'it is larger than 3 MB'
/** Why a picture inside the file cannot be used, in the file's own words. */
const fileWords = (why: string) =>
  why === photoWords.type || why === photoWords.pixels || why === over3
    ? why
    : 'it could not be read from the file'

const tooMany = 'the email has more pictures than GROS keeps (40)'
const tooHeavy = 'the email’s pictures are larger than 24 MB in all'

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
  // Each picture once, and no more than are ever read: the scan stops at
  // the cap (an email of 60,000 tags is read in one pass).
  const cap = uploadLimits.pictures * 2
  const seen = new Set<string>()
  let more = false
  for (const m of html.matchAll(imgTag)) {
    const a = srcAttr.exec(m[0])
    const src = decodeAttr(a?.[1] ?? a?.[2] ?? a?.[3] ?? '')
    if (!src || seen.has(src)) continue
    if (seen.size >= cap) {
      more = true
      break
    }
    seen.add(src)
  }
  const sources = [...seen]
  const until = Date.now() + (options.budgetMs ?? uploadLimits.fetchBudgetMs)
  // Every byte read counts against the budget, kept or not.
  let budget = uploadLimits.picturesBytes
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
      // Its type from its first bytes, never what the part says it is.
      const type = sniffType(part.bytes)
      if (!type) return { ok: false, host: 'the file', why: photoWords.type }
      if (part.bytes.byteLength > uploadLimits.pictureBytes)
        return { ok: false, host: 'the file', why: over3 }
      inline = `data:${type};base64,${Buffer.from(part.bytes).toString('base64')}`
    } else if (/^data:/i.test(src)) {
      const m = /^data:([^;,]*)(;base64)?,([\s\S]*)$/i.exec(src)
      if (!m || !m[2])
        return { ok: false, host: 'the file', why: photoWords.type }
      const body = m[3]!.replace(/\s+/g, '')
      if (body.length > (uploadLimits.pictureBytes * 4) / 3 + 4)
        return { ok: false, host: 'the file', why: over3 }
      const type = sniffType(Buffer.from(body.slice(0, 64), 'base64'))
      if (!type) return { ok: false, host: 'the file', why: photoWords.type }
      inline = `data:${type};base64,${body}`
    } else {
      from = 'web'
      if (Date.now() > until)
        return { ok: false, host: hostOf(src), why: photoWords.fetch }
    }
    if (budget <= 0) return { ok: false, host: hostOf(src), why: tooHeavy }
    const left = budget
    const got = await loadPicture(inline, {
      origins,
      open: options.open,
      maxBytes: Math.min(uploadLimits.pictureBytes, left)
    })
    if ('failed' in got)
      return {
        ok: false,
        host: hostOf(src),
        why:
          from === 'file'
            ? fileWords(got.failed)
            : got.failed === over3 && left < uploadLimits.pictureBytes
              ? tooHeavy
              : got.failed
      }
    budget -= got.bytes.byteLength
    return {
      ok: true,
      type: got.type,
      // Another brand's picture: only its size is kept (rule 8).
      bytes: design === 'own' ? got.bytes : null,
      sha256: createHash('sha256').update(got.bytes).digest('hex'),
      width: got.size.width,
      height: got.size.height,
      from
    }
  }
  // A few at a time: the fetches are bounded, each and in all.
  const results = new Map<string, Read>()
  const queue = [...sources]
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
  const miss = (host: string, why: string) => {
    const key = `${host}\u0000${why}`
    const m = missing.get(key) ?? { host, count: 0, why }
    m.count++
    missing.set(key, m)
  }
  if (more) miss('the file', tooMany)
  let measured = 0
  for (const src of sources) {
    const r = results.get(src)!
    if (!r.ok) {
      miss(r.host, r.why)
      continue
    }
    if (design === 'own' && r.bytes) {
      if (pictures.length >= uploadLimits.pictures) {
        miss(hostOf(src), tooMany)
        continue
      }
      pictures.push({
        index: pictures.length,
        type: r.type,
        width: r.width,
        height: r.height,
        bytes: r.bytes,
        sha256: r.sha256,
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
