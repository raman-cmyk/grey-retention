import {
  blockMobileCss,
  emailBytes,
  escapeHtml,
  safeUrl
} from '@/features/blocks/render'
import type { BlockBrand } from '@/features/blocks/brand'
import type {
  Blueprint,
  ButtonPart,
  Column,
  DividerPart,
  ImagePart,
  Item,
  RowItem,
  TextPart,
  TextRun
} from './blueprint'
import { blueprintSchema } from './blueprint'
import { safeFontStack } from './fonts'
import { klaviyoFooterTags } from '@/features/blocks/klaviyo-tags'

/**
 * DES-ENGINE-001, the new drawing code: a blueprint as safe email HTML.
 * Nested tables with inline styles and `bgcolor` attributes (Gmail and
 * Outlook), the email's own width (600 for almost every email), every gap,
 * padding, column, text size, line height, button and picture at its
 * measured size, and a phone layout under 620 px (as the block library's,
 * `features/blocks/render.ts`): columns stack, side margins shrink to
 * 16 px, pictures shrink to fit. No script, form, web font or outside
 * style sheet; every word is escaped (including `{` and `}`, so copy never
 * becomes a Klaviyo tag).
 *
 * Each section's table carries `data-gr-section="n"`, the inbox's own
 * section mark, so the measuring tool cuts a redraw exactly as it cut the
 * original. `preview` mode also takes inline pictures (the golden test);
 * `klaviyo` mode takes only https pictures, as everything sent does.
 */
export type DrawMode = 'preview' | 'klaviyo'

export class DrawError extends Error {}

export type DrawOptions = {
  mode?: DrawMode
  title?: string
  preheader?: string
  /**
   * Sections drawn by something else (the closest library block): their
   * `<tr>` rows for a 600 px container, by ordinal.
   */
  replaced?: ReadonlyMap<number, string>
  /** The brand a replaced section was drawn in (for its phone styles). */
  brand?: BlockBrand
}

/** Above this, a side margin shrinks to 16 px on a phone. */
const phoneMargin = 16

const n = (v: number) => String(Math.round(v * 100) / 100)
const pxv = (v: number) => `${n(v)}px`

const spacer = (height: number, fill?: string | null) =>
  height >= 0.5
    ? `<tr><td height="${Math.round(height)}"${fill ? ` bgcolor="${fill}"` : ''} style="height:${pxv(height)};${fill ? `background:${fill};` : ''}font-size:0;line-height:0">&nbsp;</td></tr>`
    : ''

const presentation =
  'role="presentation" cellpadding="0" cellspacing="0" border="0"'

/** Left and right space of a part inside the space it sits in. */
function sides(x: number, width: number, avail: number) {
  const left = Math.max(0, x)
  const right = Math.max(0, avail - x - width)
  return { left, right }
}

type Align = 'left' | 'center' | 'right'
function alignOf(left: number, right: number): Align {
  if (left > 2 && Math.abs(left - right) <= 2) return 'center'
  if (right <= 2 && left > 2) return 'right'
  return 'left'
}

const phoneClass = (left: number, right: number) =>
  left > phoneMargin || right > phoneMargin ? ' class="de-p"' : ''

/** Klaviyo's footer tags by a run's `tag` (DES-ENGINE-002). */
const runTags: Record<NonNullable<TextRun['tag']>, string> = {
  organization: klaviyoFooterTags.organization,
  address: klaviyoFooterTags.address,
  unsubscribe: klaviyoFooterTags.unsubscribe,
  preferences: klaviyoFooterTags.preferences,
  web_view: klaviyoFooterTags.webView
}

function runHtml(run: TextRun, part: TextPart, mode: DrawMode): string {
  // In Klaviyo mode a footer run is Klaviyo's own tag, which Klaviyo
  // fills per recipient when it sends; a preview shows the run's words.
  if (run.tag && mode === 'klaviyo') {
    const color = run.color ?? part.color
    const line = run.underline ? ';text-decoration:underline' : ''
    return `<span style="color:${color}${line}">${runTags[run.tag]}</span>`
  }
  const words = run.text
    .split('\n')
    .map((line) => escapeHtml(line))
    .join('<br>')
  const css: string[] = []
  if (run.weight !== undefined) css.push(`font-weight:${run.weight}`)
  if (run.italic !== undefined)
    css.push(`font-style:${run.italic ? 'italic' : 'normal'}`)
  if (run.size !== undefined) css.push(`font-size:${pxv(run.size)}`)
  const decoration = [
    run.underline ? 'underline' : '',
    run.strike ? 'line-through' : ''
  ]
    .filter(Boolean)
    .join(' ')
  if (run.href) {
    css.push(`color:${run.color ?? part.color}`)
    css.push(`text-decoration:${decoration || 'none'}`)
    return `<a href="${safeUrl(run.href)}" target="_blank" style="${css.join(';')}">${words}</a>`
  }
  if (run.color) css.push(`color:${run.color}`)
  if (decoration) css.push(`text-decoration:${decoration}`)
  return css.length ? `<span style="${css.join(';')}">${words}</span>` : words
}

const fontCss = (f: TextPart['font']) =>
  [
    `font-family:${safeFontStack(f.family)}`,
    `font-size:${pxv(f.size)}`,
    `line-height:${pxv(f.lineHeight)}`,
    `font-weight:${f.weight}`,
    f.italic ? 'font-style:italic' : '',
    f.letterSpacing ? `letter-spacing:${pxv(f.letterSpacing)}` : '',
    f.transform !== 'none' ? `text-transform:${f.transform}` : ''
  ]
    .filter(Boolean)
    .join(';')

type Ctx = { mode: DrawMode; headlines: number }

function textRow(p: TextPart, avail: number, ctx: Ctx) {
  const { left, right } = sides(p.x, p.width, avail)
  const tag =
    p.role === 'headline'
      ? ctx.headlines++ === 0
        ? 'h1'
        : 'h2'
      : p.role === 'subheadline'
        ? 'h2'
        : 'p'
  const body = p.runs.map((r) => runHtml(r, p, ctx.mode)).join('')
  return `<tr><td${phoneClass(left, right)} align="${p.align === 'justify' ? 'left' : p.align}" style="padding:0 ${pxv(right)} 0 ${pxv(left)}"><${tag} style="margin:0;${fontCss(p.font)};color:${p.color};text-align:${p.align}">${body}</${tag}></td></tr>`
}

function pictureSrc(src: string, mode: DrawMode) {
  if (src.startsWith('data:')) {
    if (mode === 'klaviyo')
      throw new DrawError(
        'Upload every picture to Klaviyo before it goes into an email.'
      )
    // The schema took only PNG, JPEG, GIF or WebP inline pictures.
    if (
      !/^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/]+={0,2}$/i.test(src)
    )
      throw new DrawError('Only PNG, JPEG, GIF or WebP pictures can be drawn.')
    return escapeHtml(src)
  }
  return safeUrl(src)
}

/** A cell that places something `width` wide at `x` inside `avail`. */
function placedCell(x: number, width: number, avail: number, inner: string) {
  const { left, right } = sides(x, width, avail)
  const align = alignOf(left, right)
  const pad =
    align === 'center'
      ? '0'
      : align === 'right'
        ? `0 ${pxv(right)} 0 0`
        : `0 0 0 ${pxv(left)}`
  return {
    align,
    html: `<tr><td${phoneClass(align === 'right' ? 0 : left, align === 'left' ? 0 : right)} align="${align}" style="padding:${pad}">${inner}</td></tr>`
  }
}

function placeholder(p: ImagePart, mode: DrawMode) {
  if (mode === 'klaviyo')
    throw new DrawError(
      'A picture of this email could not be kept: replace it before it goes to Klaviyo.'
    )
  const w = Math.max(1, Math.round(p.width))
  const h = Math.max(1, Math.round(p.height))
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#e3e3e3"/></svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

function imageRow(p: ImagePart, avail: number, ctx: Ctx) {
  const { left, right } = sides(p.x, p.width, avail)
  const align = alignOf(left, right)
  const margin =
    align === 'center'
      ? 'margin:0 auto;'
      : align === 'right'
        ? 'margin:0 0 0 auto;'
        : ''
  const radius = p.radius ? `border-radius:${pxv(p.radius)};` : ''
  const size = `width:${pxv(p.width)};height:${pxv(p.height)};`
  // A picture that could not be kept is drawn as a grey picture of its
  // size, so it is still a picture where it was (previews only).
  const src = p.src ? pictureSrc(p.src, ctx.mode) : placeholder(p, ctx.mode)
  const img = `<img class="de-i" src="${src}" alt="${escapeHtml(p.alt)}" width="${Math.round(p.width)}" height="${Math.round(p.height)}" style="display:block;${margin}${size}${radius}border:0;outline:none;text-decoration:none">`
  const linked = p.href
    ? `<a href="${safeUrl(p.href)}" target="_blank" style="text-decoration:none">${img}</a>`
    : img
  return placedCell(p.x, p.width, avail, linked).html
}

function buttonRow(p: ButtonPart, avail: number) {
  const b = p.border?.width ?? 0
  const innerW = Math.max(0, p.width - 2 * b)
  const innerH = Math.max(0, p.height - 2 * b)
  let lh = p.font.lineHeight
  if (p.lines * lh > innerH) lh = innerH / Math.max(1, p.lines)
  const free = Math.max(0, innerH - p.lines * lh)
  const top = Math.floor(free / 2)
  const bottom = free - top
  const { left, right } = sides(p.x, p.width, avail)
  const align = alignOf(left, right)
  const fill = p.background ? ` bgcolor="${p.background}"` : ''
  const faceCss = [
    p.background ? `background:${p.background}` : '',
    p.radius ? `border-radius:${pxv(p.radius)}` : '',
    p.border ? `border:${pxv(p.border.width)} solid ${p.border.color}` : ''
  ]
    .filter(Boolean)
    .join(';')
  const linkCss = [
    'display:block',
    `width:${pxv(innerW)}`,
    `padding:${pxv(top)} 0 ${pxv(bottom)}`,
    fontCss({ ...p.font, lineHeight: lh }),
    `color:${p.color}`,
    'text-decoration:none',
    'text-align:center',
    p.radius ? `border-radius:${pxv(p.radius)}` : ''
  ]
    .filter(Boolean)
    .join(';')
  const margin =
    align === 'center'
      ? 'margin:0 auto;'
      : align === 'right'
        ? 'margin:0 0 0 auto;'
        : ''
  const face = `<table ${presentation} class="de-b" style="${margin}border-collapse:separate"><tr><td align="center"${fill} style="${faceCss}"><a href="${p.href ? safeUrl(p.href) : '#'}" target="_blank" style="${linkCss}">${escapeHtml(p.label)}</a></td></tr></table>`
  return placedCell(p.x, p.width, avail, face).html
}

function dividerRow(p: DividerPart, avail: number) {
  const { left, right } = sides(p.x, p.width, avail)
  const align = alignOf(left, right)
  const margin =
    align === 'center'
      ? 'margin:0 auto;'
      : align === 'right'
        ? 'margin:0 0 0 auto;'
        : ''
  const line = `<table ${presentation} width="${Math.round(p.width)}" class="de-d" style="${margin}width:${pxv(p.width)}"><tr><td height="${Math.max(1, Math.round(p.height))}" bgcolor="${p.color}" style="height:${pxv(p.height)};background:${p.color};font-size:0;line-height:0">&nbsp;</td></tr></table>`
  return placedCell(p.x, p.width, avail, line).html
}

function columnCell(c: Column, ctx: Ctx, keep: boolean, last: boolean) {
  const b = c.border?.width ?? 0
  const inner = Math.max(0, c.width - 2 * b)
  const rows = stack(
    c.items.map((i) => shift(i, -b)),
    inner,
    c.bottom - b,
    ctx,
    b
  )
  const filled = c.background || c.border || c.radius
  const css = [
    c.background ? `background:${c.background}` : '',
    c.border ? `border:${pxv(c.border.width)} solid ${c.border.color}` : '',
    c.radius ? `border-radius:${pxv(c.radius)}` : ''
  ]
    .filter(Boolean)
    .join(';')
  const body = filled
    ? `<table ${presentation} width="100%"${c.background ? ` bgcolor="${c.background}"` : ''} style="width:100%;border-collapse:separate;${css}">${rows}</table>`
    : `<table ${presentation} width="100%" style="width:100%">${rows}</table>`
  const top = c.y > 0 ? `padding-top:${pxv(c.y)};` : ''
  return `<td${keep ? '' : last ? ' class="de-c"' : ' class="de-c de-s"'} width="${Math.round(c.width)}" valign="top" style="width:${pxv(c.width)};${top}vertical-align:top">${body}</td>`
}

/** An item moved `dx` to the right (inside a border, everything moves in). */
function shift(item: Item, dx: number): Item {
  return item.type === 'row'
    ? { ...item, columns: item.columns.map((c) => ({ ...c, x: c.x + dx })) }
    : { ...item, x: item.x + dx }
}

function rowRow(r: RowItem, avail: number, ctx: Ctx) {
  const cells: string[] = []
  let cursor = 0
  const gap = (w: number) =>
    w >= 0.5
      ? `<td${r.keepOnPhone ? '' : ' class="de-g"'} width="${Math.round(w)}" style="width:${pxv(w)};font-size:0;line-height:0"></td>`
      : ''
  const sorted = [...r.columns].sort((a, b) => a.x - b.x)
  for (const [i, c] of sorted.entries()) {
    cells.push(gap(c.x - cursor))
    cells.push(columnCell(c, ctx, r.keepOnPhone, i === sorted.length - 1))
    cursor = Math.max(cursor, c.x + c.width)
  }
  cells.push(gap(avail - cursor))
  return `<tr><td><table ${presentation} width="100%" style="width:100%"><tr>${cells.join('')}</tr></table></td></tr>`
}

/**
 * The rows of a stack: each item below the one above it by its gap, then
 * the space after the last one. `top` is space already taken by a border.
 */
function stack(
  items: readonly Item[],
  avail: number,
  bottom: number,
  ctx: Ctx,
  top = 0
): string {
  const rows: string[] = []
  items.forEach((item, i) => {
    rows.push(spacer(i === 0 ? item.gapBefore - top : item.gapBefore))
    if (item.type === 'row') rows.push(rowRow(item, avail, ctx))
    else if (item.type === 'text') rows.push(textRow(item, avail, ctx))
    else if (item.type === 'image') rows.push(imageRow(item, avail, ctx))
    else if (item.type === 'button') rows.push(buttonRow(item, avail))
    else rows.push(dividerRow(item, avail))
  })
  if (!items.length) rows.push(spacer(bottom + 0 - top))
  else rows.push(spacer(bottom))
  const out = rows.join('')
  // A table with no rows at all is not valid; an empty box keeps one.
  return out || '<tr><td style="font-size:0;line-height:0"></td></tr>'
}

const phoneCss = `@media only screen and (max-width:620px){.de-w{width:100%!important;max-width:100%!important}.de-c{display:block!important;width:100%!important;max-width:100%!important;box-sizing:border-box}.de-g{display:none!important}.de-m{max-width:100%!important}.de-p{padding-left:${phoneMargin}px!important;padding-right:${phoneMargin}px!important}.de-i{max-width:100%!important;height:auto!important}.de-b,.de-d{max-width:100%!important}.de-c .de-i{margin-left:auto!important;margin-right:auto!important}.de-s{padding-bottom:16px!important}}`

/**
 * One section's row: its table at its place, the fill around it. A
 * narrow centred section (a logo cell) stays centred and keeps its width
 * on a phone unless the screen is narrower; a wide one fills the phone.
 */
function sectionRow(
  ordinal: number,
  x: number,
  width: number,
  right: number,
  around: string,
  fill: string | null,
  inner: string
) {
  const centred = x > 2 && Math.abs(x - right) <= 2
  const narrow = width <= 480
  const pad = centred ? '0' : `0 ${pxv(right)} 0 ${pxv(Math.max(0, x))}`
  const cls = narrow ? 'de-m' : 'de-w'
  return `<tr><td${centred ? '' : phoneClass(x, right)} align="${centred ? 'center' : 'left'}" bgcolor="${around}" style="padding:${pad};background:${around}"><table data-gr-section="${ordinal}" class="${cls}" ${presentation} width="${Math.round(width)}"${fill ? ` bgcolor="${fill}"` : ''} style="${centred ? 'margin:0 auto;' : ''}width:${pxv(width)};${fill ? `background:${fill}` : ''}">${inner}</table></td></tr>`
}

/** A section drawn by something else, marked as that section. */
function markedRows(rows: string, ordinal: number) {
  return rows.replace(/^\s*<tr\b/i, `<tr data-gr-section="${ordinal}"`)
}

/** The blueprint as a whole email document. */
export function drawBlueprint(
  input: Blueprint,
  options: DrawOptions = {}
): string {
  // Whatever a blueprint went through (stored, corrected), it is checked
  // again before a byte of it reaches HTML.
  const parsed = blueprintSchema.safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new DrawError(
      `The blueprint is not valid: ${issue?.path.join('.') || 'blueprint'}: ${issue?.message ?? 'not valid'}`
    )
  }
  const bp = parsed.data
  const mode = options.mode ?? 'preview'
  if (mode === 'klaviyo' && options.replaced?.size && !options.brand)
    throw new DrawError(
      'A section built from a library block needs the brand before it goes to Klaviyo.'
    )
  const ctx: Ctx = { mode, headlines: 0 }
  const rows: string[] = []
  for (const s of bp.sections) {
    const replaced = options.replaced?.get(s.ordinal)
    // A section left out leaves no gap of its own either.
    if (replaced !== '') rows.push(spacer(s.gapBefore, s.around))
    if (replaced !== undefined) {
      rows.push(markedRows(replaced, s.ordinal))
      continue
    }
    const right = Math.max(0, bp.width - s.x - s.width)
    const fill = s.background
    const inner = stack(s.items, s.width, s.bottom, ctx)
    rows.push(sectionRow(s.ordinal, s.x, s.width, right, s.around, fill, inner))
  }
  rows.push(spacer(bp.bottom, bp.sections.at(-1)?.around ?? bp.body))
  const pre = options.preheader
    ? `<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all">${escapeHtml(options.preheader)}</div>`
    : ''
  const extraCss =
    options.replaced?.size && options.brand ? blockMobileCss(options.brand) : ''
  const head = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><meta name="color-scheme" content="light"><title>${escapeHtml(options.title ?? 'Email')}</title><style>body{margin:0;padding:0}img{-ms-interpolation-mode:bicubic}${phoneCss}${extraCss}</style>`
  const container = `<table data-de-email class="de-w" ${presentation} width="${Math.round(bp.width)}" align="center" bgcolor="${bp.body}" style="width:${pxv(bp.width)};max-width:${pxv(bp.width)};margin:0 auto;background:${bp.body}">${rows.join('')}</table>`
  return `<!doctype html><html lang="en"><head>${head}</head><body style="margin:0;padding:0;background:${bp.page}">${pre}<table ${presentation} width="100%" bgcolor="${bp.page}" style="width:100%;background:${bp.page}"><tr><td align="center" style="padding:${pxv(bp.margin.top)} 0 ${pxv(bp.margin.bottom)}">${container}</td></tr></table></body></html>`
}

const inlinePictures = /data:image\/[a-z+]+;base64,[a-z0-9+/]+=*/gi

/**
 * The email's size as Gmail counts it, with each inline picture counted
 * as the https link it becomes once uploaded (about 100 bytes): what the
 * 102 KB clip (`GMAIL_CLIP_BYTES`) is checked against.
 */
export function sentBytes(html: string) {
  return emailBytes(html.replace(inlinePictures, 'https://'.padEnd(100, 'x')))
}
