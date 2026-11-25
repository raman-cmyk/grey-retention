/**
 * DES-ENGINE-001: what the safe browser measured, as plain data. The
 * browser part (`browser.ts`) asks Chromium for a DOM snapshot through its
 * own protocol (JavaScript stays off in the page) and `fromSnapshot` turns
 * it into this flat list of boxes and computed styles; the measuring tool
 * (`measure.ts`) reads only this, so it is pure code with fast tests.
 */

export type Rect = { x: number; y: number; w: number; h: number }

export type Side = { width: number; color: string | null }

export type MeasuredStyle = {
  display: string
  visible: boolean
  opacity: number
  fontFamily: string
  fontSize: number
  fontWeight: number
  italic: boolean
  /** CSS px, or null for `normal`. */
  lineHeight: number | null
  /** Hex, or null when transparent. */
  color: string | null
  textAlign: 'left' | 'center' | 'right' | 'justify'
  letterSpacing: number
  transform: 'none' | 'uppercase' | 'lowercase' | 'capitalize'
  underline: boolean
  strike: boolean
  /** Hex, or null when transparent. */
  background: string | null
  /** Whether a background picture or gradient is drawn. */
  backgroundImage: boolean
  border: { top: Side; right: Side; bottom: Side; left: Side }
  radius: number
  padding: { top: number; right: number; bottom: number; left: number }
  /** Whether what overflows the box is hidden. */
  clips: boolean
}

export type MeasuredNode = {
  id: number
  parent: number
  /** Lower-case tag name, or `#text`. */
  tag: string
  /** Only the attributes the measuring tool reads. */
  attrs: Readonly<Record<string, string>>
  /** A text node's words, as written. */
  text: string | null
  /** The laid-out border box, or null when not laid out (hidden). */
  box: Rect | null
  style: MeasuredStyle | null
  /** A text node's line pieces, top to bottom. */
  lines: Rect[]
}

export type Measurement = {
  /** The browser window's width. */
  viewport: number
  contentWidth: number
  contentHeight: number
  nodes: MeasuredNode[]
}

/** The computed styles the snapshot asks for, in this order. */
export const snapshotStyles = [
  'display',
  'visibility',
  'opacity',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'color',
  'text-align',
  'letter-spacing',
  'text-transform',
  'text-decoration-line',
  'background-color',
  'background-image',
  'border-top-width',
  'border-top-style',
  'border-top-color',
  'border-right-width',
  'border-right-style',
  'border-right-color',
  'border-bottom-width',
  'border-bottom-style',
  'border-bottom-color',
  'border-left-width',
  'border-left-style',
  'border-left-color',
  'border-top-left-radius',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'overflow-x',
  'overflow-y'
] as const

/** The attributes kept from the snapshot. */
const keptAttrs = new Set([
  'src',
  'alt',
  'href',
  'width',
  'height',
  'data-gr-section',
  'data-de-email',
  'data-de-src'
])

/** The parts of `DOMSnapshot.captureSnapshot`'s answer this reads. */
export type DomSnapshot = {
  strings: string[]
  documents: {
    nodes: {
      parentIndex?: number[]
      nodeType?: number[]
      nodeName?: number[]
      nodeValue?: number[]
      attributes?: number[][]
    }
    layout: {
      nodeIndex: number[]
      styles: number[][]
      bounds: number[][]
    }
    textBoxes: {
      layoutIndex: number[]
      bounds: number[][]
    }
    contentWidth?: number
    contentHeight?: number
  }[]
}

const num = (v: string | undefined, fallback = 0) => {
  const n = Number.parseFloat(v ?? '')
  return Number.isFinite(n) ? n : fallback
}

const hex2 = (n: number) =>
  Math.max(0, Math.min(255, Math.round(n)))
    .toString(16)
    .padStart(2, '0')

/**
 * A computed colour (`rgb(…)`, `rgba(…)` or hex) as lower-case `#rrggbb`;
 * null when it is (mostly) transparent.
 */
export function cssColor(value: string | undefined): string | null {
  const v = (value ?? '').trim().toLowerCase()
  const m =
    /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(
      v
    )
  if (m) {
    const alpha = m[4]
      ? m[4].endsWith('%')
        ? num(m[4]) / 100
        : num(m[4], 1)
      : 1
    if (alpha < 0.5) return null
    return `#${hex2(num(m[1]))}${hex2(num(m[2]))}${hex2(num(m[3]))}`
  }
  const h = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v)
  if (!h) return null
  const s = h[1]!
  return s.length === 3
    ? `#${s[0]}${s[0]}${s[1]}${s[1]}${s[2]}${s[2]}`
    : `#${s}`
}

const weightOf = (v: string | undefined) => {
  if (v === 'bold') return 700
  if (v === 'normal' || !v) return 400
  const n = Math.round(num(v, 400) / 100) * 100
  return Math.max(100, Math.min(900, n))
}

const alignOf = (v: string | undefined): MeasuredStyle['textAlign'] => {
  if (v === 'center' || v === '-webkit-center') return 'center'
  if (v === 'right' || v === '-webkit-right' || v === 'end') return 'right'
  if (v === 'justify') return 'justify'
  return 'left'
}

const transformOf = (v: string | undefined): MeasuredStyle['transform'] =>
  v === 'uppercase' || v === 'lowercase' || v === 'capitalize' ? v : 'none'

function styleOf(values: readonly (string | undefined)[]): MeasuredStyle {
  const s = Object.fromEntries(
    snapshotStyles.map((name, i) => [name, values[i]])
  ) as Record<(typeof snapshotStyles)[number], string | undefined>
  const side = (which: 'top' | 'right' | 'bottom' | 'left'): Side => {
    const style = s[`border-${which}-style`]
    const width = num(s[`border-${which}-width`])
    if (!style || style === 'none' || style === 'hidden' || width <= 0)
      return { width: 0, color: null }
    return { width, color: cssColor(s[`border-${which}-color`]) }
  }
  const decoration = s['text-decoration-line'] ?? ''
  return {
    display: s.display ?? 'inline',
    visible: s.visibility !== 'hidden' && s.visibility !== 'collapse',
    opacity: num(s.opacity, 1),
    fontFamily: s['font-family'] ?? '',
    fontSize: num(s['font-size'], 16),
    fontWeight: weightOf(s['font-weight']),
    italic: s['font-style'] === 'italic' || s['font-style'] === 'oblique',
    lineHeight:
      !s['line-height'] || s['line-height'] === 'normal'
        ? null
        : num(s['line-height']),
    color: cssColor(s.color),
    textAlign: alignOf(s['text-align']),
    letterSpacing:
      s['letter-spacing'] === 'normal' ? 0 : num(s['letter-spacing']),
    transform: transformOf(s['text-transform']),
    underline: decoration.includes('underline'),
    strike: decoration.includes('line-through'),
    background: cssColor(s['background-color']),
    backgroundImage:
      !!s['background-image'] && s['background-image'] !== 'none',
    border: {
      top: side('top'),
      right: side('right'),
      bottom: side('bottom'),
      left: side('left')
    },
    radius: num(s['border-top-left-radius']),
    padding: {
      top: num(s['padding-top']),
      right: num(s['padding-right']),
      bottom: num(s['padding-bottom']),
      left: num(s['padding-left'])
    },
    clips:
      (s['overflow-x'] ?? 'visible') !== 'visible' ||
      (s['overflow-y'] ?? 'visible') !== 'visible'
  }
}

const rectOf = (b: readonly number[] | undefined): Rect | null =>
  b && b.length >= 4 ? { x: b[0]!, y: b[1]!, w: b[2]!, h: b[3]! } : null

/**
 * The snapshot's first document as `Measurement`: element and text nodes
 * only (comments, the doctype and the head's children have no box and
 * are kept as unlaid nodes), with their boxes, styles, kept attributes and
 * text line pieces. Throws when the answer is not a snapshot.
 */
export function fromSnapshot(snap: DomSnapshot, viewport: number): Measurement {
  const doc = snap.documents?.[0]
  if (!doc || !Array.isArray(snap.strings))
    throw new Error('The browser gave no snapshot.')
  const str = (i: number | undefined) =>
    i === undefined || i < 0 ? '' : (snap.strings[i] ?? '')
  const count = doc.nodes.parentIndex?.length ?? 0
  const layoutOf = new Map<number, number>()
  doc.layout.nodeIndex.forEach((node, k) => {
    if (!layoutOf.has(node)) layoutOf.set(node, k)
  })
  const lines = new Map<number, Rect[]>()
  doc.textBoxes.layoutIndex.forEach((k, i) => {
    const node = doc.layout.nodeIndex[k]
    const r = rectOf(doc.textBoxes.bounds[i])
    if (node === undefined || !r) return
    const list = lines.get(node) ?? []
    list.push(r)
    lines.set(node, list)
  })
  const nodes: MeasuredNode[] = []
  for (let id = 0; id < count; id++) {
    const type = doc.nodes.nodeType?.[id]
    if (type !== 1 && type !== 3) {
      nodes.push({
        id,
        parent: doc.nodes.parentIndex?.[id] ?? -1,
        tag: '#other',
        attrs: {},
        text: null,
        box: null,
        style: null,
        lines: []
      })
      continue
    }
    const attrs: Record<string, string> = {}
    const raw = doc.nodes.attributes?.[id] ?? []
    for (let i = 0; i + 1 < raw.length; i += 2) {
      const name = str(raw[i]).toLowerCase()
      if (keptAttrs.has(name)) attrs[name] = str(raw[i + 1]).slice(0, 3_000_000)
    }
    const k = layoutOf.get(id)
    nodes.push({
      id,
      parent: doc.nodes.parentIndex?.[id] ?? -1,
      tag: type === 3 ? '#text' : str(doc.nodes.nodeName?.[id]).toLowerCase(),
      attrs,
      text: type === 3 ? str(doc.nodes.nodeValue?.[id]) : null,
      box: k === undefined ? null : rectOf(doc.layout.bounds[k]),
      style:
        k === undefined
          ? null
          : styleOf(
              (doc.layout.styles[k] ?? []).map((i) =>
                i < 0 ? undefined : str(i)
              )
            ),
      lines: lines.get(id) ?? []
    })
  }
  return {
    viewport,
    contentWidth: doc.contentWidth ?? viewport,
    contentHeight: doc.contentHeight ?? 0,
    nodes
  }
}
