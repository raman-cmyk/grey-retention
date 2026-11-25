import {
  blueprintHeight,
  partsOf,
  placedBoxes,
  type Blueprint,
  type Column,
  type Item,
  type PlacedBox,
  type Section
} from './blueprint'
import type { Measurement, Rect } from './measurement'

/**
 * DES-ENGINE-001, the likeness check: is a redraw the same design as its
 * source? Both are blueprints (the redraw measured in the same browser),
 * compared section by section with the owner-approved limits:
 * - the same number, kind and order of sections, and the same parts in
 *   each (texts, pictures, buttons, dividers, rows of columns);
 * - every column within 2 px of its width, every section within 5 % of
 *   its height;
 * - text sizes, button and picture sizes within 1 px, a picture's shape
 *   (width ÷ height) within 2 %;
 * - the two layouts drawn as grey boxes with no content score 0.9 or more
 *   alike (`pictureScore`);
 * - and, measured at 375 px, the redraw still fits a phone
 *   (`phoneProblems`): nothing wider than the screen, nothing on top of
 *   something else.
 * Problems are written in plain words, per section, so the email's page
 * can say which section failed and why.
 */

export const limits = {
  columnPx: 2,
  sectionShare: 0.05,
  /** A very short section (a spacer) may still move a pixel or two. */
  sectionPx: 2,
  sizePx: 1,
  aspectShare: 0.02,
  picture: 0.9,
  /** Grey-box picture cells, in px. */
  cell: 4
} as const

export type SectionLikeness = {
  ordinal: number
  kind: Section['kind']
  pass: boolean
  problems: string[]
  /** How alike the section's grey-box layouts are, 0 to 1. */
  picture: number
}

export type Likeness = {
  pass: boolean
  /** The whole email's grey-box score, 0 to 1. */
  picture: number
  sections: SectionLikeness[]
  /** Problems of the whole email (the number of sections, its width). */
  problems: string[]
}

const kindWords: Record<Section['kind'], string> = {
  header: 'header',
  hero: 'hero',
  text: 'text',
  image: 'picture',
  button: 'button',
  product_grid: 'product grid',
  columns: 'columns',
  offer: 'offer',
  social: 'social links',
  divider: 'divider',
  spacer: 'spacer',
  footer: 'footer',
  mixed: 'section'
}
export const sectionName = (s: Pick<Section, 'ordinal' | 'kind'>) =>
  `Section ${s.ordinal} (${kindWords[s.kind]})`

const partWords = {
  text: 'text',
  image: 'picture',
  button: 'button',
  divider: 'divider',
  row: 'row of columns'
}

/** The parts of a stack as a shape: "text image row[2](…)". */
function shapeOf(items: readonly Item[]): string {
  return items
    .map((i) =>
      i.type === 'row'
        ? `row[${i.columns.length}](${i.columns.map((c) => shapeOf(c.items)).join('|')})`
        : i.type
    )
    .join(' ')
}

const px = (n: number) => `${Math.round(Math.abs(n) * 10) / 10} px`

function compareItems(
  a: readonly Item[],
  b: readonly Item[],
  where: string,
  problems: string[]
) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i]!
    const y = b[i]!
    if (x.type !== y.type) {
      problems.push(
        `${where}: part ${i + 1} is a ${partWords[y.type]} where the original has a ${partWords[x.type]}.`
      )
      continue
    }
    if (x.type === 'row' && y.type === 'row') {
      if (x.columns.length !== y.columns.length) {
        problems.push(
          `${where}: a row has ${y.columns.length} columns where the original has ${x.columns.length}.`
        )
        continue
      }
      x.columns.forEach((c, k) =>
        compareColumn(c, y.columns[k]!, `${where}, column ${k + 1}`, problems)
      )
      continue
    }
    if (x.type === 'text' && y.type === 'text') {
      if (Math.abs(x.font.size - y.font.size) > limits.sizePx)
        problems.push(
          `${where}: text ${i + 1} is ${y.font.size} px where the original is ${x.font.size} px.`
        )
      continue
    }
    if (
      (x.type === 'image' && y.type === 'image') ||
      (x.type === 'button' && y.type === 'button')
    ) {
      const name = x.type === 'image' ? 'picture' : 'button'
      if (
        Math.abs(x.width - y.width) > limits.sizePx ||
        Math.abs(x.height - y.height) > limits.sizePx
      )
        problems.push(
          `${where}: a ${name} is ${Math.round(y.width)} × ${Math.round(y.height)} px where the original is ${Math.round(x.width)} × ${Math.round(x.height)} px.`
        )
      if (x.type === 'image' && x.height > 0 && y.height > 0) {
        const ra = x.width / x.height
        const rb = y.width / y.height
        if (Math.abs(ra - rb) / ra > limits.aspectShare)
          problems.push(
            `${where}: a picture's shape changed by ${Math.round((Math.abs(ra - rb) / ra) * 100)} %.`
          )
      }
      continue
    }
    if (x.type === 'divider' && y.type === 'divider') {
      if (
        Math.abs(x.height - y.height) > limits.sizePx ||
        Math.abs(x.width - y.width) > limits.sizePx
      )
        problems.push(
          `${where}: a divider is ${Math.round(y.width)} × ${Math.round(y.height)} px where the original is ${Math.round(x.width)} × ${Math.round(x.height)} px.`
        )
    }
  }
}

function compareColumn(
  a: Column,
  b: Column,
  where: string,
  problems: string[]
) {
  if (Math.abs(a.width - b.width) > limits.columnPx)
    problems.push(
      `${where} is ${px(b.width - a.width)} ${b.width > a.width ? 'wider' : 'narrower'} than the original.`
    )
  if (Math.abs(a.x - b.x) > limits.columnPx)
    problems.push(
      `${where} sits ${px(b.x - a.x)} ${b.x > a.x ? 'further right' : 'further left'} than the original.`
    )
  compareItems(a.items, b.items, where, problems)
}

/** One section of the source against the same section of the redraw. */
export function compareSection(a: Section, b: Section): string[] {
  const problems: string[] = []
  if (a.kind !== b.kind)
    problems.push(
      `It reads as ${kindWords[b.kind]} where the original is ${kindWords[a.kind]}.`
    )
  const allowed = Math.max(limits.sectionPx, a.height * limits.sectionShare)
  if (Math.abs(a.height - b.height) > allowed)
    problems.push(
      `It is ${px(b.height - a.height)} ${b.height > a.height ? 'taller' : 'shorter'} than the original (${Math.round(a.height)} px, ${Math.round(limits.sectionShare * 100)} % allowed).`
    )
  if (
    Math.abs(a.width - b.width) > limits.columnPx ||
    Math.abs(a.x - b.x) > limits.columnPx
  )
    problems.push(
      `It is ${Math.round(b.width)} px wide where the original is ${Math.round(a.width)} px.`
    )
  const sa = shapeOf(a.items)
  const sb = shapeOf(b.items)
  if (sa !== sb) {
    const pa = partsOf(a.items).length
    const pb = partsOf(b.items).length
    problems.push(
      pa === pb
        ? 'Its parts are arranged differently from the original.'
        : `It has ${pb} parts where the original has ${pa}.`
    )
  }
  compareItems(a.items, b.items, 'In it', problems)
  return problems
}

/** Coverage of grey boxes on a grid of `cell` px squares: 0 to 1 per cell and kind. */
function boxGrid(
  boxes: readonly PlacedBox[],
  width: number,
  height: number,
  cell: number
) {
  const w = Math.max(1, Math.ceil(width / cell))
  const h = Math.max(1, Math.ceil(height / cell))
  const tone: Record<PlacedBox['kind'], number> = {
    fill: 0.25,
    text: 0.5,
    divider: 0.6,
    button: 0.75,
    image: 1
  }
  const grid = new Float32Array(w * h)
  for (const b of boxes) {
    const v = tone[b.kind]
    const x0 = Math.max(0, b.x / cell)
    const x1 = Math.min(w, (b.x + b.width) / cell)
    const y0 = Math.max(0, b.y / cell)
    const y1 = Math.min(h, (b.y + b.height) / cell)
    for (let gy = Math.floor(y0); gy < Math.ceil(y1); gy++) {
      const dy = Math.min(y1, gy + 1) - Math.max(y0, gy)
      if (dy <= 0) continue
      for (let gx = Math.floor(x0); gx < Math.ceil(x1); gx++) {
        const dx = Math.min(x1, gx + 1) - Math.max(x0, gx)
        if (dx <= 0) continue
        const i = gy * w + gx
        // The top box wins (a picture on a card shows as a picture).
        grid[i] = Math.max(grid[i]!, v * Math.min(1, dx * dy))
      }
    }
  }
  return { w, h, grid }
}

/**
 * How alike two grey-box layouts are, 0 to 1: the weighted overlap of the
 * two drawings (the sum of the smaller of each cell over the sum of the
 * larger), on one canvas as wide as the wider and as tall as the taller.
 * Two empty layouts are alike.
 */
export function layoutScore(
  a: readonly PlacedBox[],
  b: readonly PlacedBox[],
  width: number,
  height: number,
  cell: number = limits.cell
) {
  const ga = boxGrid(a, width, height, cell)
  const gb = boxGrid(b, width, height, cell)
  let both = 0
  let either = 0
  for (let i = 0; i < ga.grid.length; i++) {
    both += Math.min(ga.grid[i]!, gb.grid[i]!)
    either += Math.max(ga.grid[i]!, gb.grid[i]!)
  }
  return either ? both / either : 1
}

/** The whole email's grey-box score. */
export function pictureScore(a: Blueprint, b: Blueprint) {
  return layoutScore(
    placedBoxes(a),
    placedBoxes(b),
    Math.max(a.width, b.width),
    Math.max(blueprintHeight(a), blueprintHeight(b))
  )
}

/** One section's grey-box score, both drawn from their own tops. */
function sectionPicture(a: Blueprint, b: Blueprint, ordinal: number) {
  const only = (bp: Blueprint) => {
    const s = bp.sections.find((x) => x.ordinal === ordinal)!
    const single: Blueprint = {
      ...bp,
      sections: [{ ...s, ordinal: 1, gapBefore: 0 }],
      bottom: 0
    }
    return { boxes: placedBoxes(single), height: s.height, width: bp.width }
  }
  const pa = only(a)
  const pb = only(b)
  return layoutScore(
    pa.boxes,
    pb.boxes,
    Math.max(pa.width, pb.width),
    Math.max(pa.height, pb.height)
  )
}

/**
 * The source against its redraw (and the redraw's phone problems, by
 * section). Sections in `skip` (built from a library block, or left out)
 * are not compared and count for neither score.
 */
export function compareBlueprints(
  fullSource: Blueprint,
  fullDrawn: Blueprint,
  phone: ReadonlyMap<number, readonly string[]> = new Map(),
  skip: ReadonlySet<number> = new Set()
): Likeness {
  const kept = (bp: Blueprint): Blueprint => ({
    ...bp,
    sections: bp.sections.filter((s) => !skip.has(s.ordinal))
  })
  const source = kept(fullSource)
  const drawn = kept(fullDrawn)
  const problems: string[] = []
  if (source.sections.length !== drawn.sections.length)
    problems.push(
      `The redraw has ${drawn.sections.length} sections where the original has ${source.sections.length}.`
    )
  if (Math.abs(source.width - drawn.width) > limits.columnPx)
    problems.push(
      `The redraw is ${Math.round(drawn.width)} px wide where the original is ${Math.round(source.width)} px.`
    )
  const sections: SectionLikeness[] = source.sections.map((s) => {
    const d = drawn.sections.find((x) => x.ordinal === s.ordinal)
    if (!d)
      return {
        ordinal: s.ordinal,
        kind: s.kind,
        pass: false,
        problems: ['It is missing from the redraw.'],
        picture: 0
      }
    const list = [...compareSection(s, d), ...(phone.get(s.ordinal) ?? [])]
    const picture = sectionPicture(source, drawn, s.ordinal)
    if (picture < limits.picture)
      list.push(
        `Its grey-box layout is only ${Math.round(picture * 100)} % alike (${Math.round(limits.picture * 100)} % needed).`
      )
    return {
      ordinal: s.ordinal,
      kind: s.kind,
      pass: list.length === 0,
      problems: list,
      picture
    }
  })
  const picture = pictureScore(source, drawn)
  if (picture < limits.picture)
    problems.push(
      `The whole email's grey-box layout is only ${Math.round(picture * 100)} % alike (${Math.round(limits.picture * 100)} % needed).`
    )
  return {
    pass: problems.length === 0 && sections.every((s) => s.pass),
    picture,
    sections,
    problems
  }
}

/**
 * What goes wrong on a phone, by section, from the redraw measured at
 * 375 px: the page scrolls sideways, a part reaches past the screen's
 * edge, or two parts are drawn on top of each other (columns that did
 * not stack). Measured boxes only; nothing in the page runs.
 */
export function phoneProblems(
  m: Measurement,
  width = m.viewport
): Map<number, string[]> {
  const out = new Map<number, string[]>()
  const add = (ordinal: number, text: string) => {
    const list = out.get(ordinal) ?? []
    if (!list.includes(text)) list.push(text)
    out.set(ordinal, list)
  }
  const byId = new Map(m.nodes.map((n) => [n.id, n]))
  const sectionOf = (id: number): number | null => {
    for (let n = byId.get(id); n; n = byId.get(n.parent)) {
      const v = n.attrs['data-gr-section']
      if (v !== undefined) return Number(v) || null
    }
    return null
  }
  type Leaf = { rect: Rect; ordinal: number; picture: boolean }
  const leaves: Leaf[] = []
  for (const n of m.nodes) {
    if (!n.style || n.style.display === 'none' || !n.style.visible) continue
    let rect: Rect | null = null
    if (n.tag === 'img' && n.box && n.box.w > 3 && n.box.h > 3) rect = n.box
    else if (n.tag === '#text' && n.lines.length && n.text?.trim()) {
      const ls = n.lines.filter((l) => l.w > 0)
      if (!ls.length) continue
      const x = Math.min(...ls.map((l) => l.x))
      const y = Math.min(...ls.map((l) => l.y))
      rect = {
        x,
        y,
        w: Math.max(...ls.map((l) => l.x + l.w)) - x,
        h: Math.max(...ls.map((l) => l.y + l.h)) - y
      }
    }
    if (!rect) continue
    const ordinal = sectionOf(n.id)
    if (ordinal === null) continue
    leaves.push({ rect, ordinal, picture: n.tag === 'img' })
    if (rect.x + rect.w > width + 1 || rect.x < -1)
      add(
        ordinal,
        `On a phone (${width} px) a part reaches past the edge of the screen.`
      )
  }
  if (m.contentWidth > width + 1)
    for (const ordinal of new Set(
      leaves
        .filter((l) => l.rect.x + l.rect.w > width + 1)
        .map((l) => l.ordinal)
    ))
      add(ordinal, `On a phone (${width} px) the email scrolls sideways.`)
  // Parts drawn on top of each other: pictures over pictures or words over
  // pictures (a few pixels of overlap are forgiven).
  const sorted = [...leaves].sort((a, b) => a.rect.y - b.rect.y)
  for (let i = 0; i < sorted.length; i++)
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i]!
      const b = sorted[j]!
      if (b.rect.y > a.rect.y + a.rect.h) break
      // Words of one paragraph share lines; only a picture can be covered.
      if (!a.picture && !b.picture) continue
      const ox =
        Math.min(a.rect.x + a.rect.w, b.rect.x + b.rect.w) -
        Math.max(a.rect.x, b.rect.x)
      const oy =
        Math.min(a.rect.y + a.rect.h, b.rect.y + b.rect.h) -
        Math.max(a.rect.y, b.rect.y)
      if (ox > 4 && oy > 4)
        add(
          b.ordinal,
          `On a phone (${width} px) two parts are drawn on top of each other.`
        )
    }
  return out
}
