import type { BlockBrand } from '@/features/blocks/brand'
import {
  blockCatalog,
  parseBlock,
  type Block,
  type BlockType
} from '@/features/blocks/catalog'
import { renderBlock, type RenderMode } from '@/features/blocks/render'
import {
  partsOf,
  textOf,
  type Blueprint,
  type ButtonPart,
  type ImagePart,
  type Part,
  type Section,
  type TextPart
} from './blueprint'
import { sectionName } from './likeness'

/**
 * DES-ENGINE-001: a section that cannot be copied (a countdown timer, a
 * moving picture, words over a background picture) or that still fails
 * the likeness check after two more tries is built from the **closest
 * library block** instead (owner decision of 25 November 2026), and the
 * result says which section and why. The block is filled from the
 * section's own words, links and still pictures (later steps fill it with
 * the brand's content); a moving picture is never reused. A section with
 * nothing the library can draw is left out, and the reason says so.
 */

export type Fallback = {
  ordinal: number
  kind: Section['kind']
  /** The library block used, or null when the section was left out. */
  block: BlockType | null
  /** The block's name in plain words. */
  blockName: string | null
  /** Plain words for the email's page: which section and why. */
  reason: string
  /** The block's rows for the email (empty when left out). */
  rows: string
}

const blockName = (type: BlockType) =>
  blockCatalog.find((b) => b.type === type)?.name ?? type

const movingPicture = /^data:image\/gif|\.gif(?:[?#]|$)|countdown|timer/i
const usableImage = (p: ImagePart) =>
  !!p.src &&
  !movingPicture.test(p.src) &&
  (/^https:\/\//i.test(p.src) ||
    /^data:image\/(?:png|jpeg|webp);base64,/i.test(p.src))

const clip = (text: string, max: number) => {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max - 1)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max / 2)).trim()}…`
}

/** The colours and font a library block is drawn in, read from the email itself. */
export function brandFromBlueprint(
  bp: Blueprint,
  name = 'Your brand'
): BlockBrand {
  const parts = bp.sections.flatMap((s) => partsOf(s.items))
  const texts = parts.filter((p): p is TextPart => p.type === 'text')
  const count = <T>(list: readonly T[]) => {
    const m = new Map<T, number>()
    for (const v of list) m.set(v, (m.get(v) ?? 0) + 1)
    return [...m].sort((a, b) => b[1] - a[1])[0]?.[0]
  }
  const ink =
    count(texts.filter((t) => t.role === 'body').map((t) => t.color)) ??
    count(texts.map((t) => t.color)) ??
    '#121212'
  const family = count(texts.map((t) => t.font.family)) ?? ''
  const font = (family.split(',')[0] ?? '').replace(/'/g, '').trim()
  const buttons = parts.filter((p): p is ButtonPart => p.type === 'button')
  const main = buttons.find((b) => b.role === 'main_button') ?? buttons[0]
  const site =
    parts
      .flatMap((p) =>
        p.type === 'text'
          ? p.runs.map((r) => r.href)
          : p.type === 'image' || p.type === 'button'
            ? [p.href]
            : []
      )
      .find((h): h is string => !!h && /^https:\/\//i.test(h)) ??
    'https://example.com'
  const logo = parts.find(
    (p): p is ImagePart =>
      p.type === 'image' && p.role === 'logo' && usableImage(p)
  )
  const fills = bp.sections
    .map((s) => s.background)
    .filter((c): c is string => !!c)
  const dark = [...fills].sort((a, b) => luma(a) - luma(b))[0]
  return {
    name,
    site: new URL(site).origin,
    ...(logo?.src && /^https:/i.test(logo.src) ? { logo: logo.src } : {}),
    font: /^[A-Za-z0-9 -]{1,60}$/.test(font) ? font : '',
    ink,
    background: bp.page,
    accent: main?.background ?? ink,
    dark: dark && luma(dark) < 0.35 ? dark : ink,
    radius: main ? `${Math.min(24, Math.round(main.radius))}px` : '8px'
  }
}

function luma(hex: string) {
  const v = (i: number) => parseInt(hex.slice(i, i + 2), 16) / 255
  return 0.2126 * v(1) + 0.7152 * v(3) + 0.0722 * v(5)
}

type Words = {
  headline: string | null
  paras: string[]
  eyebrow: string | null
  code: string | null
  button: ButtonPart | null
  image: ImagePart | null
  link: string
}

function wordsOf(section: Section, site: string): Words {
  const parts = partsOf(section.items)
  const texts = parts.filter((p): p is TextPart => p.type === 'text')
  const byRole = (...roles: Part['role'][]) =>
    texts.filter((t) => roles.includes(t.role))
  const head =
    byRole('headline', 'subheadline')[0] ??
    [...texts].sort((a, b) => b.font.size - a.font.size)[0] ??
    null
  const buttons = parts.filter((p): p is ButtonPart => p.type === 'button')
  const button =
    buttons.find((b) => b.role === 'main_button') ?? buttons[0] ?? null
  const image =
    parts.find(
      (p): p is ImagePart =>
        p.type === 'image' &&
        p.role !== 'logo' &&
        p.role !== 'icon' &&
        usableImage(p)
    ) ?? null
  const link =
    button?.href ??
    image?.href ??
    texts
      .flatMap((t) => t.runs.map((r) => r.href))
      .find((h): h is string => !!h) ??
    site
  return {
    headline: head ? textOf(head) : null,
    paras: texts
      .filter(
        (t) =>
          t !== head &&
          !['legal', 'footer_text', 'eyebrow', 'code', 'nav'].includes(t.role)
      )
      .map((t) => textOf(t))
      .filter(Boolean),
    eyebrow: byRole('eyebrow')[0] ? textOf(byRole('eyebrow')[0]!) : null,
    code: byRole('code')[0]
      ? (/[A-Z0-9][A-Z0-9-]{3,}/.exec(textOf(byRole('code')[0]!))?.[0] ?? null)
      : null,
    button,
    image,
    link
  }
}

/** Candidate blocks for a section, closest first, filled from its own words. */
function candidates(
  section: Section,
  brand: BlockBrand
): { type: BlockType; content: unknown }[] {
  const w = wordsOf(section, brand.site)
  const cta = w.button?.label ? clip(w.button.label, 40) : 'Shop now'
  const paras = w.paras.slice(0, 4).map((p) => clip(p, 600))
  const text = {
    type: 'text' as const,
    content: {
      ...(w.headline ? { heading: clip(w.headline, 80) } : {}),
      paras: paras.length ? paras : w.headline ? [clip(w.headline, 600)] : [],
      align: 'center'
    }
  }
  const list: { type: BlockType; content: unknown }[] = []
  switch (section.kind) {
    case 'header':
      list.push({ type: 'header_logo', content: {} })
      break
    case 'footer':
      list.push({
        type: 'footer',
        content: paras[0] ? { note: clip(paras[0], 200) } : {}
      })
      break
    case 'product_grid': {
      const row = section.items.find((i) => i.type === 'row')
      const products =
        row?.type === 'row'
          ? row.columns.map((c) => {
              const ps = partsOf(c.items)
              const img = ps.find(
                (p): p is ImagePart => p.type === 'image' && usableImage(p)
              )
              const title = ps.find(
                (p): p is TextPart =>
                  p.type === 'text' &&
                  p.role !== 'price' &&
                  p.role !== 'old_price'
              )
              const price = ps.find(
                (p): p is TextPart => p.type === 'text' && p.role === 'price'
              )
              const btn = ps.find((p): p is ButtonPart => p.type === 'button')
              return {
                title: title ? clip(textOf(title), 90) : '',
                price: price ? clip(textOf(price), 24) : '',
                image: img?.src ?? '',
                ...(img?.alt ? { alt: clip(img.alt, 160) } : {}),
                url: img?.href ?? btn?.href ?? w.link
              }
            })
          : []
      list.push({
        type:
          products.length % 3 === 0 ? 'product_grid_3col' : 'product_grid_2col',
        content: { products }
      })
      break
    }
    case 'hero':
      if (w.image && w.headline)
        list.push({
          type: 'hero_image',
          content: {
            image: w.image.src,
            alt: clip(w.image.alt || w.headline, 160),
            headline: clip(w.headline, 80),
            ...(paras[0] ? { sub: clip(paras[0], 160) } : {}),
            url: w.link,
            cta
          }
        })
      break
    case 'offer':
      if (w.headline)
        list.push({
          type: 'offer_banner',
          content: {
            headline: clip(w.headline, 60),
            ...(paras[0] ? { detail: clip(paras[0], 140) } : {}),
            ...(w.code ? { code: w.code } : {}),
            url: w.link,
            cta
          }
        })
      break
    case 'button':
      if (w.button)
        list.push({ type: 'cta', content: { label: cta, url: w.link } })
      break
    case 'columns':
      if (w.image && w.headline)
        list.push({
          type: 'image_text',
          content: {
            image: w.image.src,
            alt: clip(w.image.alt || w.headline, 160),
            heading: clip(w.headline, 80),
            paras: paras.length
              ? paras.slice(0, 3).map((p) => clip(p, 500))
              : [clip(w.headline, 500)],
            ...(w.button ? { cta, url: w.link } : {})
          }
        })
      break
    default:
      break
  }
  // Anything with words: an offer line, a text block, a button.
  if (w.headline && w.button)
    list.push({
      type: 'offer_banner',
      content: {
        headline: clip(w.headline, 60),
        ...(paras[0] ? { detail: clip(paras[0], 140) } : {}),
        url: w.link,
        cta
      }
    })
  list.push(text)
  if (w.headline)
    list.push({
      type: 'announcement_bar',
      content: { text: clip(w.headline, 90) }
    })
  if (w.button) list.push({ type: 'cta', content: { label: cta, url: w.link } })
  return list
}

/** The closest library block for one section, drawn, with the reason in plain words. */
export function fallbackFor(
  section: Section,
  why: string,
  brand: BlockBrand,
  mode: RenderMode = 'preview'
): Fallback {
  for (const c of candidates(section, brand)) {
    const parsed = parseBlock(c.type, c.content)
    if (!parsed.ok) continue
    let rows: string
    try {
      rows = renderBlock(parsed.block as Block, brand, mode)
    } catch {
      continue
    }
    return {
      ordinal: section.ordinal,
      kind: section.kind,
      block: parsed.block.type,
      blockName: blockName(parsed.block.type),
      reason: `${sectionName(section)} ${why}, so it was built from the library's ${blockName(parsed.block.type)} block.`,
      rows
    }
  }
  return {
    ordinal: section.ordinal,
    kind: section.kind,
    block: null,
    blockName: null,
    reason: `${sectionName(section)} ${why}, and it has nothing a library block can draw, so it was left out.`,
    rows: ''
  }
}
