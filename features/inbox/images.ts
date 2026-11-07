/**
 * The images an email's HTML uses (INB-002): <img src>, srcset, the old
 * `background` attribute and CSS url(...) in style attributes and <style>
 * blocks. Each distinct reference counts once, in order of appearance, at
 * most `maxImages`.
 */

export const maxImages = 60

export type ImageRef = {
  ordinal: number
  /** remote: an http(s) link; cid: a part of the email; inline: data: URI. */
  source: 'remote' | 'cid' | 'inline'
  /** Exactly as written in the HTML (so the stored copy can replace it). */
  ref: string
  /** The link to download, the Content-ID, or the data: URI, decoded. */
  target: string
}

const entities: Record<string, string> = {
  amp: '&',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  '#39': "'",
  '#x27': "'",
  '#34': '"'
}
/** Decodes the few entities that appear inside attribute values. */
const decode = (value: string) =>
  value.replace(/&(amp|quot|apos|lt|gt|#39|#x27|#34);/gi, (_, e: string) =>
    String(entities[e.toLowerCase()])
  )

/** Attribute values in one tag, e.g. src="..." or srcset='...'. */
function attributes(tag: string, names: string[]) {
  const out: string[] = []
  const pattern = new RegExp(
    `\\s(${names.join('|')})\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`,
    'gi'
  )
  for (const m of tag.matchAll(pattern)) out.push(m[3] ?? m[4] ?? m[5] ?? '')
  return out
}

const cssUrls = (css: string) =>
  [...css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)].map((m) => m[2]!)

/**
 * Every distinct image reference in the HTML. Links that are not http(s),
 * cid: or data:image are left out (nothing to keep).
 */
export function imageRefs(html: string): ImageRef[] {
  const raw: string[] = []
  // Tags are read one at a time; "[^<>]*" never rescans the rest.
  for (const m of html.matchAll(
    /<(img|source|td|table|body|div|v:image|v:fill)\b[^<>]*>/gi
  )) {
    const tag = m[0]
    raw.push(...attributes(tag, ['src', 'background']))
    for (const set of attributes(tag, ['srcset']))
      for (const part of set.split(','))
        raw.push(part.trim().split(/\s+/)[0] ?? '')
    // In a style attribute the quotes around a URL are often &quot;.
    for (const style of attributes(tag, ['style']))
      raw.push(...cssUrls(decode(style)))
  }
  for (const m of html.matchAll(/<style\b[^<>]*>([^<]*)<\/style>/gi))
    raw.push(...cssUrls(m[1] ?? ''))

  const seen = new Set<string>()
  const refs: ImageRef[] = []
  for (const value of raw) {
    const ref = value.trim()
    if (
      !ref ||
      seen.has(ref) ||
      (ref.length > 2000 && !ref.startsWith('data:'))
    )
      continue
    const target = decode(ref)
    let source: ImageRef['source'] | null = null
    if (/^https?:\/\//i.test(target)) source = 'remote'
    else if (/^cid:/i.test(target)) source = 'cid'
    else if (/^data:image\//i.test(target)) source = 'inline'
    if (!source) continue
    seen.add(ref)
    refs.push({
      ordinal: refs.length + 1,
      source,
      ref,
      target: source === 'cid' ? target.slice(4).replace(/^<|>$/g, '') : target
    })
    if (refs.length === maxImages) break
  }
  return refs
}

/** Decodes a base64 data:image URI; null when it is not one. */
export function dataUri(uri: string): Uint8Array | null {
  const m = /^data:image\/[a-z0-9.+-]+;base64,([a-z0-9+/=\s]+)$/i.exec(uri)
  if (!m) return null
  return new Uint8Array(Buffer.from(m[1]!.replace(/\s+/g, ''), 'base64'))
}

export type ImageType = { contentType: string; ext: string }

/**
 * The image type from its first bytes (never the server's word): PNG,
 * JPEG, GIF or WebP. SVG and anything else is not kept.
 */
export function sniffImage(bytes: Uint8Array): ImageType | null {
  const b = bytes
  if (
    b.length >= 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47
  )
    return { contentType: 'image/png', ext: 'png' }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
    return { contentType: 'image/jpeg', ext: 'jpg' }
  if (
    b.length >= 6 &&
    b[0] === 0x47 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x38
  )
    return { contentType: 'image/gif', ext: 'gif' }
  if (
    b.length >= 12 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  )
    return { contentType: 'image/webp', ext: 'webp' }
  return null
}
