import { parseFragment, type DefaultTreeAdapterTypes as T } from 'parse5'
import { oversized } from '@/features/blocks/labeller'
import {
  mergeSlots,
  stackRows,
  variantSpecSchema,
  type Slot,
  type VariantSpec
} from './variants'

/**
 * A section's structure read from its own HTML, without AI (CI-002): its
 * rows of columns and, in each column, the slots in order (a picture, a
 * heading, a paragraph, a button…), with their proportions. Words,
 * pictures, links and colours are never kept, only what kind of thing sits
 * where. The Variant maker refines this when the structure is new; when it
 * is already in the library, this is all it takes.
 */

type Node = T.ChildNode | T.ParentNode
const isElement = (n: Node): n is T.Element => 'tagName' in n
const isText = (n: Node): n is T.TextNode => n.nodeName === '#text'
const attr = (n: T.Element, name: string) =>
  n.attrs.find((a) => a.name === name)?.value ?? ''
const styleOf = (n: T.Element) => attr(n, 'style').toLowerCase()
const unseen = new Set(['script', 'style', 'head', 'title', 'template'])
/**
 * Not shown, by the same rule as the sections (INB-003): display:none,
 * visibility:hidden, opacity:0, the hidden attribute, or a box squeezed to
 * max-height:0 with its overflow hidden (the hidden preview line).
 */
const hidden = (n: T.Element) => {
  const style = styleOf(n)
  return (
    n.attrs.some((a) => a.name === 'hidden') ||
    /(?:^|[;\s])(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?![.\d]))/.test(
      style
    ) ||
    (/(?:^|[;\s])max-height\s*:\s*0(?![.\d])/.test(style) &&
      /overflow\s*:\s*hidden/.test(style))
  )
}
/** A tracking pixel or spacer: no part of the design. */
/** A width or height in pixels, from the attribute or the style; NaN if none. */
function sizeOf(img: T.Element, name: 'width' | 'height') {
  return Number.parseFloat(
    attr(img, name) ||
      new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([\\d.]+)px`).exec(
        styleOf(img)
      )?.[1] ||
      ''
  )
}
/** A thin wide picture used as a line between parts: a divider. */
function rule(img: T.Element) {
  const height = sizeOf(img, 'height')
  return Number.isFinite(height) && height <= 2 && sizeOf(img, 'width') >= 100
}
/** A tracking pixel or spacer (0 to 2 pixels, or named so): not a picture. */
function spacer(img: T.Element) {
  const width = sizeOf(img, 'width')
  const height = sizeOf(img, 'height')
  return (
    (Number.isFinite(width) && width <= 2) ||
    (Number.isFinite(height) && height <= 2) ||
    /(?:^|[/_.-])(?:spacer|blank|pixel|clear|transparent)\.(?:gif|png)(?:$|[?#])/i.test(
      attr(img, 'src')
    )
  )
}
const children = (n: Node): T.ChildNode[] =>
  'childNodes' in n ? n.childNodes : []
const cellsOf = (tr: T.Element) =>
  children(tr).filter(
    (c): c is T.Element =>
      isElement(c) && (c.tagName === 'td' || c.tagName === 'th')
  )

function textOf(n: Node): string {
  if (isText(n)) return n.value
  if (isElement(n) && (unseen.has(n.tagName) || hidden(n))) return ''
  return children(n).map(textOf).join(' ')
}
const words = (text: string) => text.split(/\s+/).filter(Boolean).length

/** A pixel or percent width, as a share of the 600px row. */
function share(n: T.Element): number | null {
  const raw =
    attr(n, 'width') ||
    /(?:^|;)\s*width\s*:\s*([\d.]+%?)/.exec(styleOf(n))?.[1] ||
    ''
  const value = Number.parseFloat(raw)
  if (!Number.isFinite(value) || value <= 0) return null
  return raw.endsWith('%') ? Math.min(1, value / 100) : Math.min(1, value / 600)
}

const socialHost =
  /facebook|instagram|tiktok|pinterest|twitter|youtube|linkedin|\bx\.com/i
const price = /[$£€]\s?\d/
const codeWord = /\bcode\b[^A-Za-z0-9]{0,6}([A-Z0-9]{3,20})\b/

function imageSlot(img: T.Element, nearPrice: boolean): Slot {
  const src = `${attr(img, 'src')} ${attr(img, 'alt')}`
  if (socialHost.test(src)) return { kind: 'social' }
  const width = Number.parseFloat(attr(img, 'width')) || 0
  const height = Number.parseFloat(attr(img, 'height')) || 0
  const ratio = width && height ? width / height : 0
  const aspect = !ratio
    ? 'free'
    : ratio >= 1.8
      ? '2:1'
      : ratio >= 1.6
        ? '16:9'
        : ratio >= 1.3
          ? '3:2'
          : ratio >= 0.9
            ? '1:1'
            : '4:5'
  const role =
    width > 0 && width <= 64
      ? 'icon'
      : width > 0 && width <= 220 && !nearPrice
        ? 'logo'
        : nearPrice
          ? 'product'
          : 'lifestyle'
  return { kind: 'image', role, aspect, bleed: width >= 560 }
}

function buttonStyle(a: T.Element): 'solid' | 'outline' | 'link' | null {
  const cell = a.parentNode
  const own = styleOf(a)
  const painted = (style: string) =>
    /background(?:-color)?\s*:\s*(?!none|transparent)[#a-z]/.test(style)
  // The cell around it is the button only when the link is all it holds
  // (links in a coloured footer are plain links).
  const alone =
    !!cell &&
    isElement(cell) &&
    children(cell).every((c) => c === a || (isText(c) && !c.value.trim()))
  // A filled box: a background on the link itself or on the cell that is
  // only the link (a text colour alone is a plain link).
  const filled =
    painted(own) ||
    (alone &&
      isElement(cell!) &&
      (!!attr(cell!, 'bgcolor') || painted(styleOf(cell!))))
  if (filled && words(textOf(a)) <= 6) return 'solid'
  if (/border\s*:/.test(own) && words(textOf(a)) <= 6) return 'outline'
  return null
}

/** The slots of one column, in reading order. */
function slotsOf(cell: Node, rowHasPrice = false): Slot[] {
  const slots: Slot[] = []
  // A picture beside a price (in this column or the next) is a product.
  const nearPrice = rowHasPrice || price.test(textOf(cell))
  const walk = (n: Node) => {
    if (!isElement(n)) {
      if (isText(n) && words(n.value) > 0) {
        const text = n.value
        if (/★|☆/.test(text)) slots.push({ kind: 'rating' })
        else if (price.test(text) && words(text) <= 6)
          slots.push({ kind: 'price' })
        else if (codeWord.test(text)) slots.push({ kind: 'code' })
        else if (/^\s*["“]/.test(text) && words(text) >= 4)
          slots.push({ kind: 'quote' })
        else
          slots.push({
            kind: 'text',
            lines: Math.min(12, Math.max(1, Math.ceil(words(text) / 12)))
          })
      }
      return
    }
    if (unseen.has(n.tagName) || hidden(n)) return
    if (n.tagName === 'img') {
      if (rule(n)) slots.push({ kind: 'divider' })
      else if (!spacer(n)) slots.push(imageSlot(n, nearPrice))
      return
    }
    if (n.tagName === 'hr') return void slots.push({ kind: 'divider' })
    if (n.tagName === 'a') {
      const style = buttonStyle(n)
      const inner = children(n).filter(isElement)
      if (style && !inner.some((c) => c.tagName === 'img'))
        return void slots.push({ kind: 'button', style })
    }
    const size = Number.parseFloat(
      /font-size\s*:\s*([\d.]+)px/.exec(styleOf(n))?.[1] ?? ''
    )
    const level = /^h([1-6])$/.exec(n.tagName)?.[1]
    if (level || size >= 18) {
      const text = textOf(n)
      if (words(text) > 0 && words(text) <= 14) {
        const big = level === '1' || size >= 30
        const large = level === '2' || size >= 24
        slots.push({
          kind: 'heading',
          size: big
            ? 'xl'
            : large
              ? 'l'
              : level === '3' || size >= 20
                ? 'm'
                : 's'
        })
        return
      }
    }
    // A short uppercase line above a heading is an eyebrow.
    if (
      /text-transform\s*:\s*uppercase|letter-spacing/.test(styleOf(n)) &&
      words(textOf(n)) <= 5 &&
      words(textOf(n)) > 0
    ) {
      slots.push({ kind: 'eyebrow' })
      return
    }
    for (const c of children(n)) walk(c)
  }
  walk(cell)
  return mergeSlots(slots).slice(0, 8)
}

type Row = { cells: { node: T.Element; width: number | null }[] }

/** The section's rows: a row of one cell is opened, a row of several kept. */
function rowsOf(n: Node, depth = 0): Row[] {
  if (depth > 12) return []
  const rows: Row[] = []
  for (const c of children(n)) {
    if (!isElement(c) || unseen.has(c.tagName) || hidden(c)) continue
    if (c.tagName === 'tr') {
      const cells = cellsOf(c).filter(hasContent)
      if (cells.length >= 2)
        rows.push({
          cells: cells.slice(0, 4).map((node) => ({ node, width: share(node) }))
        })
      else if (cells.length === 1) {
        const inner = rowsOf(cells[0]!, depth + 1)
        rows.push(
          ...(inner.length
            ? inner
            : [{ cells: [{ node: cells[0]!, width: 1 }] }])
        )
      }
    } else if (
      c.tagName === 'table' ||
      c.tagName === 'tbody' ||
      c.tagName === 'thead'
    ) {
      rows.push(...rowsOf(c, depth + 1))
    } else {
      const inner = rowsOf(c, depth + 1)
      if (inner.length) rows.push(...inner)
      else if (hasContent(c)) rows.push({ cells: [{ node: c, width: 1 }] })
    }
  }
  return rows
}

function hasImage(n: Node): boolean {
  if (isElement(n) && n.tagName === 'img') return !spacer(n)
  return children(n).some(hasImage)
}

function hasDivider(n: Node): boolean {
  if (isElement(n) && (n.tagName === 'hr' || (n.tagName === 'img' && rule(n))))
    return true
  return children(n).some(hasDivider)
}

/** Words, a picture or a divider: something a slot is made of. */
const hasContent = (n: Node) =>
  !!textOf(n).trim() || hasImage(n) || hasDivider(n)

/** Narrowest column the library draws. */
const minWidth = 0.1

/**
 * Column widths as shares that add up to the whole row, none narrower than
 * a tenth: a column below it is widened and the others share what is left
 * in proportion (at most four columns, so it always fits).
 */
function fitWidths(columns: { share: number; slots: Slot[] }[]) {
  const total = columns.reduce((a, c) => a + c.share, 0) || 1
  const shares = columns.map((c) => c.share / total)
  const fixed = new Set<number>()
  for (let round = 0; round < columns.length; round++) {
    const free = shares.map((_, i) => i).filter((i) => !fixed.has(i))
    const room = 1 - minWidth * fixed.size
    const sum = free.reduce((a, i) => a + shares[i]!, 0) || 1
    for (const i of free) shares[i] = (shares[i]! / sum) * room
    const narrow = free.filter((i) => shares[i]! < minWidth)
    if (!narrow.length) break
    for (const i of narrow) {
      shares[i] = minWidth
      fixed.add(i)
    }
  }
  const widths = shares.map((w) => Math.round(w * 100) / 100)
  // Rounding drift goes to the widest column.
  const widest = widths.indexOf(Math.max(...widths))
  if (widest >= 0)
    widths[widest] =
      Math.round(
        (widths[widest]! + 1 - widths.reduce((a, w) => a + w, 0)) * 100
      ) / 100
  return columns.map((c, i) => ({ width: widths[i]!, slots: c.slots }))
}

function firstStyled(root: Node): T.Element | null {
  for (const c of children(root)) {
    if (!isElement(c)) continue
    if (styleOf(c) || attr(c, 'bgcolor') || attr(c, 'align')) return c
    const inner = firstStyled(c)
    if (inner) return inner
  }
  return null
}

function luminance(hex: string) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const h = m[1]!.length === 3 ? m[1]!.replace(/./g, (c) => c + c) : m[1]!
  const [r, g, b] = [0, 2, 4].map(
    (i) => Number.parseInt(h.slice(i, i + 2), 16) / 255
  )
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

/**
 * The section's structure, or null when it cannot be read safely (too
 * large) or holds nothing (no slot).
 */
export function skeletonOf(html: string): VariantSpec | null {
  if (oversized(html)) return null
  const root = parseFragment(html)
  const read = rowsOf(root)
    .map((row) => {
      const known = row.cells.map((c) => c.width)
      const rowPrice = price.test(
        row.cells.map((c) => textOf(c.node)).join(' ')
      )
      const free = known.filter((w) => w === null).length
      const used = known.reduce<number>((sum, w) => sum + (w ?? 0), 0)
      const rest = free ? Math.max(0, 1 - used) / free : 0
      const raw = known.map((w) => w ?? (rest || 1 / row.cells.length))
      const total = raw.reduce((a, b) => a + b, 0) || 1
      const columns = row.cells
        .map((c, i) => ({
          share: raw[i]! / total,
          slots: slotsOf(c.node, rowPrice)
        }))
        .filter((c) => c.slots.length)
      return { columns: fitWidths(columns) }
    })
    .filter((row) => row.columns.length)
  // Parts stacked in rows of their own are one stack; then at most 6 rows.
  const rows = stackRows(read).slice(0, 6)
  if (!rows.length) return null
  const styled = firstStyled(root)
  const style = styled ? styleOf(styled) : ''
  const alignAttr = styled ? attr(styled, 'align') : ''
  const align =
    /text-align\s*:\s*left/.test(style) || alignAttr === 'left'
      ? 'left'
      : /text-align\s*:\s*right/.test(style) || alignAttr === 'right'
        ? 'right'
        : 'center'
  const colour =
    (styled && attr(styled, 'bgcolor')) ||
    /background(?:-color)?\s*:\s*(#[0-9a-f]{3,6})/.exec(style)?.[1] ||
    ''
  const light = luminance(colour)
  const background = /background(?:-image)?\s*:[^;]*url\(/.test(style)
    ? 'image'
    : light === null || light > 0.92
      ? 'none'
      : light < 0.25
        ? 'dark'
        : 'accent'
  const pad = Number.parseFloat(
    /padding(?:-top)?\s*:\s*([\d.]+)px/.exec(style)?.[1] ?? ''
  )
  const padding = !Number.isFinite(pad)
    ? 'm'
    : pad === 0
      ? 'none'
      : pad < 16
        ? 's'
        : pad < 32
          ? 'm'
          : 'l'
  // Whatever the HTML held, only a structure the library can store.
  const spec = variantSpecSchema.safeParse({ rows, align, background, padding })
  return spec.success ? spec.data : null
}
