import { picture } from './pictures'

/**
 * DES-ENGINE-001 golden set: small helpers the 40 test emails are written
 * with. Every word is made up here and every picture is a plain colour
 * (`pictures.ts`): no client, competitor or real brand content (D8).
 */

export const fonts = {
  arial: 'Arial, Helvetica, sans-serif',
  helvetica: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  georgia: "Georgia, 'Times New Roman', Times, serif",
  verdana: 'Verdana, Geneva, sans-serif',
  trebuchet: "'Trebuchet MS', Tahoma, sans-serif",
  /** A brand font no inbox has, with a safe stack after it. */
  brand: "'Sample Sans', Arial, sans-serif",
  /** A brand font with nothing after it: the drawing code adds the stack. */
  bare: "'Sample Serif'"
} as const

const words =
  'soft light warm linen morning garden simple daily ritual fresh season cotton clay stone river cedar honey oat wool calm bright careful small batch made slowly every week your home table kitchen shelf window weekend walk coffee bread paper leaf colour shape quiet useful good new old favourite gift friend family'.split(
    ' '
  )

/** Made-up words, the same for the same seed. */
export function says(seed: number, count: number, capital = true): string {
  const out: string[] = []
  let s = seed * 7919 + 17
  for (let i = 0; i < count; i++) {
    s = (s * 1103515245 + 12345) % 2147483648
    out.push(words[s % words.length]!)
  }
  const text = out.join(' ')
  return capital ? text[0]!.toUpperCase() + text.slice(1) : text
}

/** A sentence or a few, ending with a full stop. */
export const para = (seed: number, count: number) => `${says(seed, count)}.`

export const link = (path: string) => `https://example.com/${path}`

export function img(
  width: number,
  height: number,
  color: string,
  alt: string,
  style = ''
) {
  return `<img src="${picture(width, height, color)}" width="${width}" height="${height}" alt="${alt}" style="display:block;width:${width}px;height:${height}px;border:0;${style}">`
}

export function linked(href: string, inner: string) {
  return `<a href="${href}" target="_blank" style="text-decoration:none">${inner}</a>`
}

/** An Outlook-safe button: a filled cell around a link. */
export function button(o: {
  label: string
  href?: string
  bg: string
  color?: string
  font?: string
  size?: number
  radius?: number
  pad?: string
  align?: 'center' | 'left' | 'right'
  border?: string
  weight?: number
}) {
  const align = o.align ?? 'center'
  const margin =
    align === 'center'
      ? 'margin:0 auto'
      : align === 'right'
        ? 'margin:0 0 0 auto'
        : ''
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="${margin}"><tr><td bgcolor="${o.bg}" style="background:${o.bg};border-radius:${o.radius ?? 4}px;padding:${o.pad ?? '14px 32px'};${o.border ? `border:${o.border};` : ''}"><a href="${o.href ?? link('shop')}" target="_blank" style="font-family:${o.font ?? fonts.arial};font-size:${o.size ?? 15}px;font-weight:${o.weight ?? 700};color:${o.color ?? '#ffffff'};text-decoration:none;display:inline-block">${o.label}</a></td></tr></table>`
}

/** A link styled as a button (`display:inline-block` with padding and a fill). */
export function linkButton(o: {
  label: string
  bg: string
  color?: string
  font?: string
  size?: number
  radius?: number
  pad?: string
  border?: string
}) {
  return `<a href="${link('go')}" target="_blank" style="display:inline-block;background:${o.bg};color:${o.color ?? '#ffffff'};font-family:${o.font ?? fonts.arial};font-size:${o.size ?? 14}px;font-weight:700;line-height:20px;padding:${o.pad ?? '12px 28px'};border-radius:${o.radius ?? 0}px;text-decoration:none;${o.border ? `border:${o.border};` : ''}">${o.label}</a>`
}

export type TextStyle = {
  font?: string
  size?: number
  line?: number | string
  weight?: number
  color?: string
  align?: 'left' | 'center' | 'right'
  extra?: string
}

export const textCss = (t: TextStyle) =>
  `font-family:${t.font ?? fonts.arial};font-size:${t.size ?? 16}px;line-height:${typeof t.line === 'string' ? t.line : `${t.line ?? Math.round((t.size ?? 16) * 1.5)}px`};${t.weight ? `font-weight:${t.weight};` : ''}color:${t.color ?? '#333333'};text-align:${t.align ?? 'left'};${t.extra ?? ''}`

/** A table row holding one cell. */
export const row = (cell: string, style = '', attrs = '') =>
  `<tr><td${attrs} style="${style}">${cell}</td></tr>`

/** A text cell row. */
export const textRow = (words: string, pad: string, t: TextStyle) =>
  `<tr><td style="padding:${pad};${textCss(t)}">${words}</td></tr>`

/**
 * The classic layout most inbox emails use: a full-width page table, a
 * centred 600 px table, one row per section.
 */
export function classic(o: {
  title: string
  rows: string[]
  page?: string
  body?: string
  width?: number
  preheader?: string
  head?: string
}) {
  const width = o.width ?? 600
  const page = o.page ?? '#f2f2f2'
  const body = o.body ?? '#ffffff'
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${o.title}</title><style>body{margin:0;padding:0}@media only screen and (max-width:620px){.stack{display:block!important;width:100%!important}.wrap{width:100%!important}}${o.head ?? ''}</style></head><body style="margin:0;padding:0;background:${page}">${o.preheader ? `<div style="display:none;max-height:0;overflow:hidden">${o.preheader}</div>` : ''}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${page}"><tr><td align="center" style="padding:24px 0"><table class="wrap" role="presentation" width="${width}" cellpadding="0" cellspacing="0" border="0" bgcolor="${body}" style="width:${width}px">${o.rows.join('')}</table></td></tr></table></body></html>`
}

/** Cells side by side in one row, with gaps between them. */
export function columns(
  cells: { width: number; html: string; style?: string; cls?: string }[],
  gap: number
) {
  const parts: string[] = []
  cells.forEach((c, i) => {
    if (i > 0 && gap > 0)
      parts.push(
        `<td class="stack" width="${gap}" style="width:${gap}px;font-size:0;line-height:0">&nbsp;</td>`
      )
    parts.push(
      `<td class="${c.cls ?? 'stack'}" width="${c.width}" valign="top" style="width:${c.width}px;${c.style ?? ''}">${c.html}</td>`
    )
  })
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${parts.join('')}</tr></table>`
}

export const footerRow = (
  o: { color?: string; bg?: string; font?: string; pad?: string } = {}
) =>
  `<tr><td bgcolor="${o.bg ?? '#f6f6f6'}" style="background:${o.bg ?? '#f6f6f6'};padding:${o.pad ?? '28px 40px'};${textCss({ font: o.font, size: 12, line: 18, color: o.color ?? '#777777', align: 'center' })}">Sample Store, 1 Example Road, Sample Town<br>You are receiving this email because you signed up on our site.<br><a href="${link('unsubscribe')}" style="color:${o.color ?? '#777777'};text-decoration:underline">Unsubscribe</a> · <a href="${link('preferences')}" style="color:${o.color ?? '#777777'};text-decoration:underline">Preferences</a></td></tr>`

export const logoRow = (
  o: {
    color?: string
    bg?: string
    pad?: string
    width?: number
    height?: number
    align?: string
  } = {}
) =>
  `<tr><td align="${o.align ?? 'center'}" bgcolor="${o.bg ?? '#ffffff'}" style="background:${o.bg ?? '#ffffff'};padding:${o.pad ?? '24px 0'}">${linked(link(''), img(o.width ?? 150, o.height ?? 40, o.color ?? '#222222', 'Sample Store', o.align === 'left' ? '' : 'margin:0 auto'))}</td></tr>`
