import {
  BLUEPRINT_VERSION,
  maxBlueprintSections,
  maxEmailWidth,
  maxNesting,
  minEmailWidth,
  parseBlueprint,
  type Blueprint,
  type ButtonPart,
  type Column,
  type FontSpec,
  type ImagePart,
  type Item,
  type Part,
  type Section,
  type TextPart,
  type TextRun
} from './blueprint'
import type {
  MeasuredNode,
  MeasuredStyle,
  Measurement,
  Rect
} from './measurement'
import { markRoles, type RoleContext } from './roles'

/**
 * DES-ENGINE-001, the measuring tool: a blueprint from what the safe
 * browser measured (`Measurement`). Code only, no AI.
 *
 * Sections are the elements marked `data-gr-section="n"`: the inbox's own
 * splitter marks them (`sectionEmail` in `features/inbox/sections.ts`, run
 * first on an email that has none), and the drawing code writes the same
 * marks, so a source and its redraw are cut the same way.
 *
 * Inside a section the tool reads the boxes, not the tags, so any builder's
 * HTML (tables, MJML's divs, hybrid columns) gives the same map: things
 * that overlap vertically sit side by side (a row of columns), the rest is
 * a stack. A cell with its own fill or border is a column (a card); one
 * without is looked through. Words become text parts (their lines, size,
 * weight, line height and colours), a link drawn as a filled or outlined
 * shape is a button, a thin filled box or a rule is a divider, a picture
 * is an image. Spacer cells leave only their space.
 */

const blank = /^[\s​-‍⁠﻿͏­]*$/
const invisibleChars = /[​-‍⁠﻿͏­]/g
/** Pictures this small are tracking pixels, not content. */
const pixelSize = 3
const unsupportedTags: Readonly<Record<string, string>> = {
  video: 'a video',
  iframe: 'a page inside the email',
  object: 'an embedded object',
  embed: 'an embedded object',
  form: 'a form',
  input: 'a form field',
  select: 'a form field',
  textarea: 'a form field',
  svg: 'a drawing (SVG)',
  canvas: 'a drawing (canvas)'
}
/** A picture that moves or counts down cannot be copied (owner decision of 25 Nov). */
export const movingPicture =
  /^data:image\/gif|\.gif(?:[?#]|$)|countdown|timer|sendtric|niftyimages|motionmail|mailtimers|promofeatures/i

type Tree = {
  m: Measurement
  byId: MeasuredNode[]
  kids: number[][]
  /** Effective opacity and clip, worked out top-down. */
  shown: boolean[]
}

function treeOf(m: Measurement): Tree {
  const byId: MeasuredNode[] = []
  for (const n of m.nodes) byId[n.id] = n
  const kids: number[][] = byId.map(() => [])
  for (const n of m.nodes)
    if (n.parent >= 0 && kids[n.parent]) kids[n.parent]!.push(n.id)
  const shown: boolean[] = byId.map(() => false)
  const opacity: number[] = byId.map(() => 1)
  const clip: (Rect | null)[] = byId.map(() => null)
  // Snapshot nodes come in document order: a parent before its children.
  for (const n of m.nodes) {
    const p = n.parent >= 0 ? byId[n.parent] : undefined
    const parentShown = p ? shown[p.id]! : true
    const o = (p ? opacity[p.id]! : 1) * (n.style?.opacity ?? 1)
    opacity[n.id] = o
    let c = p ? clip[p.id]! : null
    if (p?.style?.clips && p.box) c = c ? intersect(c, p.box) : p.box
    clip[n.id] = c
    if (n.tag === '#other') {
      // The document itself (and comments): no box, but not hidden.
      shown[n.id] = parentShown && n.parent < 0
      continue
    }
    const box = n.tag === '#text' ? unionOf(n.lines) : n.box
    const inside = !c || !box || area(intersect(c, box)) > 0.5
    shown[n.id] =
      parentShown &&
      !!n.style &&
      n.style.visible &&
      n.style.display !== 'none' &&
      o > 0.05 &&
      inside &&
      (n.tag === '#text' || !!n.box)
  }
  return { m, byId, kids, shown }
}

const area = (r: Rect | null) => (r ? Math.max(0, r.w) * Math.max(0, r.h) : 0)
function intersect(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  return {
    x,
    y,
    w: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - x),
    h: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - y)
  }
}
function unionOf(rects: readonly Rect[]): Rect | null {
  const list = rects.filter((r) => r.w > 0 || r.h > 0)
  if (!list.length) return null
  const x = Math.min(...list.map((r) => r.x))
  const y = Math.min(...list.map((r) => r.y))
  return {
    x,
    y,
    w: Math.max(...list.map((r) => r.x + r.w)) - x,
    h: Math.max(...list.map((r) => r.y + r.h)) - y
  }
}
const near = (a: Rect, b: Rect, d = 1.5) =>
  Math.abs(a.x - b.x) <= d &&
  Math.abs(a.y - b.y) <= d &&
  Math.abs(a.w - b.w) <= d &&
  Math.abs(a.h - b.h) <= d

const isInline = (n: MeasuredNode) =>
  n.tag === '#text' ||
  n.style?.display === 'inline' ||
  n.style?.display === 'contents'

/** A visible text node with words in it. */
const isWords = (t: Tree, n: MeasuredNode) =>
  n.tag === '#text' &&
  t.shown[n.id] &&
  !blank.test(n.text ?? '') &&
  (n.style?.fontSize ?? 0) > 0.5 &&
  !!n.style?.color &&
  n.lines.some((l) => l.w > 0 && l.h > 0)

const isPicture = (t: Tree, n: MeasuredNode) =>
  n.tag === 'img' &&
  t.shown[n.id] &&
  !!n.box &&
  n.box.w > pixelSize &&
  n.box.h > pixelSize

/** Words or a picture somewhere inside. */
function hasInk(t: Tree, id: number, memo: Map<number, boolean>): boolean {
  const known = memo.get(id)
  if (known !== undefined) return known
  const n = t.byId[id]!
  let ink =
    isWords(t, n) ||
    isPicture(t, n) ||
    (n.tag in unsupportedTags && t.shown[id]!)
  if (!ink && t.shown[id])
    for (const k of t.kids[id]!) if (hasInk(t, k, memo)) ink = true
  memo.set(id, ink)
  return ink
}

const hasBorder = (s: MeasuredStyle) =>
  [s.border.top, s.border.right, s.border.bottom, s.border.left].some(
    (b) => b.width >= 0.5 && !!b.color
  )
/** A fill or a border of its own that shows against what is behind it. */
const ownFill = (s: MeasuredStyle | null, behind: string) =>
  !!s && ((!!s.background && s.background !== behind) || hasBorder(s))

function contentBox(n: MeasuredNode): Rect {
  const b = n.box!
  const s = n.style!
  const left = s.padding.left + s.border.left.width
  const right = s.padding.right + s.border.right.width
  const top = s.padding.top + s.border.top.width
  const bottom = s.padding.bottom + s.border.bottom.width
  return {
    x: b.x + left,
    y: b.y + top,
    w: Math.max(0, b.w - left - right),
    h: Math.max(0, b.h - top - bottom)
  }
}

// ---------------------------------------------------------------- pieces

type Piece =
  | { t: 'text'; rect: Rect; part: TextPart }
  | { t: 'image'; rect: Rect; part: ImagePart }
  | { t: 'button'; rect: Rect; part: ButtonPart }
  | { t: 'divider'; rect: Rect; color: string }
  | { t: 'box'; rect: Rect; id: number; bg: string; style: MeasuredStyle }
  | { t: 'group'; rect: Rect; id: number; bg: string }

type Ctx = {
  t: Tree
  ink: Map<number, boolean>
  /** Why the section cannot be copied, once found. */
  unsupported: string | null
  depth: number
}

const r2 = (n: number) => Math.round(n * 100) / 100

/** The nearest link around a node, up to the section's own roots. */
function linkOf(t: Tree, id: number): string | null {
  for (let n: MeasuredNode | undefined = t.byId[id]; n; n = t.byId[n.parent]) {
    if (n.tag === 'a' && n.attrs.href) return safeLink(n.attrs.href)
    if (n.attrs['data-gr-section'] !== undefined) break
  }
  return null
}
function safeLink(href: string): string | null {
  if (href.length > 2_000) return null
  try {
    const u = new URL(href.trim())
    if (!['https:', 'http:', 'mailto:'].includes(u.protocol)) return null
    if (u.username || u.password) return null
    return u.toString()
  } catch {
    return null
  }
}
const inlinePicture =
  /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/]+={0,2}$/i
function safePicture(src: string | undefined): string | null {
  const v = (src ?? '').trim()
  if (inlinePicture.test(v)) return v
  try {
    const u = new URL(v)
    return u.protocol === 'https:' && !u.username && !u.password
      ? u.toString()
      : null
  } catch {
    return null
  }
}

/** Whether an ancestor up to `stop` draws a line under or through the words. */
function decoration(t: Tree, id: number, stop: number) {
  let underline = false
  let strike = false
  for (let n = t.byId[id]; n && n.id !== stop; n = t.byId[n.parent]) {
    if (n.style?.underline) underline = true
    if (n.style?.strike) strike = true
    if (!isInline(n) && n.tag !== '#text') break
  }
  return { underline, strike }
}

/** A CSS font-family list with only names in it. */
export function cleanFamily(family: string): string {
  return family
    .split(',')
    .map((f) =>
      f
        .trim()
        .replace(/^["']|["']$/g, '')
        .replace(/[^A-Za-z0-9 -]/g, '')
        .trim()
    )
    .filter(Boolean)
    .slice(0, 8)
    .map((f) => (/\s/.test(f) ? `'${f}'` : f))
    .join(', ')
}

function fontFrom(s: MeasuredStyle, lineHeight: number): FontSpec {
  return {
    family: cleanFamily(s.fontFamily),
    size: r2(Math.min(200, Math.max(1, s.fontSize))),
    weight: s.fontWeight,
    lineHeight: r2(Math.min(400, Math.max(1, lineHeight))),
    italic: s.italic,
    letterSpacing: r2(Math.max(-20, Math.min(60, s.letterSpacing))),
    transform: s.transform
  }
}

/** Groups line pieces into lines (pieces that overlap vertically share one). */
function linesOf(pieces: readonly Rect[]) {
  const sorted = [...pieces]
    .filter((p) => p.h > 0)
    .sort((a, b) => a.y - b.y || a.x - b.x)
  const lines: { top: number; bottom: number; glyph: number }[] = []
  for (const p of sorted) {
    const last = lines.at(-1)
    if (last && p.y < last.bottom - Math.min(2, p.h / 3)) {
      last.top = Math.min(last.top, p.y)
      last.bottom = Math.max(last.bottom, p.y + p.h)
      last.glyph = Math.max(last.glyph, p.h)
    } else lines.push({ top: p.y, bottom: p.y + p.h, glyph: p.h })
  }
  return lines
}

/**
 * Words written one after another inside a block (its inline content):
 * the text part, its runs and its box. The box is as wide as the block's
 * content (where the words wrap) and as tall as its lines.
 */
function textPiece(
  ctx: Ctx,
  owner: MeasuredNode,
  nodes: readonly number[],
  whole: boolean
): Piece | null {
  const { t } = ctx
  const words = nodes.map((id) => t.byId[id]!).filter((n) => isWords(t, n))
  if (!words.length) return null
  // The look most of the words have is the text's own; runs say the rest.
  const chars = new Map<string, { n: number; style: MeasuredStyle }>()
  for (const w of words) {
    const s = w.style!
    const key = [
      s.fontFamily,
      s.fontSize,
      s.fontWeight,
      s.italic,
      s.color
    ].join('|')
    const e = chars.get(key) ?? { n: 0, style: s }
    e.n += (w.text ?? '').length
    chars.set(key, e)
  }
  const main = [...chars.values()].sort((a, b) => b.n - a.n)[0]!.style
  const lines = linesOf(words.flatMap((w) => w.lines))
  const first = lines[0]!
  const last = lines.at(-1)!
  const cb = contentBox(owner)
  let lh = main.lineHeight ?? owner.style?.lineHeight ?? null
  const derived = lh === null
  if (lh === null) {
    if (lines.length >= 2) lh = (last.top - first.top) / (lines.length - 1)
    else if (whole && cb.h >= first.glyph && cb.h <= first.glyph * 2.5)
      lh = cb.h
    else lh = first.glyph
  }
  lh = Math.max(1, lh)
  const top = first.top - (lh - first.glyph) / 2
  const bottom = last.bottom + (lh - last.glyph) / 2
  let count = Math.max(1, Math.round((bottom - top) / lh))
  const runs: TextRun[] = []
  const main6 = {
    weight: main.fontWeight,
    italic: main.italic,
    color: main.color,
    size: main.fontSize
  }
  for (const id of nodes) {
    const n = t.byId[id]!
    if (n.tag === 'br') {
      runs.push({ text: '\n' })
      continue
    }
    if (!isWords(t, n)) {
      // A blank between two words still separates them.
      if (n.tag === '#text' && t.shown[id] && (n.text ?? '').length)
        runs.push({ text: ' ' })
      continue
    }
    const s = n.style!
    const deco = decoration(t, id, owner.id)
    const href = linkOf(t, id)
    const run: TextRun = {
      text: (n.text ?? '')
        .replace(invisibleChars, '')
        .replace(/[ \t\n\r\f]+/g, ' ')
    }
    if (s.fontWeight !== main6.weight) run.weight = s.fontWeight
    if (s.italic !== main6.italic) run.italic = s.italic
    if (s.color && s.color !== main6.color) run.color = s.color
    if (Math.abs(s.fontSize - main6.size) >= 0.5) run.size = r2(s.fontSize)
    if (deco.underline) run.underline = true
    if (deco.strike) run.strike = true
    if (href) run.href = href
    runs.push(run)
  }
  const tidy = fitRuns(tidyRuns(runs))
  if (!tidy.length) return null
  if (derived && lines.length >= 2) {
    // Line breaks with no words on their line make lines of their own; a
    // 'normal' line height is then the measured height shared evenly
    // (a blank line can be shorter than one with words).
    const blank = tidy.filter(
      (r, i) => r.text === '\n' && tidy[i - 1]?.text === '\n'
    ).length
    count = lines.length + blank
    lh = (bottom - top) / count
  }
  const rect = {
    x: cb.x,
    y: top,
    w: cb.w,
    h: count * lh
  }
  const part: TextPart = {
    type: 'text',
    gapBefore: 0,
    x: 0,
    width: 0,
    height: 0,
    role: 'body',
    runs: tidy,
    font: fontFrom(main, lh),
    color: main.color ?? '#000000',
    align: owner.style?.textAlign ?? 'left',
    lines: Math.min(500, count)
  }
  return { t: 'text', rect, part }
}

const sameLook = (a: TextRun, b: TextRun) =>
  a.weight === b.weight &&
  a.italic === b.italic &&
  a.color === b.color &&
  a.size === b.size &&
  a.underline === b.underline &&
  a.strike === b.strike &&
  a.href === b.href

/**
 * Runs within the blueprint's limits: at most 200, each at most 5,000
 * characters (the rest of a very long text joins the last run, plain).
 */
export function fitRuns(runs: readonly TextRun[]): TextRun[] {
  const out = runs
    .slice(0, 199)
    .map((r) => ({ ...r, text: r.text.slice(0, 5_000) }))
  if (runs.length > 199)
    out.push({
      text: runs
        .slice(199)
        .map((r) => r.text)
        .join('')
        .slice(0, 5_000)
    })
  return out
}

/**
 * White space as a browser shows it: runs of blanks become one, none at
 * the start or end, none around a line break; neighbours with the same
 * look are joined.
 */
export function tidyRuns(runs: readonly TextRun[]): TextRun[] {
  const out: TextRun[] = []
  let atStart = true
  for (const run of runs) {
    let text = run.text
    if (text === '\n') {
      const prev = out.at(-1)
      if (prev) prev.text = prev.text.replace(/ +$/, '')
      out.push({ text: '\n' })
      atStart = true
      continue
    }
    if (atStart || /[ \n]$/.test(out.at(-1)?.text ?? ''))
      text = text.replace(/^ +/, '')
    if (!text) continue
    atStart = false
    const prev = out.at(-1)
    if (prev && prev.text !== '\n' && sameLook(prev, run)) prev.text += text
    else out.push({ ...run, text })
  }
  while (
    out.length &&
    (out.at(-1)!.text === '\n' || !out.at(-1)!.text.trim())
  ) {
    const last = out.at(-1)!
    if (last.text === '\n' || !last.text.trim()) out.pop()
    else break
  }
  const last = out.at(-1)
  if (last) last.text = last.text.replace(/ +$/, '')
  while (out[0]?.text === '\n') out.shift()
  return out.filter((r) => r.text.length > 0)
}

/** The visible words of a subtree, white space collapsed. */
function wordsOf(t: Tree, id: number): string {
  const parts: string[] = []
  const walk = (i: number) => {
    const n = t.byId[i]!
    if (n.tag === '#text') {
      if (isWords(t, n)) parts.push(n.text ?? '')
      return
    }
    if (!t.shown[i]) return
    for (const k of t.kids[i]!) walk(k)
  }
  walk(id)
  return parts.join(' ').replace(invisibleChars, '').replace(/\s+/g, ' ').trim()
}

function anyInside(
  t: Tree,
  id: number,
  test: (n: MeasuredNode) => boolean
): MeasuredNode[] {
  const out: MeasuredNode[] = []
  const walk = (i: number) => {
    const n = t.byId[i]!
    if (test(n)) out.push(n)
    for (const k of t.kids[i]!) walk(k)
  }
  walk(id)
  return out
}

/**
 * A link drawn as a shape: one link, a few words, no picture, and a box
 * with a fill or a border around the words that is not as wide as the
 * section (a full-width coloured bar with a link is a bar of words).
 */
function buttonPiece(
  ctx: Ctx,
  id: number,
  behind: string,
  frameWidth: number
): Piece | null {
  const { t } = ctx
  if (anyInside(t, id, (n) => isPicture(t, n)).length) return null
  const links = anyInside(
    t,
    id,
    (n) => n.tag === 'a' && !!n.attrs.href && t.shown[n.id]!
  )
  if (links.length !== 1) return null
  const link = links[0]!
  const label = wordsOf(t, link.id)
  if (!label || label.length > 60 || label.split(' ').length > 8) return null
  if (wordsOf(t, id) !== label) return null
  // The outermost box around the words with its own fill or border.
  const chain: MeasuredNode[] = []
  for (let n: MeasuredNode | undefined = link; n; n = t.byId[n.parent]) {
    chain.unshift(n)
    if (n.id === id) break
  }
  let bg = behind
  let face: MeasuredNode | null = null
  for (const n of chain) {
    if (!n.box || !n.style) continue
    if (ownFill(n.style, bg)) {
      face = n
      break
    }
    if (n.style.background) bg = n.style.background
  }
  // A link with only a padded fill inside it (Outlook-safe buttons put
  // the fill on the cell and the padding on the link) has its face there.
  if (!face) return null
  const r = face.box!
  if (r.h < 14 || r.h > 110) return null
  if (r.w > frameWidth * 0.92 && face.style!.radius < 2) return null
  const textNodes = anyInside(t, link.id, (n) => isWords(t, n))
  const s = textNodes[0]?.style ?? link.style!
  const lines = linesOf(textNodes.flatMap((n) => n.lines))
  const lh =
    s.lineHeight ??
    (lines.length >= 2
      ? (lines.at(-1)!.top - lines[0]!.top) / (lines.length - 1)
      : (lines[0]?.glyph ?? s.fontSize * 1.2))
  const border = [face.style!.border.top, face.style!.border.left].find(
    (b) => b.width >= 0.5 && b.color
  )
  const part: ButtonPart = {
    type: 'button',
    gapBefore: 0,
    x: 0,
    width: 0,
    height: 0,
    role: 'secondary_button',
    label,
    href: safeLink(link.attrs.href ?? ''),
    font: fontFrom(s, lh),
    color: s.color ?? '#000000',
    background: face.style!.background,
    radius: r2(face.style!.radius),
    border: border ? { width: r2(border.width), color: border.color! } : null,
    lines: Math.max(1, Math.min(10, lines.length))
  }
  return { t: 'button', rect: r, part }
}

function imagePiece(ctx: Ctx, n: MeasuredNode): Piece {
  const src = n.attrs['data-de-src'] ?? n.attrs.src ?? ''
  if (movingPicture.test(src))
    ctx.unsupported ??= 'a countdown timer or moving picture'
  const part: ImagePart = {
    type: 'image',
    gapBefore: 0,
    x: 0,
    width: 0,
    height: 0,
    role: 'photo',
    src: safePicture(src),
    alt: (n.attrs.alt ?? '').replace(/\s+/g, ' ').trim().slice(0, 400),
    href: linkOf(ctx.t, n.id),
    radius: r2(n.style?.radius ?? 0)
  }
  return { t: 'image', rect: n.box!, part }
}

/** A thin filled box or a rule: a divider. */
function dividerPiece(n: MeasuredNode, behind: string): Piece | null {
  const s = n.style
  const b = n.box
  if (!s || !b || b.h > 8 || b.w < 8) return null
  if (s.background && s.background !== behind)
    return { t: 'divider', rect: b, color: s.background }
  const line = [s.border.top, s.border.bottom].find(
    (x) => x.width >= 0.5 && x.color
  )
  if (line)
    return {
      t: 'divider',
      rect: { ...b, h: Math.max(1, b.h) },
      color: line.color!
    }
  return null
}

/**
 * What a box holds, in order: its words (one text part per run of inline
 * content), its pictures, and its block children classified.
 */
function piecesOf(
  ctx: Ctx,
  id: number,
  behind: string,
  frameWidth: number
): Piece[] {
  const { t } = ctx
  const owner = t.byId[id]!
  const out: Piece[] = []
  let inline: number[] = []
  const blockKids: number[] = []
  const inlineImages: number[] = []
  const flush = (whole: boolean) => {
    if (inline.length) {
      const p = textPiece(ctx, owner, inline, whole)
      if (p) out.push(p)
    }
    inline = []
  }
  // Inline content may wrap blocks (a link around a table): those are
  // read as if they were the owner's own children.
  const cannot = (kid: number) => {
    const n = t.byId[kid]!
    if (!(n.tag in unsupportedTags) || !t.shown[kid]) return false
    ctx.unsupported ??= unsupportedTags[n.tag]!
    return true
  }
  const visit = (kid: number) => {
    const n = t.byId[kid]!
    if (n.tag === '#other' || cannot(kid)) return
    if (n.tag === '#text') {
      inline.push(kid)
      return
    }
    if (!t.shown[kid] && !isInline(n)) return
    if (n.tag === 'br') {
      inline.push(kid)
      return
    }
    if (n.tag === 'img') {
      if (isPicture(t, n)) {
        if (isInline(n)) inlineImages.push(kid)
        else {
          flush(false)
          blockKids.push(kid)
          out.push(imagePiece(ctx, n))
        }
      }
      return
    }
    if (isInline(n)) {
      const hasBlock = anyInside(
        t,
        kid,
        (d) =>
          d.id !== kid && d.tag !== '#text' && !isInline(d) && t.shown[d.id]!
      ).length
      if (!hasBlock) {
        for (const k of t.kids[kid]!) visitInline(k)
        return
      }
      for (const k of t.kids[kid]!) visit(k)
      return
    }
    flush(false)
    blockKids.push(kid)
    const p = classify(ctx, kid, behind, frameWidth)
    if (p) out.push(p)
  }
  const visitInline = (kid: number) => {
    const n = t.byId[kid]!
    if (n.tag === '#other' || cannot(kid)) return
    if (n.tag === 'img') {
      if (isPicture(t, n)) inlineImages.push(kid)
      return
    }
    if (n.tag === '#text' || n.tag === 'br') {
      inline.push(kid)
      return
    }
    if (!isInline(n)) {
      // An inline-block inside a line (a link styled as a button).
      flush(false)
      blockKids.push(kid)
      const p = classify(ctx, kid, behind, frameWidth)
      if (p) out.push(p)
      return
    }
    for (const k of t.kids[kid]!) visitInline(k)
  }
  for (const kid of t.kids[id]!) visit(kid)
  flush(blockKids.length === 0 && inlineImages.length === 0)
  for (const img of inlineImages) {
    const pic = imagePiece(ctx, t.byId[img]!)
    // Words that start after a picture on the same line wrap beside it.
    for (const p of out) {
      if (p.t !== 'text') continue
      const r = p.rect
      const b = pic.rect
      const sameLine = b.y < r.y + r.h && b.y + b.h > r.y
      if (sameLine && b.x + b.w <= r.x + r.w && b.x <= r.x + 1) {
        const right = r.x + r.w
        r.x = Math.min(right, b.x + b.w)
        r.w = right - r.x
      }
    }
    out.push(pic)
  }
  return out
}

/** One block child: a picture, a rule, a button, a card (box) or a wrapper (group). */
function classify(
  ctx: Ctx,
  id: number,
  behind: string,
  frameWidth: number
): Piece | null {
  const { t } = ctx
  const n = t.byId[id]!
  if (!t.shown[id] || !n.box || !n.style) return null
  if (n.tag in unsupportedTags) {
    ctx.unsupported ??= unsupportedTags[n.tag]!
    return { t: 'group', rect: n.box, id, bg: behind }
  }
  if (n.style.backgroundImage)
    ctx.unsupported ??= 'words or shapes over a background picture'
  if (n.tag === 'img') return isPicture(t, n) ? imagePiece(ctx, n) : null
  if (n.tag === 'hr') {
    const line = n.style.border.top.color ?? n.style.background ?? '#cccccc'
    return { t: 'divider', rect: n.box, color: line }
  }
  if (n.box.w < 0.5 || n.box.h < 0.5) return null
  if (!hasInk(t, id, ctx.ink)) {
    const d = dividerPiece(n, behind)
    if (d) return d
    if (ownFill(n.style, behind) && n.box.h > 8)
      return {
        t: 'box',
        rect: n.box,
        id,
        bg: n.style.background ?? behind,
        style: n.style
      }
    return null
  }
  const button = buttonPiece(ctx, id, behind, frameWidth)
  if (button) return button
  if (ownFill(n.style, behind))
    return {
      t: 'box',
      rect: n.box,
      id,
      bg: n.style.background ?? behind,
      style: n.style
    }
  return { t: 'group', rect: n.box, id, bg: n.style.background ?? behind }
}

// ------------------------------------------------------------- the stack

type Node =
  | { t: 'part'; rect: Rect; part: Part }
  | { t: 'row'; rect: Rect; columns: Col[] }
type Col = {
  rect: Rect
  background: string | null
  radius: number
  border: { width: number; color: string } | null
  items: Node[]
}

/** Pieces that overlap vertically stand side by side: one band. */
function bands<T extends { rect: Rect }>(pieces: readonly T[]): T[][] {
  const sorted = [...pieces].sort(
    (a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x
  )
  const out: { list: T[]; bottom: number }[] = []
  for (const p of sorted) {
    const last = out.at(-1)
    const overlap = last ? last.bottom - p.rect.y : 0
    if (last && overlap > Math.min(2, p.rect.h / 2)) {
      last.list.push(p)
      last.bottom = Math.max(last.bottom, p.rect.y + p.rect.h)
    } else out.push({ list: [p], bottom: p.rect.y + p.rect.h })
  }
  return out.map((b) => b.list)
}

function partNode(p: Piece): Node | null {
  if (p.t === 'text' || p.t === 'image' || p.t === 'button')
    return { t: 'part', rect: p.rect, part: p.part }
  if (p.t === 'divider')
    return {
      t: 'part',
      rect: p.rect,
      part: {
        type: 'divider',
        gapBefore: 0,
        x: 0,
        width: 0,
        height: 0,
        role: 'divider',
        color: p.color
      }
    }
  return null
}

const borderOf = (s: MeasuredStyle) => {
  const b = [s.border.top, s.border.left, s.border.right, s.border.bottom].find(
    (x) => x.width >= 0.5 && x.color
  )
  return b ? { width: r2(b.width), color: b.color! } : null
}

/**
 * A column from a cell or a card. Wrappers that fill it exactly (a cell
 * around a filled table, a table around a filled cell) are looked through,
 * so however the builder nests them, the column has one fill and one set
 * of items.
 */
function columnFrom(ctx: Ctx, id: number, behind: string): Col {
  const { t } = ctx
  let node = t.byId[id]!
  const rect = node.box!
  let fill: MeasuredStyle | null = null
  let bg = behind
  for (let guard = 0; guard < 50; guard++) {
    const s = node.style
    if (s && ownFill(s, bg)) {
      fill = s
      bg = s.background ?? bg
    }
    if (t.kids[node.id]!.some((k) => isWords(t, t.byId[k]!))) break
    const solid = t.kids[node.id]!.filter((k) => {
      const kid = t.byId[k]!
      return (
        kid.tag !== '#text' &&
        kid.tag !== '#other' &&
        t.shown[k] &&
        (hasInk(t, k, ctx.ink) || ownFill(kid.style, bg))
      )
    })
    if (solid.length !== 1) break
    const kid = t.byId[solid[0]!]!
    if (
      !kid.box ||
      !kid.style ||
      !near(kid.box, rect) ||
      kid.tag === 'img' ||
      isInline(kid)
    )
      break
    // A second fill inside the first stays a card of its own.
    if (fill && ownFill(kid.style, bg)) break
    if (buttonPiece(ctx, kid.id, bg, rect.w)) break
    node = kid
  }
  return {
    rect,
    background: fill?.background ?? null,
    radius: fill ? r2(fill.radius) : 0,
    border: fill ? borderOf(fill) : null,
    items: nodesOf(ctx, piecesOf(ctx, node.id, bg, rect.w), bg, rect.w)
  }
}

function nodesOf(
  ctx: Ctx,
  pieces: readonly Piece[],
  behind: string,
  frameWidth: number
): Node[] {
  if (ctx.depth >= maxDepth)
    throw new Error('This email nests too deep to measure.')
  ctx.depth++
  try {
    return bandNodes(ctx, pieces, behind, frameWidth)
  } finally {
    ctx.depth--
  }
}

/** Real emails nest a few dozen boxes deep; deeper ones are refused. */
const maxDepth = 200
/** The most columns side by side the blueprint keeps. */
const maxColumns = 12

function bandNodes(
  ctx: Ctx,
  pieces: readonly Piece[],
  behind: string,
  frameWidth: number
): Node[] {
  const out: Node[] = []
  for (const band of bands(pieces)) {
    if (band.length === 1) {
      const p = band[0]!
      if (p.t === 'group')
        out.push(
          ...nodesOf(
            ctx,
            piecesOf(ctx, p.id, p.bg, frameWidth),
            p.bg,
            frameWidth
          )
        )
      else if (p.t === 'box')
        out.push({
          t: 'row',
          rect: p.rect,
          columns: [columnFrom(ctx, p.id, behind)]
        })
      else {
        const node = partNode(p)
        if (node) out.push(node)
      }
      continue
    }
    const columns: Col[] = []
    for (const p of [...band].sort((a, b) => a.rect.x - b.rect.x)) {
      if (p.t === 'group' || p.t === 'box')
        columns.push(columnFrom(ctx, p.id, behind))
      else {
        const node = partNode(p)
        if (node)
          columns.push({
            rect: p.rect,
            background: null,
            radius: 0,
            border: null,
            items: [node]
          })
      }
    }
    if (!columns.length) continue
    if (columns.length > maxColumns) {
      ctx.unsupported ??= `more than ${maxColumns} columns side by side`
      columns.length = maxColumns
    }
    const rect = unionOf(columns.map((c) => c.rect))!
    out.push({ t: 'row', rect, columns })
  }
  return out
}

// ------------------------------------------------- relative coordinates

const snap = Math.round

function toItems(
  nodes: readonly Node[],
  frame: Rect,
  depth: number
): { items: Item[]; end: number } {
  const sorted = [...nodes].sort(
    (a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x
  )
  const items: Item[] = []
  let prev = snap(frame.y)
  for (const node of sorted) {
    const top = snap(node.rect.y)
    const bottom = Math.max(top, snap(node.rect.y + node.rect.h))
    const gapBefore = top - prev
    if (node.t === 'part') {
      const left = snap(node.rect.x)
      const width = Math.max(0, snap(node.rect.x + node.rect.w) - left)
      const height = node.part.type === 'text' ? r2(node.rect.h) : bottom - top
      items.push({
        ...node.part,
        gapBefore,
        x: left - snap(frame.x),
        width,
        height
      } as Part)
      prev =
        node.part.type === 'text' ? snap(node.rect.y + node.rect.h) : bottom
      continue
    }
    if (depth >= maxNesting) {
      // Too deep to keep as rows: its parts are stacked instead.
      const flat = node.columns.flatMap((c) => c.items)
      const inner = toItems(flat, { ...frame, y: prev }, depth)
      items.push(...inner.items)
      prev = inner.end
      continue
    }
    const columns: Column[] = node.columns.map((c) => {
      const cx = snap(c.rect.x)
      const cy = snap(c.rect.y)
      const cw = Math.max(0, snap(c.rect.x + c.rect.w) - cx)
      const ch = Math.max(0, snap(c.rect.y + c.rect.h) - cy)
      const inner = toItems(c.items, { x: cx, y: cy, w: cw, h: ch }, depth + 1)
      return {
        x: cx - snap(frame.x),
        y: cy - top,
        width: cw,
        height: ch,
        background: c.background,
        radius: c.radius,
        border: c.border,
        items: inner.items,
        bottom: cy + ch - inner.end
      }
    })
    const rowBottom = Math.max(...columns.map((c) => top + c.y + c.height))
    items.push({
      type: 'row',
      gapBefore,
      height: rowBottom - top,
      keepOnPhone: false,
      columns
    })
    prev = rowBottom
  }
  return { items, end: prev }
}

// ---------------------------------------------------------------- email

/** The colour behind a node: its own fill or the nearest one above it. */
function fillBehind(t: Tree, id: number, page: string): string {
  for (let n = t.byId[id]; n; n = t.byId[n.parent])
    if (n.style?.background) return n.style.background
  return page
}

export type MeasureResult =
  { ok: true; blueprint: Blueprint } | { ok: false; error: string }

/**
 * The blueprint of a measured email. Sections are its `data-gr-section`
 * elements; an email without any gives an error (mark it first).
 */
export type MeasureOptions = {
  /**
   * Number sections by their marks rather than by position: a redraw keeps
   * its source's numbers, also when a section was left out of it.
   */
  ordinalsFromMarks?: boolean
  /** The source's reading of roles, so a redraw is read the same way. */
  roles?: RoleContext
}

export function blueprintFrom(
  m: Measurement,
  options: MeasureOptions = {}
): MeasureResult {
  try {
    return measureEmail(m, options)
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : 'The email could not be measured.'
    }
  }
}

function measureEmail(m: Measurement, options: MeasureOptions): MeasureResult {
  const t = treeOf(m)
  const marked = new Map<string, number[]>()
  for (const n of m.nodes)
    if (n.attrs['data-gr-section'] !== undefined && t.shown[n.id] && n.box) {
      const key = n.attrs['data-gr-section']!
      // An element inside another of the same section is part of it already.
      const list = marked.get(key) ?? []
      if (!list.some((a) => isAncestor(t, a, n.id))) list.push(n.id)
      marked.set(key, list)
    }
  const groups = [...marked.entries()]
    .map(([key, ids]) => ({
      mark: Number(key),
      ids,
      rect: unionOf(ids.map((i) => t.byId[i]!.box!))!
    }))
    .filter((g) => g.rect.w > 0 && g.rect.h > 0)
    .sort((a, b) => a.rect.y - b.rect.y)
    .slice(0, maxBlueprintSections)
  if (!groups.length)
    return { ok: false, error: 'The email has no sections to measure.' }
  if (
    options.ordinalsFromMarks &&
    !groups.every(
      (g, i) =>
        Number.isInteger(g.mark) &&
        g.mark >= 1 &&
        g.mark <= maxBlueprintSections &&
        (i === 0 || g.mark > groups[i - 1]!.mark)
    )
  )
    return {
      ok: false,
      error: 'The sections are not marked 1, 2, 3… in order.'
    }
  const html = m.nodes.find((n) => n.tag === 'html')
  const body = m.nodes.find((n) => n.tag === 'body')
  let page = body?.style?.background ?? html?.style?.background ?? '#ffffff'
  const all = groups.flatMap((g) => g.ids)
  // The drawing code marks its own email box; elsewhere it is the
  // smallest element holding every section.
  const lca =
    m.nodes.find((n) => n.attrs['data-de-email'] !== undefined && t.shown[n.id])
      ?.id ?? all.reduce((a, b) => commonAncestor(t, a, b))
  const left = Math.min(...groups.map((g) => g.rect.x))
  const right = Math.max(...groups.map((g) => g.rect.x + g.rect.w))
  const width = snap(right) - snap(left)
  if (width < minEmailWidth || width > maxEmailWidth)
    return {
      ok: false,
      error: `The email is ${width} px wide; ${minEmailWidth} to ${maxEmailWidth} can be measured.`
    }
  // The page: the nearest fill above the email that is wider than it (a
  // full-width wrapper table), else the body's.
  for (let n = t.byId[t.byId[lca]!.parent]; n; n = t.byId[n.parent])
    if (n.style?.background && n.box && n.box.w > width + 2) {
      page = n.style.background
      break
    }
  const emailFill = fillBehind(t, lca, page)
  const lcaBox = t.byId[lca]?.box
  const top = snap(Math.min(lcaBox?.y ?? groups[0]!.rect.y, groups[0]!.rect.y))
  const sections: Section[] = []
  let prev = top
  for (const [i, g] of groups.entries()) {
    const ctx: Ctx = { t, ink: new Map(), unsupported: null, depth: 0 }
    const first = t.byId[g.ids[0]!]!
    const around = fillBehind(t, first.parent, page)
    // The section's own fill: its roots' and any cell that fills it whole.
    let fill: string | null = null
    if (g.ids.length === 1) {
      let n: MeasuredNode | undefined = first
      while (n && n.box && near(n.box, g.rect)) {
        if (n.style?.backgroundImage)
          ctx.unsupported ??= 'words or shapes over a background picture'
        if (n.style?.background) fill = n.style.background
        const inky: number[] = t.kids[n.id]!.filter((k) =>
          hasInk(t, k, ctx.ink)
        )
        n = inky.length === 1 ? t.byId[inky[0]!] : undefined
      }
    }
    const behind = fill ?? around
    const pieces: Piece[] = []
    for (const id of g.ids) {
      const p = classify(ctx, id, behind, g.rect.w)
      if (p) pieces.push(p)
    }
    const nodes = nodesOf(ctx, pieces, behind, g.rect.w)
    const sy = snap(g.rect.y)
    const sb = snap(g.rect.y + g.rect.h)
    const sx = snap(g.rect.x)
    const inner = toItems(
      nodes,
      { x: sx, y: sy, w: snap(g.rect.x + g.rect.w) - sx, h: sb - sy },
      0
    )
    sections.push({
      ordinal: options.ordinalsFromMarks ? g.mark : i + 1,
      kind: 'mixed',
      gapBefore: Math.max(0, sy - prev),
      x: sx - snap(left),
      width: snap(g.rect.x + g.rect.w) - sx,
      height: sb - sy,
      background: fill && fill !== around ? fill : null,
      around,
      items: inner.items,
      bottom: sb - inner.end,
      unsupported: ctx.unsupported
    })
    prev = Math.max(prev, sb)
  }
  const end = snap(lcaBox ? lcaBox.y + lcaBox.h : prev)
  const draft: Blueprint = {
    version: BLUEPRINT_VERSION,
    width,
    page,
    body: emailFill,
    sections,
    bottom: Math.max(0, Math.min(400, end - prev)),
    margin: {
      top: Math.max(0, Math.min(400, top)),
      bottom: Math.max(
        0,
        Math.min(400, snap(body?.box ? body.box.y + body.box.h : end) - end)
      )
    }
  }
  const parsed = parseBlueprint(markRoles(draft, options.roles))
  return parsed.ok
    ? { ok: true, blueprint: parsed.blueprint }
    : { ok: false, error: parsed.error }
}

function isAncestor(t: Tree, a: number, b: number) {
  for (let n = t.byId[b]; n; n = t.byId[n.parent])
    if (n.parent === a) return true
  return false
}

function commonAncestor(t: Tree, a: number, b: number): number {
  const seen = new Set<number>()
  for (let n = t.byId[a]; n; n = t.byId[n.parent]) seen.add(n.id)
  for (let n = t.byId[b]; n; n = t.byId[n.parent])
    if (seen.has(n.id)) return n.id
  return a
}

/** Every column of a list of items, depth first (for tests and checks). */
export function columnsOf(items: readonly Item[]): Column[] {
  const out: Column[] = []
  for (const item of items)
    if (item.type === 'row')
      for (const c of item.columns) {
        out.push(c)
        out.push(...columnsOf(c.items))
      }
  return out
}
