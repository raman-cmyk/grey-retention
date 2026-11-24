import { contrast } from '@/features/blocks/brand'
import { drawnText } from './drawn-text'

/**
 * Owner pick #96 (D27): accessibility on every email, as a hard check of
 * the email as drawn (DST-005), past the alt text it already checks:
 *
 * - Its language and title: a screen reader reads it in the right voice
 *   and names it.
 * - Layout tables say they are layout (`role="presentation"`), so a
 *   screen reader does not read out rows and columns.
 * - Real headings (a designed email; a letter has none by design), never
 *   skipping a level, so a reader can jump between its parts.
 * - Readable contrast: every piece of text against the background it sits
 *   on, as drawn (WCAG AA: 4.5, or 3 for large text).
 * - Links a screen reader can name: words or a described picture, and
 *   never only "click here".
 * - Pictures' words that describe them, never a file name or "image".
 *
 * Each problem is one plain sentence in fixed words (never the email's
 * own). Pure: the same email, the same answer.
 */

export type AccessProblem = { problem: string }

/** WCAG AA contrast for normal text, and for large text. */
export const minContrast = 4.5
export const minLargeContrast = 3

/** A link's words that say nothing of where it goes. */
const vagueLinks = new Set([
  'here',
  'click here',
  'click',
  'more',
  'read more',
  'learn more',
  'link',
  'this link',
  'this'
])

/** Words of a link that say nothing of where it goes ("Read more →"). */
export const vagueLinkWords = (words: string) =>
  vagueLinks.has(
    drawnText(words)
      .trim()
      .toLowerCase()
      .replace(/[.!:→›»\s]+$/u, '')
  )

/** Pictures' words that describe nothing. */
const emptyAlt =
  /^(?:image|img|picture|photo|photograph|graphic|banner|icon|untitled|null|undefined)(?:\s*\d+)?$|\.(?:jpe?g|png|gif|webp|svg|avif)$/i

const voidTags = new Set([
  'img',
  'br',
  'hr',
  'meta',
  'link',
  'input',
  'col',
  'source',
  'wbr',
  'area',
  'base'
])

const named: Record<string, string> = {
  white: '#ffffff',
  black: '#000000',
  red: '#ff0000',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0'
}

/** A colour as #rrggbb, or null for one this cannot read (then skipped). */
function hexOf(value: string | undefined): string | null {
  const v = value?.trim().toLowerCase()
  if (!v) return null
  if (/^#[0-9a-f]{6}$/.test(v)) return v
  if (/^#[0-9a-f]{3}$/.test(v))
    return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`
  const rgb =
    /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(
      v
    )
  if (rgb) {
    if (rgb[4] !== undefined && Number(rgb[4]) < 1) return null
    return `#${[rgb[1], rgb[2], rgb[3]]
      .map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0'))
      .join('')}`
  }
  return named[v] ?? null
}

const attr = (tag: string, name: string) => {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(
    tag
  )
  return m ? (m[1] ?? m[2]) : undefined
}

/** One CSS property from an inline style. */
const prop = (style: string, name: string) =>
  new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, 'i').exec(style)?.[1]?.trim()

type Frame = {
  tag: string
  /** Undefined: inherited. Null: one this cannot read (text skipped). */
  color?: string | null
  bg?: string | null
  size?: number
  bold?: boolean
  hidden?: boolean
}

/** What one opening tag sets for the text inside it. */
function frameOf(tag: string, name: string): Frame {
  const style = attr(tag, 'style') ?? ''
  const frame: Frame = { tag: name }
  const color = prop(style, 'color')
  if (color) frame.color = hexOf(color.replace(/\s*!important$/i, ''))
  const bg =
    prop(style, 'background-color') ??
    prop(style, 'background') ??
    attr(tag, 'bgcolor')
  if (bg) {
    const first = bg.replace(/\s*!important$/i, '')
    // A picture or a gradient behind the text: its contrast is unknown.
    frame.bg = /url\(|gradient\(/i.test(first)
      ? null
      : /^(?:transparent|none|inherit|initial)$/i.test(first)
        ? undefined
        : hexOf(first.split(/\s+/)[0])
    if (frame.bg === undefined) delete frame.bg
  }
  const size = prop(style, 'font-size')
  const px = size ? /^(\d+(?:\.\d+)?)px$/i.exec(size) : null
  if (px) frame.size = Number(px[1])
  const weight = prop(style, 'font-weight')
  if (weight) frame.bold = /^(?:bold|bolder|[6-9]00)$/i.test(weight)
  if (/^(?:strong|b|h[1-6])$/.test(name)) frame.bold = frame.bold ?? true
  // A browser's own heading sizes when none is set (2em, 1.5em, 1.17em).
  const headingSize: Record<string, number> = { h1: 32, h2: 24, h3: 18.72 }
  if (frame.size === undefined && headingSize[name])
    frame.size = headingSize[name]
  if (
    /display\s*:\s*none|visibility\s*:\s*hidden|(?:^|;)\s*opacity\s*:\s*0(?:\.0*)?\s*(?:;|$)/i.test(
      style
    )
  )
    frame.hidden = true
  return frame
}

/** The nearest set value of a frame's field, from the innermost out. */
function nearest<K extends keyof Frame>(stack: Frame[], key: K) {
  for (let i = stack.length - 1; i >= 0; i--)
    if (stack[i]![key] !== undefined) return stack[i]![key]
  return undefined
}

/**
 * Every piece of text too faint on its background: the lowest contrast
 * found and how many pieces. Text with no colour set is the client's
 * black, on white unless a background is set.
 */
export function faintText(html: string) {
  const body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<head\b[\s\S]*?<\/head>/i, ' ')
  const stack: Frame[] = []
  let worst = Infinity
  let pieces = 0
  for (const m of body.matchAll(/<(\/?)([a-z][a-z0-9]*)\b[^>]*>|([^<]+)/gi)) {
    if (m[3] !== undefined) {
      if (!/[\p{L}\p{N}]/u.test(drawnText(m[3]))) continue
      if (stack.some((f) => f.hidden)) continue
      const color = nearest(stack, 'color')
      const bg = nearest(stack, 'bg')
      if (color === null || bg === null) continue
      const ratio = contrast(color ?? '#000000', bg ?? '#ffffff')
      const size = nearest(stack, 'size') ?? 16
      const bold = nearest(stack, 'bold') ?? false
      const large = size >= 24 || (bold && size >= 18.66)
      if (ratio < (large ? minLargeContrast : minContrast)) {
        pieces++
        worst = Math.min(worst, ratio)
      }
      continue
    }
    const name = m[2]!.toLowerCase()
    if (m[1]) {
      const at = stack.map((f) => f.tag).lastIndexOf(name)
      if (at >= 0) stack.length = at
      continue
    }
    if (voidTags.has(name) || m[0].endsWith('/>')) continue
    stack.push(frameOf(m[0], name))
  }
  return pieces ? { pieces, worst: Math.floor(worst * 10) / 10 } : null
}

const plural = (n: number, one: string, many: string) =>
  n === 1 ? one : many.replace('#', String(n))

export function accessibilityProblems(
  html: string,
  opts: {
    /** A letter (D26) has no headings by design. */
    letter?: boolean
    /**
     * The store's own names (the brand, its products): a link or a
     * picture whose words are exactly one is never vague, whatever it is
     * called (a brand named "Here", a product named "Banner").
     */
    own?: readonly string[]
  } = {}
): AccessProblem[] {
  const out: AccessProblem[] = []
  const own = new Set(
    (opts.own ?? []).map((w) => drawnText(w).trim().toLowerCase())
  )
  const isOwn = (words: string) => own.has(words.trim().toLowerCase())
  const add = (problem: string) => out.push({ problem })
  const clean = html.replace(/<!--[\s\S]*?-->/g, ' ')
  const htmlTag = /<html\b[^>]*>/i.exec(clean)?.[0]
  if (!htmlTag || !attr(htmlTag, 'lang')?.trim())
    add(
      'The email does not say its language, so a screen reader may read it in the wrong voice.'
    )
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(clean)?.[1]
  if (!title || !drawnText(title))
    add('The email has no title for a screen reader to name it by.')
  const tables = [...clean.matchAll(/<table\b[^>]*>/gi)].filter(
    ([t]) => !/^(?:presentation|none)$/i.test(attr(t, 'role') ?? '')
  ).length
  if (tables)
    add(
      plural(
        tables,
        'A layout table does not say it is layout, so a screen reader reads out its rows and columns.',
        '# layout tables do not say they are layout, so a screen reader reads out their rows and columns.'
      )
    )
  const levels = [...clean.matchAll(/<h([1-6])\b/gi)].map((m) => Number(m[1]))
  if (!opts.letter && !levels.length)
    add(
      'The email has no real heading, so a screen reader cannot jump to its parts.'
    )
  if (levels.some((l, i) => l > (i ? Math.max(...levels.slice(0, i)) : 1) + 1))
    add('The email’s headings skip a level, which confuses a screen reader.')
  const faint = faintText(clean)
  if (faint)
    add(
      `${plural(faint.pieces, 'A piece of text is', '# pieces of text are')} hard to read on ${faint.pieces === 1 ? 'its' : 'their'} background (contrast ${faint.worst}; ${minContrast} needed, ${minLargeContrast} for large text).`
    )
  let nameless = 0
  let vague = 0
  for (const m of clean.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)) {
    const inner = m[1]!
    const words = drawnText(inner).trim()
    const alts = [...inner.matchAll(/<img\b[^>]*>/gi)]
      .map(([t]) => drawnText(attr(t, 'alt') ?? '').trim())
      .filter(Boolean)
    const label = /<a\b[^>]*>/i.exec(m[0])?.[0]
    const said = [
      words,
      ...alts,
      drawnText((label && attr(label, 'aria-label')) ?? '')
    ]
      .join(' ')
      .trim()
    if (!said) nameless++
    else if (vagueLinkWords(said) && !isOwn(said)) vague++
  }
  if (nameless)
    add(
      plural(
        nameless,
        'A link has no words a screen reader can say.',
        '# links have no words a screen reader can say.'
      )
    )
  if (vague)
    add(
      plural(
        vague,
        'A link says only "click here" or the like: say where it goes.',
        '# links say only "click here" or the like: say where they go.'
      )
    )
  const poor = [...clean.matchAll(/<img\b[^>]*>/gi)].filter(([t]) => {
    const alt = drawnText(attr(t, 'alt') ?? '').trim()
    return emptyAlt.test(alt) && !isOwn(alt)
  }).length
  if (poor)
    add(
      plural(
        poor,
        'A picture’s words are a file name or "image": say what it shows.',
        '# pictures’ words are a file name or "image": say what they show.'
      )
    )
  return out
}
