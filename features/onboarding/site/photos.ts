import { parse, type DefaultTreeAdapterTypes as T } from 'parse5'
import { importable } from '@/features/klaviyo-push/html'
import type { SitePageKind } from '../findings'
import { absolute, landmarks, largestOfSet, words } from './logos'

/**
 * The photo library's site part (owner pick #59, ONB-059a): the product
 * and lifestyle photos on one of the brand's own pages, each tagged for
 * reuse. Pure: the Site reader fetches the pages (ONB-059b keeps the
 * photos, with the catalog's own pictures). Only photos an email could
 * show: a JPEG or PNG address on a public host, over https on the
 * standard port. Never the brand's logo or wordmark, an icon, a badge,
 * a seal, another brand's logo, a customer's review photo, a hidden or
 * tracking picture, or a picture of the page's header, menu or footer.
 * Every attribute is untrusted: long ones are cut before they are read.
 */

export type PhotoKind = 'product' | 'lifestyle'

export type SitePhoto = {
  /** Absolute https, JPEG or PNG. */
  url: string
  /** Its own description on the page, when it has one (untrusted text). */
  alt: string | null
  /** A product photo, or one of the brand's world (people, places, use). */
  kind: PhotoKind
  /** The page it was found on. */
  page: SitePageKind
  /** Where: the product's structured data, the page's share picture, or the page itself. */
  from: 'schema' | 'share' | 'page'
}

/** Most photos kept per page. */
export const maxPhotosPerPage = 30
/** A picture whose stated width or height is smaller is an icon. */
export const minPhotoSide = 200
/** Longest address kept. */
const maxPhotoUrl = 1_000
/** Most pictures looked at per page, before the same ones are joined. */
const maxFound = 500
/** Longest attribute read for its words. */
const maxAttr = 500
/** Longest description kept (characters, never half of one). */
const maxAlt = 200
/** Longest structured data read. */
const maxSchema = 1_000_000

type Node = T.ChildNode | T.ParentNode
const isElement = (n: Node): n is T.Element => 'tagName' in n
const attr = (n: T.Element, name: string) =>
  n.attrs.find((a) => a.name === name)?.value ?? null
/** An attribute cut to what is read for its words. */
const short = (n: T.Element, name: string) =>
  attr(n, name)?.slice(0, maxAttr) ?? null
const children = (n: Node): T.ChildNode[] =>
  'childNodes' in n ? n.childNodes : []
const textOf = (n: Node): string =>
  n.nodeName === '#text'
    ? (n as T.TextNode).value
    : children(n).map(textOf).join('')

/** Words in a picture's own name or label that say it is no brand photo. */
const notPhotos = new Set([
  'logo',
  'logos',
  'wordmark',
  'logotype',
  'monogram',
  'favicon',
  'icon',
  'icons',
  'badge',
  'badges',
  'seal',
  'seals',
  'certified',
  'flag',
  'flags',
  'sprite',
  'swatch',
  'swatches',
  'placeholder',
  'spacer',
  'blank',
  'transparent',
  'lazy',
  'spinner',
  'loader',
  'loading',
  'pixel',
  'avatar',
  'rating',
  'stars',
  'payment',
  'arrow',
  'chevron'
])

/** Words of a lazy picture's stand-in, never its real address. */
const placeholders = new Set([
  'placeholder',
  'spacer',
  'blank',
  'transparent',
  'lazy',
  'pixel',
  'loader',
  'loading',
  'spinner'
])

/**
 * Boxes whose pictures are not the brand's photos: other brands' logos
 * (press, partners, payment marks, seals), feeds and customers' review
 * photos. "Featured" alone is a store's own section ("featured
 * collection"); "featured in" is press.
 */
const notBrandBoxes = new Set([
  'press',
  'partner',
  'partners',
  'client',
  'clients',
  'sponsor',
  'sponsors',
  'trust',
  'badges',
  'payment',
  'payments',
  'logo',
  'logos',
  'awards',
  'retailers',
  'stockists',
  'social',
  'instagram',
  'certifications',
  'certification',
  'seals',
  'review',
  'reviews',
  'testimonial',
  'testimonials',
  'ugc',
  'jdgm',
  'judgeme',
  'yotpo',
  'okendo',
  'stamped',
  'loox'
])

/** Words of a file name that say nothing of what it shows. */
const noise =
  /^(?:jpe?g|png|progressive|\d+|\d*x\d*|\dx|v\d*|copy|final|new|img|image)$/

const ipv4 = /^\d{1,3}(?:\.\d{1,3}){3}$/
/** A host every subscriber can reach: a public name, never a private one. */
const publicHost = (host: string) =>
  host.includes('.') &&
  !ipv4.test(host) &&
  !/(?:^|\.)(?:localhost|local|internal|intranet|lan|home|corp)$/i.test(host)

/**
 * An address the library keeps and an email can show: https on the
 * standard port, no name or password, a public host, a JPEG or PNG file
 * (named so, and not asked for in another format), no size template,
 * at most `maxPhotoUrl` characters.
 */
export function emailPhotoUrl(url: string): boolean {
  if (
    url.length > maxPhotoUrl ||
    !/^https:\/\/[^/:?#@]+(?:[/?#]|$)/.test(url) ||
    !importable(url) ||
    /[{}]|%7b|%7d/i.test(url)
  )
    return false
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (!publicHost(u.hostname) || !/\.(?:jpe?g|png)$/i.test(u.pathname))
    return false
  // Another format asked for in the address: `?format=webp`, `/f_webp/`.
  for (const name of ['format', 'fm']) {
    const v = u.searchParams.get(name)
    if (v !== null && !/^(?:jpe?g|pjpg|png)$/i.test(v)) return false
  }
  return !/\/f_(?!auto|jpe?g|png)[a-z0-9]+[,/]/i.test(u.pathname)
}

const sizeSuffix =
  /_(?:\d+x\d*|\d*x\d+|pico|icon|thumb|small|compact|medium|large|grande|original|master)(?:_crop_[a-z]+)?(?:@\dx)?(?:\.progressive)?(?=\.(?:jpe?g|png)$)/i

/** The same photo at another size is one photo (`?width=800`, `_400x`, `@2x`). */
function photoKey(url: string) {
  const u = new URL(url)
  for (const p of ['width', 'height', 'crop', 'v']) u.searchParams.delete(p)
  const path = u.pathname
    .replace(sizeSuffix, '')
    .replace(/@\dx(?=\.(?:jpe?g|png)$)/i, '')
  return `${u.hostname}${path}${u.search}`
}

/** How wide a size variant says it is; the original (no size) is the largest. */
function widthOf(url: string) {
  const u = new URL(url)
  const w = Number.parseInt(u.searchParams.get('width') ?? '', 10)
  if (Number.isFinite(w)) return w
  const m =
    /_(\d*)x(\d*)(?:_crop_[a-z]+)?(?:@(\d)x)?(?:\.progressive)?\.(?:jpe?g|png)$/i.exec(
      u.pathname
    )
  if (m && (m[1] || m[2]))
    return Math.max(Number(m[1] || 0), Number(m[2] || 0)) * Number(m[3] ?? 1)
  return Number.POSITIVE_INFINITY
}

const productTypes =
  /(?:^|[/:#])(?:Product|ProductGroup|ProductModel|IndividualProduct)$/i

/**
 * The pictures of every product in structured data: an address, an
 * `ImageObject` (its `contentUrl` or `url`, whichever is an address), or
 * a reference to one elsewhere in the data (`{"@id": …}`).
 */
function schemaImages(json: unknown): string[] {
  const ids = new Map<string, string>()
  const linkOf = (o: Record<string, unknown>) =>
    [o.contentUrl, o.url].find((v): v is string => typeof v === 'string')
  const visit = (
    v: unknown,
    seen: (o: Record<string, unknown>) => void,
    depth = 0
  ) => {
    if (depth > 12 || !v || typeof v !== 'object') return
    if (Array.isArray(v)) {
      for (const item of v.slice(0, 200)) visit(item, seen, depth + 1)
      return
    }
    const o = v as Record<string, unknown>
    seen(o)
    for (const value of Object.values(o)) visit(value, seen, depth + 1)
  }
  visit(json, (o) => {
    const link = linkOf(o)
    if (typeof o['@id'] === 'string' && link) ids.set(o['@id'], link)
  })
  const out: string[] = []
  const pictures = (image: unknown, depth = 0) => {
    if (depth > 4 || out.length >= 50) return
    if (typeof image === 'string') out.push(image)
    else if (Array.isArray(image))
      for (const i of image.slice(0, 50)) pictures(i, depth + 1)
    else if (image && typeof image === 'object') {
      const o = image as Record<string, unknown>
      const link =
        linkOf(o) ?? (typeof o['@id'] === 'string' ? ids.get(o['@id']) : null)
      if (link) out.push(link)
    }
  }
  visit(json, (o) => {
    const types = ([] as unknown[]).concat(o['@type'] ?? [])
    if (types.some((t) => typeof t === 'string' && productTypes.test(t)))
      pictures(o.image)
  })
  return out
}

/** A description cut to `maxAlt` characters, never inside one. */
function altText(alt: string | null) {
  const text = alt?.slice(0, maxAttr).replace(/\s+/g, ' ').trim()
  return text ? Array.from(text).slice(0, maxAlt).join('') : null
}

/**
 * The photos on one page, surest first: the product's structured data,
 * then its share picture, then the pictures in the page itself (one per
 * picture element, its largest size; lazy pictures by their real
 * address). On a product page every photo is a product photo; elsewhere
 * a picture in a product card or linking to one of the brand's product
 * pages is, and the rest are lifestyle photos. The same photo at several
 * sizes is kept once, at its largest.
 */
export function sitePhotos(
  html: string,
  page: string,
  kind: SitePageKind,
  { brand = '' }: { brand?: string } = {}
): SitePhoto[] {
  let site: URL
  try {
    site = new URL(page)
  } catch {
    return []
  }
  const host = site.hostname.replace(/^www\./, '')
  const brandWords = new Set([
    ...words(brand.slice(0, 120)),
    words(brand.slice(0, 120)).join(''),
    host.split('.')[0] ?? ''
  ])
  brandWords.delete('')
  const pageKind: PhotoKind = kind === 'product' ? 'product' : 'lifestyle'
  const found: SitePhoto[] = []

  /** Whether a picture's own name, label or description says it is no brand photo. */
  const notAPhoto = (url: string, alt: string | null, labels: string[]) => {
    const file = words(new URL(url).pathname.slice(-maxAttr))
    const named = words(...labels)
    if (
      [...file, ...named, ...words(alt?.slice(0, maxAttr) ?? null)].some(
        (w) => w === 'logo'
      )
    )
      return true
    // Brand words never count ("Icon Apparel" is a name).
    if ([...file, ...named].some((w) => notPhotos.has(w) && !brandWords.has(w)))
      return true
    // A file, or a description, naming only the brand is its wordmark.
    const onlyBrand = (all: string[]) => {
      const meaning = all.filter((w) => !noise.test(w))
      return meaning.length > 0 && meaning.every((w) => brandWords.has(w))
    }
    const name = new URL(url).pathname.split('/').pop() ?? ''
    return (
      onlyBrand(words(name.slice(-maxAttr))) ||
      onlyBrand(words(alt?.slice(0, maxAttr) ?? null))
    )
  }
  const add = (
    url: string | null,
    from: SitePhoto['from'],
    photoKind: PhotoKind,
    alt: string | null = null,
    labels: string[] = []
  ) => {
    if (found.length >= maxFound || !url || !emailPhotoUrl(url)) return
    if (notAPhoto(url, alt, labels)) return
    found.push({ url, alt: altText(alt), kind: photoKind, page: kind, from })
  }
  /** The real address of a picture: its largest size first, never a lazy placeholder. */
  const addressOf = (c: T.Element) => {
    for (const s of [
      largestOfSet(attr(c, 'srcset')),
      largestOfSet(attr(c, 'data-srcset')),
      attr(c, 'data-src'),
      attr(c, 'data-lazy-src'),
      attr(c, 'data-original'),
      attr(c, 'src')
    ]) {
      const url = absolute(s, page)
      if (
        url &&
        emailPhotoUrl(url) &&
        !words(new URL(url).pathname.slice(-maxAttr)).some(
          (w) => placeholders.has(w) && !brandWords.has(w)
        )
      )
        return url
    }
    return null
  }
  const small = (c: T.Element) =>
    ['width', 'height'].some((a) => {
      const v = short(c, a)
      if (v === null || v.includes('%')) return false
      const n = Number.parseInt(v, 10)
      return Number.isFinite(n) && n < minPhotoSide
    })
  const hidden = (c: T.Element) =>
    c.attrs.some((a) => a.name === 'hidden') ||
    attr(c, 'aria-hidden') === 'true' ||
    /display\s*:\s*none|visibility\s*:\s*hidden/i.test(short(c, 'style') ?? '')
  const labelsOf = (c: T.Element) =>
    [short(c, 'class'), short(c, 'id'), short(c, 'aria-label')].filter(
      (l): l is string => l !== null
    )
  /** A link to one of the brand's own product pages. */
  const productLink = (href: string | null) => {
    if (!href) return false
    try {
      const u = new URL(href.slice(0, maxAttr), page)
      return (
        u.hostname.replace(/^www\./, '') === host &&
        /\/products?\/[^/]+/i.test(u.pathname)
      )
    } catch {
      return false
    }
  }
  const picture = (
    c: T.Element,
    at: { product: boolean },
    sources: T.Element[]
  ) => {
    if (hidden(c) || small(c)) return
    add(
      sources
        .map((s) =>
          absolute(
            largestOfSet(attr(s, 'srcset') ?? attr(s, 'data-srcset')),
            page
          )
        )
        .find((u) => u && emailPhotoUrl(u)) ?? addressOf(c),
      'page',
      at.product ? 'product' : pageKind,
      attr(c, 'alt'),
      labelsOf(c)
    )
  }

  type Place = { chrome: boolean; others: boolean; product: boolean }
  const doc = parse(html.slice(0, 2_000_000))
  // Walked with a list, not recursion: a page nested thousands deep is
  // still read.
  const stack: [T.ChildNode, Place][] = children(doc)
    .map((c): [T.ChildNode, Place] => [
      c,
      { chrome: false, others: false, product: false }
    ])
    .reverse()
  while (stack.length && found.length < maxFound) {
    const [c, at] = stack.pop()!
    if (!isElement(c)) continue
    const tag = c.tagName
    if (tag === 'script') {
      if ((attr(c, 'type') ?? '').toLowerCase() === 'application/ld+json')
        try {
          for (const u of schemaImages(
            JSON.parse(textOf(c).slice(0, maxSchema))
          ))
            add(absolute(u, page), 'schema', 'product')
        } catch {
          // Not readable structured data: the page's pictures still count.
        }
      continue
    }
    if (tag === 'meta') {
      const name = (
        short(c, 'property') ??
        short(c, 'name') ??
        ''
      ).toLowerCase()
      if (name === 'og:image' || name === 'twitter:image')
        add(absolute(attr(c, 'content'), page), 'share', pageKind)
      continue
    }
    if (
      ['video', 'audio', 'svg', 'iframe', 'object', 'template'].includes(tag) ||
      hidden(c)
    )
      continue
    const labels = labelsOf(c)
    const own = words(...labels)
    const place: Place = {
      chrome:
        at.chrome || tag === 'header' || tag === 'nav' || tag === 'footer',
      others:
        at.others ||
        (!landmarks.has(tag) &&
          (own.some((w) => notBrandBoxes.has(w)) ||
            // "As featured in", "as seen on": press.
            (own.some((w) => w === 'featured' || w === 'seen') &&
              own.some((w) => w === 'in' || w === 'on')))),
      product:
        at.product ||
        (tag === 'a' && productLink(attr(c, 'href'))) ||
        (!landmarks.has(tag) &&
          own.some((w) => w === 'product' || w === 'products'))
    }
    // The header, menu, footer and boxes of other brands' pictures are
    // skipped; their structured data is still read.
    const skipped = place.chrome || place.others
    if (tag === 'picture') {
      if (skipped) continue
      const kids = children(c).filter(isElement)
      const img = kids.find((k) => k.tagName === 'img')
      // Only the sources an email can show (a JPEG or PNG, or no type).
      const sources = kids.filter(
        (k) =>
          k.tagName === 'source' &&
          /^(?:|image\/(?:jpe?g|png))$/i.test((short(k, 'type') ?? '').trim())
      )
      if (img) picture(img, place, sources)
      continue
    }
    if (tag === 'img') {
      if (!skipped) picture(c, place, [])
      continue
    }
    const kids = children(c)
    for (let i = kids.length - 1; i >= 0; i--) stack.push([kids[i]!, place])
  }

  // The same photo once, surest first, at its largest size, with the
  // description and product tag of any of its copies.
  const rank = { schema: 0, share: 1, page: 2 } as const
  const best = new Map<string, SitePhoto>()
  for (const p of [...found].sort((a, b) => rank[a.from] - rank[b.from])) {
    const key = photoKey(p.url)
    const was = best.get(key)
    if (!was) best.set(key, p)
    else
      best.set(key, {
        ...was,
        url: widthOf(p.url) > widthOf(was.url) ? p.url : was.url,
        alt: was.alt ?? p.alt,
        kind:
          was.kind === 'product' || p.kind === 'product' ? 'product' : was.kind
      })
  }
  return [...best.values()].slice(0, maxPhotosPerPage)
}
