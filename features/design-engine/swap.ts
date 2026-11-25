import type { BlockBrand } from '@/features/blocks/brand'
import {
  blueprintSchema,
  textOf,
  type Blueprint,
  type ButtonPart,
  type Column,
  type DividerPart,
  type ImagePart,
  type Item,
  type Part,
  type Section,
  type TextPart,
  type TextRun
} from './blueprint'
import { amount } from '@/features/assembly/amount'
import { limits } from './likeness'
import { lightness, paletteMapper, type PaletteMapper } from './palette'
import {
  cutTo,
  holdsFacts,
  wordPicker,
  type Lengthen,
  type WordPools,
  type WordRules
} from './words'

/**
 * DES-ENGINE-002 (step 2 of the email design plan, owner decision of 25
 * November 2026): the **brand swap**. A library email is copied 1:1 in
 * structure, so its blueprint keeps every section, column, width, gap,
 * text size, button and picture size and order; everything a reader sees
 * becomes the brand's own:
 * - colours: each colour role (page, body, fills, words, buttons, lines)
 *   becomes the brand's palette, readable (`palette.ts`);
 * - fonts: headings in the brand's heading font, the rest in its body
 *   font; sizes, weights, spacing and capitals stay (they are structure);
 *   the drawing code adds the safe fonts after them;
 * - the logo: the brand's logo at the original's height and place, never
 *   stretched (its own shape, never wider than the original's box);
 * - photos: catalog photos for product photos (in plan order), the
 *   brand's photos for the others, each only where its shape is the
 *   slot's (within 2 %) or a cropper can cut it to that shape; a picture
 *   no photo fits makes its section one built from the closest library
 *   block (`blocked`, with the reason);
 * - words: the brand's own (`words.ts`), prices, old prices and codes
 *   only from the facts, the footer from the brand with Klaviyo's tags;
 * - links: the brand's own (the product's page, else the store).
 *
 * Never a word, picture address, link, logo or name of the source in the
 * result: every part is rebuilt from the brand's content, and
 * `leaks.ts` checks the drawn email for anything of the source.
 */

export type SwapPicture = {
  /** https (or an inline picture, previews and tests only). */
  src: string
  width: number
  height: number
  alt: string
  /** Why the photo cannot be used (it could not be fetched or read), if so. */
  unusable?: string
}

export type SwapBrand = {
  name: string
  /** The store's home page (https). */
  site: string
  ink: string
  background: string
  accent: string
  dark: string
  /** Font family names: headings and the rest. */
  headingFont: string
  bodyFont: string
  logo: SwapPicture | null
  /** The logo for dark bands (light ink). */
  logoOnDark?: SwapPicture | null
  /** The brand's own photos (lifestyle, banners), for non-product pictures. */
  photos?: readonly SwapPicture[]
  /** The brand's small square icons (social links, features). */
  icons?: readonly (SwapPicture & { href?: string })[]
  /** Corner radius of its buttons, px. */
  radius?: number
  /** The store's address, for previews (Klaviyo writes its own). */
  address?: string | null
}

export type SwapProduct = {
  id: string
  title: string
  /** Formatted in the store's currency, e.g. "$24.00". */
  price: string
  /** A confirmed sale's old price, else null (never a permanent compare-at). */
  compareAt?: string | null
  url: string
  photo: SwapPicture | null
}

/** Cuts a photo to `width` × `height` (its shape), or null when it cannot. */
export type Cropper = (
  photo: SwapPicture,
  width: number,
  height: number
) => SwapPicture | { failed: string } | null

export type SwapInput = {
  source: Blueprint
  brand: SwapBrand
  /** The products the email shows, in plan order. */
  products: readonly SwapProduct[]
  words: WordPools
  rules: WordRules
  cropper?: Cropper | null
}

export type SwapResult =
  | {
      ok: true
      /** The source's structure with the brand's content. */
      target: Blueprint
      /** Sections the swap could not fill, and why (after "Section n (kind)"). */
      blocked: Map<number, string>
      /** The brand as the library blocks draw it. */
      blockBrand: BlockBrand
      /** More of the brand's words for a text that broke onto fewer lines. */
      lengthen: Lengthen
      /**
       * True when a footer of the copy carries Klaviyo's organisation,
       * address and unsubscribe tags. False (the original had no footer
       * text): the email build adds the library's Footer block.
       */
      footer: boolean
    }
  | { ok: false; error: string }

const safeFamily = (name: string, fallback: string) => {
  const clean = name
    .replace(/[^A-Za-z0-9 -]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
  return clean || fallback
}

/**
 * The old price a product may show: a confirmed sale's, only when its
 * discount is within the max (as `toProduct`, VISION rule 6).
 */
function saleWithin(product: SwapProduct, max: number): string | null {
  if (!product.compareAt) return null
  const now = amount(product.price)
  const was = amount(product.compareAt)
  const implied = now && was && was > now ? ((was - now) / was) * 100 : null
  return implied !== null && implied <= max ? product.compareAt : null
}

const shape = (w: number, h: number) => (h > 0 ? w / h : 0)
const fits = (pic: SwapPicture, w: number, h: number) =>
  h > 0 &&
  pic.height > 0 &&
  Math.abs(shape(pic.width, pic.height) - shape(w, h)) / shape(w, h) <=
    limits.aspectShare

/** A photo for a slot `w` × `h`: its own shape fits, or the cropper cuts it. */
/** A photo for a slot, or why it cannot be used (a string), or null (not that shape). */
function fitted(
  pic: SwapPicture,
  w: number,
  h: number,
  cropper: Cropper | null | undefined
): SwapPicture | string | null {
  if (fits(pic, w, h)) return pic
  const got = cropper?.(pic, Math.round(w), Math.round(h)) ?? null
  if (got && 'failed' in got) return got.failed
  if (!got && pic.unusable) return pic.unusable
  return got
}
const usable = (got: SwapPicture | string | null): got is SwapPicture =>
  !!got && typeof got === 'object'

const shapeWords = (w: number, h: number) => {
  const r = shape(w, h)
  return r > 1.05 ? 'wide' : r < 0.95 ? 'tall' : 'square'
}

const host = (site: string) => {
  try {
    return new URL(site).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

const navWords = ['Shop', 'New in', 'About', 'Help', 'Contact', 'Stores']
/** What a preview shows for the address Klaviyo writes when it sends. */
const storeAddress = 'Store address'

/** The parts of a column that make it a product card. */
const productRoles = new Set([
  'product_photo',
  'product_name',
  'price',
  'old_price'
])
const hasProduct = (items: readonly Item[]): boolean =>
  items.some((i) =>
    i.type === 'row'
      ? i.columns.some((c) => hasProduct(c.items))
      : productRoles.has(i.role)
  )

type Ctx = {
  section: Section
  /** The fill behind what is drawn now (already the brand's). */
  behind: string
  /** The product of the card being filled (or the email's lead product). */
  product: SwapProduct | null
  /** The space a part sits in, px. */
  avail: number
}

export function swapBrand(input: SwapInput): SwapResult {
  const { source, brand, products, rules } = input
  const pal: PaletteMapper = paletteMapper(brand)
  // The writers' words may state the email's own products' prices (and
  // their sale prices within the max), besides the facts given.
  const picker = wordPicker(input.words, {
    ...rules,
    amounts: [
      ...(rules.amounts ?? []),
      ...products.flatMap((p) => [
        p.price,
        ...(saleWithin(p, rules.maxDiscountPercent) ?? [])
      ])
    ]
  })
  const blocked = new Map<number, string>()
  const block = (s: Section, why: string) => {
    if (!blocked.has(s.ordinal)) blocked.set(s.ordinal, why)
  }
  const heading = safeFamily(brand.headingFont, 'Georgia')
  const bodyFont = safeFamily(brand.bodyFont, 'Helvetica')
  const usedPhotos = new Set<string>()
  let productCursor = 0
  let iconCursor = 0
  const nextProduct = () => products[productCursor++] ?? null
  const brandPhotos = [
    ...(brand.photos ?? []),
    ...products.flatMap((p) => (p.photo ? [p.photo] : []))
  ]

  const body = pal.fill(source.body)

  const fontFor = (part: TextPart | ButtonPart) => ({
    ...part.font,
    family:
      part.role === 'headline' ||
      part.role === 'subheadline' ||
      part.role === 'eyebrow'
        ? heading
        : bodyFont
  })

  const link = (ctx: Ctx) => ctx.product?.url ?? brand.site

  /** The footer's lines, with Klaviyo's tags where Klaviyo fills them. */
  const footerLines = (
    count: number,
    color: string,
    withLinks: boolean
  ): TextRun[] => {
    // Klaviyo needs the organisation, its address and the unsubscribe
    // link in every email: always written, whatever the original's footer
    // looked like (Klaviyo fills the address itself when it sends).
    const org: TextRun[] = [
      { text: brand.name, tag: 'organization' },
      { text: ', ' },
      { text: brand.address || storeAddress, tag: 'address' }
    ]
    const why: TextRun[] = [
      {
        text: `This email went to you because you joined the ${brand.name} list${host(brand.site) ? ` at ${host(brand.site)}` : ''}.`
      }
    ]
    const links: TextRun[] = [
      { text: 'Unsubscribe', tag: 'unsubscribe', underline: true, color },
      { text: ' · ' },
      { text: 'Preferences', tag: 'preferences', underline: true, color }
    ]
    const view: TextRun[] = [
      { text: 'View in browser', tag: 'web_view', underline: true, color }
    ]
    // DES-ENGINE-002b2: Klaviyo's "view in browser" link too, in every
    // footer with links (the push refuses an email without it).
    const all: TextRun[] = [...links, { text: ' · ' }, ...view]
    const lines = withLinks
      ? count >= 4
        ? [org, why, links, view]
        : count === 3
          ? [org, why, all]
          : count === 2
            ? [org, all]
            : [[...org, { text: ' · ' }, ...all]]
      : count >= 2
        ? [[{ text: brand.name }], why]
        : [why]
    return lines.flatMap((l, i) => (i ? [{ text: '\n' }, ...l] : l))
  }

  let footerLinks = false
  let navCursor = 0
  /**
   * The old price a product may show: a confirmed sale's, only when its
   * discount is within the max (as `toProduct`, VISION rule 6).
   */
  const salePrice = (product: SwapProduct) =>
    saleWithin(product, rules.maxDiscountPercent)

  const textPart = (p: TextPart, ctx: Ctx): TextPart => {
    const color = pal.text(p.color, ctx.behind, p.font.size)
    const main =
      [...p.runs].sort((a, b) => b.text.length - a.text.length)[0] ?? p.runs[0]!
    const style: TextRun = {
      text: '',
      ...(main.weight !== undefined ? { weight: main.weight } : {}),
      ...(main.italic !== undefined ? { italic: main.italic } : {}),
      ...(main.size !== undefined ? { size: main.size } : {})
    }
    const words = textOf(p)
    const caps = /[A-Z]/.test(words) && words === words.toUpperCase()
    const one = (text: string): TextRun[] => [
      { ...style, text: caps ? text.toUpperCase() : text }
    ]
    const segments = words.split('\n')
    const fill = (role: TextPart['role']) => {
      const out: string[] = []
      for (const seg of segments) {
        const w = picker.pick(role, Math.max(2, seg.trim().length))
        if (!w) return null
        out.push(w)
      }
      return out.join('\n')
    }
    let runs: TextRun[] | null = null
    switch (p.role) {
      case 'footer_text':
        // Small words near the end: the brand's caption, unless they hold
        // the unsubscribe link (then the footer, with Klaviyo's tags).
        if (footerLinks || !/unsubscribe/i.test(words)) {
          const got = fill('caption')
          if (got === null) {
            block(ctx.section, 'has words the brand has nothing written for')
            runs = one('—')
          } else runs = one(got)
          break
        }
      // falls through
      case 'legal': {
        // The first legal text (or footer text with an unsubscribe link)
        // carries Klaviyo's organisation, address and unsubscribe tags.
        const links =
          !footerLinks && (p.role === 'legal' || /unsubscribe/i.test(words))
        if (links) footerLinks = true
        runs = footerLines(segments.length, color, links).map((r) =>
          r.tag && r.color ? { ...r, color } : r
        )
        break
      }
      case 'price': {
        const product = ctx.product
        if (!product) {
          block(
            ctx.section,
            'shows a price, and this email has no product for it'
          )
          runs = one('—')
          break
        }
        const old = p.runs.find((r) => r.strike && r.text.trim())
        const was = salePrice(product)
        runs =
          old && was
            ? [
                { text: was, strike: true },
                { ...style, text: ` ${product.price}` }
              ]
            : [{ ...style, text: product.price }]
        break
      }
      case 'old_price': {
        const was = ctx.product ? salePrice(ctx.product) : null
        if (!was) {
          block(
            ctx.section,
            'shows an old price, and the store has no sale price within your max discount for its products'
          )
          runs = [{ text: ctx.product?.price ?? '—', strike: true }]
        } else runs = [{ text: was, strike: true }]
        break
      }
      case 'product_name': {
        if (!ctx.product) {
          block(ctx.section, 'shows more products than this email has')
          runs = one('—')
        } else runs = [{ ...style, text: ctx.product.title }]
        break
      }
      case 'code': {
        if (!rules.offer) {
          block(ctx.section, 'shows a discount code, and this email has none')
          runs = one('—')
        } else if (
          !Number.isInteger(rules.offer.percent) ||
          rules.offer.percent < 1 ||
          rules.offer.percent > rules.maxDiscountPercent
        ) {
          block(
            ctx.section,
            'shows a discount code, and this email’s code is above your max discount'
          )
          runs = one('—')
        } else
          runs = [
            {
              ...style,
              text: /\s/.test(words.trim())
                ? `Use code ${rules.offer.code}`
                : rules.offer.code
            }
          ]
        break
      }
      case 'nav': {
        runs = [{ ...style, text: navWords[navCursor++ % navWords.length]! }]
        break
      }
      default: {
        const got = fill(p.role)
        if (got === null) {
          block(ctx.section, 'has words the brand has nothing written for')
          runs = one('—')
        } else runs = one(got)
      }
    }
    return {
      ...p,
      font: fontFor(p),
      color,
      runs: runs.map((r) =>
        r.color && !r.tag
          ? { ...r, color: pal.text(r.color, ctx.behind, p.font.size) }
          : r
      )
    }
  }

  const picture = (p: ImagePart, ctx: Ctx): ImagePart => {
    const base = { ...p, alt: '', href: link(ctx) as string | null }
    // A section no picture fits is built from a library block, which draws
    // a photo at its own shape: it gets the brand's closest one.
    const none = (why: string, photo?: SwapPicture | null): ImagePart => {
      block(ctx.section, why)
      return photo
        ? { ...base, src: photo.src, alt: photo.alt || brand.name }
        : { ...base, src: null }
    }
    if (p.role === 'logo') {
      const dark = lightness(ctx.behind) < 0.3
      const logo = (dark && brand.logoOnDark) || brand.logo
      if (!logo || logo.height <= 0)
        return none('has a logo, and the Brand kit has no logo picture')
      let h = p.height
      let w = (h * logo.width) / logo.height
      if (w > p.width + 0.5) {
        w = p.width
        h = (w * logo.height) / logo.width
      }
      const right = ctx.avail - p.x - p.width
      const centred = Math.abs(p.x - right) <= 2 && p.x > 2
      const x = centred
        ? (ctx.avail - w) / 2
        : right <= 2 && p.x > 2
          ? p.x + p.width - w
          : p.x
      return {
        ...base,
        src: logo.src,
        alt: brand.name,
        href: brand.site,
        x,
        width: Math.round(w * 100) / 100,
        height: Math.round(h * 100) / 100
      }
    }
    if (p.role === 'icon' || p.role === 'social') {
      const icons = brand.icons ?? []
      for (let k = 0; k < icons.length; k++) {
        const icon = icons[(iconCursor + k) % icons.length]!
        const got = fitted(icon, p.width, p.height, input.cropper)
        if (usable(got)) {
          iconCursor = (iconCursor + k + 1) % icons.length
          return {
            ...base,
            src: got.src,
            alt: icon.alt,
            href: icon.href ?? brand.site
          }
        }
      }
      return none('has small icons, and the brand has no icons of that shape')
    }
    if (p.role === 'product_photo' && ctx.product) {
      const photo = ctx.product.photo
      const got = photo && fitted(photo, p.width, p.height, input.cropper)
      if (usable(got)) {
        usedPhotos.add(photo!.src)
        return { ...base, src: got.src, alt: ctx.product.title }
      }
      if (typeof got === 'string')
        return none(
          `has a product photo that could not be used (${got})`,
          photo
        )
      return none(
        `shows ${shapeWords(p.width, p.height)} product photos, and the store's photos are not that shape`,
        photo
      )
    }
    // Other pictures: the brand's own photos first, then its products'.
    const unused = brandPhotos.filter((ph) => !usedPhotos.has(ph.src))
    let why: string | null = null
    for (const ph of [...unused, ...brandPhotos]) {
      const got = fitted(ph, p.width, p.height, input.cropper)
      if (usable(got)) {
        usedPhotos.add(ph.src)
        return { ...base, src: got.src, alt: ph.alt || brand.name }
      }
      if (typeof got === 'string') why ??= got
    }
    const closest = [...unused, ...brandPhotos].sort(
      (a, b) =>
        Math.abs(shape(a.width, a.height) - shape(p.width, p.height)) -
        Math.abs(shape(b.width, b.height) - shape(p.width, p.height))
    )[0]
    if (closest) usedPhotos.add(closest.src)
    if (why)
      return none(
        `has a picture, and the brand’s photo could not be used (${why})`,
        closest
      )
    return none(
      `has a ${shapeWords(p.width, p.height)} picture, and the brand has no photo of that shape`,
      closest
    )
  }

  const buttonPart = (p: ButtonPart, ctx: Ctx): ButtonPart => {
    const face = p.background ? pal.button(p.background, ctx.behind) : null
    const label = picker.pick(p.role, p.label.length) ?? 'Shop'
    const color = face
      ? pal.label(face)
      : pal.text(p.color, ctx.behind, p.font.size)
    return {
      ...p,
      label: holdsFacts(label)
        ? label
        : cutTo(label, Math.max(4, p.label.length + 2)),
      href: link(ctx),
      font: fontFor(p),
      color,
      background: face,
      border: p.border
        ? { ...p.border, color: face ?? pal.line(p.border.color, ctx.behind) }
        : null,
      ...(brand.radius !== undefined && p.radius > 0
        ? { radius: Math.min(p.radius, brand.radius, p.height / 2) }
        : {})
    }
  }

  const dividerPart = (p: DividerPart, ctx: Ctx): DividerPart => ({
    ...p,
    color: pal.line(p.color, ctx.behind)
  })

  const part = (p: Part, ctx: Ctx): Part =>
    p.type === 'text'
      ? textPart(p, ctx)
      : p.type === 'image'
        ? picture(p, ctx)
        : p.type === 'button'
          ? buttonPart(p, ctx)
          : dividerPart(p, ctx)

  const items = (list: readonly Item[], ctx: Ctx): Item[] =>
    list.map((item) => {
      if (item.type !== 'row') return part(item, ctx)
      return {
        ...item,
        columns: item.columns.map((c): Column => {
          const fill = c.background
            ? pal.apart(pal.fill(c.background), ctx.behind)
            : null
          const behind = fill ?? ctx.behind
          const product = hasProduct(c.items) ? nextProduct() : ctx.product
          return {
            ...c,
            background: fill,
            border: c.border
              ? { ...c.border, color: pal.line(c.border.color, behind) }
              : null,
            items: items(c.items, { ...ctx, behind, product, avail: c.width })
          }
        })
      }
    })

  const lead = products[0] ?? null
  const sections = source.sections.map((s): Section => {
    const around = pal.fill(s.around)
    const background = s.background
      ? s.background !== s.around
        ? pal.apart(pal.fill(s.background), around)
        : around
      : null
    const behind = background ?? body
    // Section-level product parts (a single product feature) show the lead.
    const sectionProduct = hasProduct(s.items.filter((i) => i.type !== 'row'))
      ? (products[productCursor] ?? lead)
      : lead
    return {
      ...s,
      background,
      around,
      items: items(s.items, {
        section: s,
        behind,
        product: sectionProduct,
        avail: s.width
      })
    }
  })

  const target: Blueprint = {
    ...source,
    page: pal.page,
    body,
    sections
  }
  const parsed = blueprintSchema.safeParse(target)
  if (!parsed.success)
    return {
      ok: false,
      error: `The brand copy is not a valid blueprint: ${parsed.error.issues[0]?.path.join('.')}: ${parsed.error.issues[0]?.message}`
    }
  return {
    ok: true,
    target: parsed.data,
    blocked,
    lengthen: picker.more,
    footer: footerLinks,
    blockBrand: {
      name: brand.name,
      site: brand.site,
      ...(brand.logo && /^https:/i.test(brand.logo.src)
        ? { logo: brand.logo.src }
        : {}),
      ...(brand.logoOnDark && /^https:/i.test(brand.logoOnDark.src)
        ? { logoOnDark: brand.logoOnDark.src }
        : {}),
      font: bodyFont,
      ink: brand.ink,
      background: brand.background,
      accent: brand.accent,
      dark: brand.dark,
      radius: `${Math.min(24, Math.round(brand.radius ?? 8))}px`
    }
  }
}

/**
 * The words the swap and the library blocks write themselves (the footer,
 * a menu, "Use code"), for the leak check's vocabulary: the brand's own,
 * never the source's.
 */
export function swapOwnWords(brand: SwapBrand): string[] {
  return [
    brand.name,
    brand.address ?? '',
    host(brand.site),
    `This email went to you because you joined the ${brand.name} list at ${host(brand.site)}.`,
    'Unsubscribe · Preferences · View in browser',
    'Use code',
    storeAddress,
    // The drawn email's own <title>.
    'Email',
    ...navWords,
    // The library blocks' own footer and preview words.
    'Your brand',
    'Your store address (Klaviyo adds it when it sends)',
    'No longer want these emails? Trouble viewing?'
  ]
}
