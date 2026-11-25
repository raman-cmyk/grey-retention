import type {
  Blueprint,
  ButtonPart,
  ImagePart,
  Section,
  TextPart
} from './blueprint'
import type {
  MeasuredNode,
  MeasuredStyle,
  Measurement,
  Rect
} from './measurement'

/**
 * DES-ENGINE-001: small made-up blueprints and measurements for the fast
 * tests (no browser). Words and links are placeholders.
 */

export const font = {
  family: 'Arial, Helvetica, sans-serif',
  size: 16,
  weight: 400,
  lineHeight: 24,
  italic: false,
  letterSpacing: 0,
  transform: 'none'
} as const satisfies TextPart['font']

export const text = (over: Partial<TextPart> = {}): TextPart => ({
  type: 'text',
  gapBefore: 20,
  x: 40,
  width: 520,
  height: 48,
  role: 'body',
  runs: [{ text: 'Some words for the test' }],
  font,
  color: '#333333',
  align: 'center',
  lines: 2,
  ...over
})

export const image = (over: Partial<ImagePart> = {}): ImagePart => ({
  type: 'image',
  gapBefore: 0,
  x: 0,
  width: 600,
  height: 300,
  role: 'hero_photo',
  src: 'https://example.com/a.png',
  alt: 'A picture',
  href: 'https://example.com/',
  radius: 0,
  ...over
})

export const button = (over: Partial<ButtonPart> = {}): ButtonPart => ({
  type: 'button',
  gapBefore: 24,
  x: 220,
  width: 160,
  height: 48,
  role: 'main_button',
  label: 'Shop now',
  href: 'https://example.com/shop',
  font: { ...font, size: 15, weight: 700, lineHeight: 20 },
  color: '#ffffff',
  background: '#222222',
  radius: 4,
  border: null,
  lines: 1,
  ...over
})

export const section = (over: Partial<Section> = {}): Section => ({
  ordinal: 1,
  kind: 'hero',
  gapBefore: 0,
  x: 0,
  width: 600,
  height: 460,
  background: null,
  around: '#ffffff',
  items: [
    image(),
    text({
      role: 'headline',
      font: { ...font, size: 32, lineHeight: 38, weight: 700 },
      height: 38,
      lines: 1
    }),
    button()
  ],
  bottom: 32,
  unsupported: null,
  ...over
})

export const gridSection = (ordinal: number): Section => ({
  ...section({ ordinal, kind: 'product_grid', height: 340 }),
  items: [
    {
      type: 'row',
      gapBefore: 20,
      height: 300,
      keepOnPhone: false,
      columns: [0, 1].map((i) => ({
        x: 30 + i * 280,
        y: 0,
        width: 260,
        height: 300,
        background: i ? '#f6f6f6' : null,
        radius: 0,
        border: null,
        items: [
          image({ width: 260, height: 260, x: 0, role: 'product_photo' }),
          text({
            gapBefore: 10,
            x: 0,
            width: 260,
            height: 20,
            lines: 1,
            role: 'price',
            runs: [{ text: '$20.00' }],
            font: { ...font, size: 14, lineHeight: 20 }
          })
        ],
        bottom: 10
      }))
    }
  ],
  bottom: 20
})

export const blueprint = (over: Partial<Blueprint> = {}): Blueprint => ({
  version: 1,
  width: 600,
  page: '#f2f2f2',
  body: '#ffffff',
  sections: [section(), gridSection(2)],
  bottom: 0,
  margin: { top: 24, bottom: 24 },
  ...over
})

// ------------------------------------------------------------ measurement

export const style = (over: Partial<MeasuredStyle> = {}): MeasuredStyle => ({
  display: 'block',
  visible: true,
  opacity: 1,
  fontFamily: 'Arial',
  fontSize: 16,
  fontWeight: 400,
  italic: false,
  lineHeight: 24,
  color: '#333333',
  textAlign: 'left',
  letterSpacing: 0,
  transform: 'none',
  underline: false,
  strike: false,
  background: null,
  backgroundImage: false,
  border: {
    top: { width: 0, color: null },
    right: { width: 0, color: null },
    bottom: { width: 0, color: null },
    left: { width: 0, color: null }
  },
  radius: 0,
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  clips: false,
  ...over
})

/** Builds a measurement node by node, parents first (as a snapshot lists them). */
export function measured() {
  const nodes: MeasuredNode[] = [
    {
      id: 0,
      parent: -1,
      tag: '#other',
      attrs: {},
      text: null,
      box: null,
      style: null,
      lines: []
    }
  ]
  const add = (
    parent: number,
    tag: string,
    box: Rect | null,
    over: Partial<MeasuredStyle> = {},
    attrs: Record<string, string> = {}
  ) => {
    const id = nodes.length
    nodes.push({
      id,
      parent,
      tag,
      attrs,
      text: null,
      box,
      style: style(over),
      lines: []
    })
    return id
  }
  /** A text node with its line pieces (each `h` tall glyph boxes). */
  const words = (
    parent: number,
    value: string,
    lines: Rect[],
    over: Partial<MeasuredStyle> = {}
  ) => {
    const p = nodes[parent]!.style!
    const id = nodes.length
    nodes.push({
      id,
      parent,
      tag: '#text',
      attrs: {},
      text: value,
      box: lines[0] ?? null,
      style: { ...p, display: 'inline', ...over },
      lines
    })
    return id
  }
  const html = add(0, 'html', { x: 0, y: 0, w: 700, h: 800 })
  const body = add(
    html,
    'body',
    { x: 0, y: 0, w: 700, h: 800 },
    { background: '#f2f2f2' }
  )
  const done = (): Measurement => ({
    viewport: 700,
    contentWidth: 700,
    contentHeight: 800,
    nodes
  })
  return { nodes, add, words, html, body, done }
}
