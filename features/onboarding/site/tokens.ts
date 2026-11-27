import { parse, type DefaultTreeAdapterTypes as T } from 'parse5'
import {
  clampTokens,
  tokenKeys,
  type SiteTokens,
  type TokenKey
} from '@/features/design-engine/tokens'
import {
  declarations,
  maxCss,
  maxTotalCss,
  scanCss,
  siteFonts,
  split,
  type Sheet
} from './fonts'
import { words } from './logos'

/**
 * PICK-006 (owner pick #6): the brand's design tokens as one of its own
 * pages sets them, read from the page's `<style>` blocks and the
 * stylesheets passed back (the Site reader fetches the ones the page links,
 * as for its fonts): its spacing unit and scale, its body and heading sizes
 * with the body line height and the headings' case, its corner radius on
 * buttons, cards and pictures, and its main button's look (filled or
 * outline, padding, case, weight). Pure and deterministic: the same page
 * and sheets always give the same tokens; nothing is fetched here.
 *
 * Only plain rules count: a selector of one part (`h1`, `.h2`, `.button`,
 * `.card`, `img`), never one inside a width query (`@media (max-width…)`,
 * a phone or a wide screen's override), a state (`:hover`) or a part of
 * something else (`.footer h1`). The last such value wins, as the cascade
 * reads them. Sizes are read in px (`rem` at the page's root size, `em`
 * at 16), through `var()`, `calc()`, `clamp()`, `min()` and `max()`.
 * Every value is clamped to the email-safe range (`clampTokens`); what a
 * page does not say is left out, never guessed.
 */

type Kind =
  | 'root'
  | 'body'
  | 'p'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'button'
  | 'buttonTag'
  | 'card'
  | 'image'
type Entry = { kinds: Kind[]; name: string; value: string }

/** Words of a button's variant: never the main button's look. */
const variantWords = new Set(
  'secondary|tertiary|outline|outlined|ghost|link|links|close|icon|icons|small|sm|xs|plain|unstyled|reset|text|toggle|menu|nav|burger|hamburger|quantity|qty|arrow|arrows|slider|carousel|swatch|social|share|search|disabled|loading|dropdown|tab|tabs|pagination|chip'.split(
    '|'
  )
)
const cardWords = new Set(['card', 'cards', 'tile', 'tiles'])
const imageWords = new Set(['media', 'image', 'img', 'photo', 'picture'])
const buttonWords = new Set(['button', 'btn', 'cta'])
/** States and parts: never the plain look. */
const statePart =
  /::|:(?:hover|focus|focus-visible|focus-within|active|visited|disabled|checked|first-child|last-child|nth-|only-child|empty|placeholder|target|invalid|valid|before|after)/i

/** The most declarations and custom properties read in one call. */
const maxEntries = 20_000
const maxProps = 2_000

/** What a plain selector (one part) is for, or none. */
function kindsOf(selector: string): Kind[] {
  const own = selector.replace(/:(?:not|has)\([^()]*\)/gi, '').trim()
  if (!own || statePart.test(own) || /[\s>+~]/.test(own)) return []
  if (own === ':root' || /^html$/i.test(own)) return ['root']
  const tag = /^[a-z][a-z0-9]*/i.exec(own)?.[0].toLowerCase() ?? ''
  const classes = [...own.matchAll(/\.([-\w]+)/g)].map((m) => m[1]!)
  const w = words(...classes)
  if (tag === 'body' && !classes.length) return ['body']
  if (tag === 'p' && !classes.length) return ['p']
  const heading = /^h([1-3])$/.exec(tag)?.[1] ?? null
  const classHeading = classes
    .map((c) => /^h([1-3])$/i.exec(c)?.[1])
    .find(Boolean)
  const level = heading ?? classHeading
  if (level && (heading ? !classes.length : true)) return [`h${level}` as Kind]
  const kinds: Kind[] = []
  if (w.some((x) => buttonWords.has(x)) && !w.some((x) => variantWords.has(x)))
    kinds.push('button')
  else if (
    !classes.length &&
    (tag === 'button' ||
      (tag === 'input' && /\[type=["']?submit["']?\]/i.test(own)))
  )
    kinds.push('buttonTag')
  // A card's picture (`.card__media`) is a picture, not the card.
  if (
    !kinds.length &&
    ((tag === 'img' && !classes.length) || w.some((x) => imageWords.has(x)))
  )
    kinds.push('image')
  if (!kinds.length && w.some((x) => cardWords.has(x))) kinds.push('card')
  return kinds
}

/** Is a rule's prelude a query that applies at some widths only? */
const widthQuery = (prelude: string) =>
  /^@(?:media|container|supports)\b/i.test(prelude) &&
  /(?:width|height|orientation|aspect)/i.test(prelude)

type Found = { entries: Entry[]; props: Map<string, string>; budget: number }

function readCss(css: string, f: Found) {
  const text = css.slice(0, Math.min(maxCss, f.budget))
  f.budget -= text.length
  // The kinds of each open rule by depth, and whether a width query holds it.
  const inQuery: boolean[] = []
  scanCss(
    text,
    (prelude, depth) => {
      const held = (depth > 0 && inQuery[depth - 1]) || widthQuery(prelude)
      inQuery[depth] = held
      if (held || prelude.startsWith('@')) return { held, kinds: [] as Kind[] }
      const kinds = [
        ...new Set(split(prelude, ',').slice(0, 50).flatMap(kindsOf))
      ]
      return { held, kinds }
    },
    (at, body) => {
      if (at.held) return
      for (const [name, value] of declarations(body)) {
        if (f.entries.length >= maxEntries) return
        if (name.startsWith('--')) {
          if (f.props.size < maxProps) f.props.set(name, value)
          f.entries.push({ kinds: at.kinds, name, value })
        } else f.entries.push({ kinds: at.kinds, name, value })
      }
    },
    () => {}
  )
}

/** A number with a unit: px, or a plain number. */
type Quantity = { n: number; px: boolean }

/**
 * The page's custom properties, with one read's work budget: each value
 * is worked out once (`cache`), and a read works out at most
 * `maxQuantities` values in all, so nested `var()`s in `min()` and `max()`
 * can never make a stylesheet slow. Spent: nothing more is read, and the
 * tokens not read yet stay the defaults.
 */
type Vars = {
  get(name: string): string | undefined
  left: number
  cache: Map<string, Quantity | null>
}
/** The most values one read works out (a page's styles take a few thousand). */
export const maxQuantities = 20_000

/**
 * A CSS value as one quantity: a length in px (`rem` at `root`, `em` at
 * 16, `pt`), a plain number, or `%` of `percentOf` px; through `var()`
 * (four hops), `calc()` with + - * /, `clamp()` (its largest: an email is
 * read at a desktop width), `min()` and `max()`. Null when it is not one.
 */
function quantity(
  raw: string,
  props: Vars,
  root: number,
  percentOf: number | null = null,
  hops = 0
): Quantity | null {
  const key = `${root}|${percentOf}|${hops}|${raw}`
  const known = props.cache.get(key)
  if (known !== undefined) return known
  if (props.left <= 0) return null
  props.left--
  const got = worked(raw, props, root, percentOf, hops)
  props.cache.set(key, got)
  return got
}

function worked(
  raw: string,
  props: Vars,
  root: number,
  percentOf: number | null,
  hops: number
): Quantity | null {
  const s = raw.trim().toLowerCase()
  if (!s || s.length > 500 || hops > 4) return null
  let i = 0
  const space = () => {
    while (s[i] === ' ' || s[i] === '\n' || s[i] === '\t') i++
  }
  const args = (): string[] | null => {
    // At "(": the text up to its ")" split at top-level commas.
    let depth = 0
    const start = ++i
    for (; i < s.length; i++) {
      if (s[i] === '(') depth++
      else if (s[i] === ')') {
        if (depth === 0) {
          const inner = s.slice(start, i)
          i++
          return split(inner, ',')
        }
        depth--
      }
    }
    return null
  }
  const each = (list: string[]) =>
    list.map((a) => quantity(a, props, root, percentOf, hops + 1))
  const factor = (): Quantity | null => {
    space()
    if (s[i] === '(') {
      i++
      const v = sum()
      space()
      if (s[i] !== ')') return null
      i++
      return v
    }
    const fn = /^[a-z-]+(?=\()/.exec(s.slice(i))?.[0]
    if (fn) {
      i += fn.length
      const list = args()
      if (!list) return null
      if (fn === 'var') {
        const name = list[0]!.trim()
        const value = props.get(name) ?? list.slice(1).join(',')
        return quantity(value, props, root, percentOf, hops + 1)
      }
      if (fn === 'calc') {
        return quantity(list.join(','), props, root, percentOf, hops + 1)
      }
      // A clamp's largest (`4vw` in the middle is never read).
      if (fn === 'clamp')
        return list.length === 3 ? (each([list[2]!])[0] ?? null) : null
      const vs = each(list)
      if (!vs.length || vs.some((v) => v === null)) return null
      const qs = vs as Quantity[]
      if (fn === 'min' || fn === 'max') {
        const pick = fn === 'min' ? Math.min : Math.max
        return { n: pick(...qs.map((q) => q.n)), px: qs.some((q) => q.px) }
      }
      return null
    }
    const m = /^(-?(?:\d+\.?\d*|\.\d+))(px|rem|em|pt|%)?/.exec(s.slice(i))
    if (!m) return null
    i += m[0].length
    const n = Number(m[1])
    switch (m[2]) {
      case 'px':
        return { n, px: true }
      case 'rem':
        return { n: n * root, px: true }
      case 'em':
        return { n: n * 16, px: true }
      case 'pt':
        return { n: (n * 4) / 3, px: true }
      case '%':
        return percentOf === null
          ? null
          : { n: (n / 100) * percentOf, px: true }
      default:
        return { n, px: false }
    }
  }
  const product = (): Quantity | null => {
    let a = factor()
    for (;;) {
      space()
      const op = s[i]
      if (op !== '*' && op !== '/') return a
      i++
      const b = factor()
      if (!a || !b) return null
      if (op === '*')
        a = a.px && b.px ? null : { n: a.n * b.n, px: a.px || b.px }
      else a = b.px || b.n === 0 ? null : { n: a.n / b.n, px: a.px }
      if (!a) return null
    }
  }
  const sum = (): Quantity | null => {
    let a = product()
    for (;;) {
      space()
      const op = s[i]
      if (op !== '+' && op !== '-') return a
      i++
      const b = product()
      if (!a || !b || a.px !== b.px) return null
      a = { n: op === '+' ? a.n + b.n : a.n - b.n, px: a.px }
    }
  }
  const v = sum()
  space()
  return v && i === s.length && Number.isFinite(v.n) ? v : null
}

/** A value's px, or null. */
const pxOf = (
  value: string,
  props: Vars,
  root: number,
  percentOf: number | null = null
) => {
  const q = quantity(value, props, root, percentOf)
  if (!q) return null
  return q.px || q.n === 0 ? q.n : null
}

/** The values of a shorthand (`padding: 12px 24px`), each as written. */
const parts = (value: string) =>
  split(value.replace(/\s+/g, ' ').trim(), ' ').filter(Boolean)

const noFill =
  /^(?:none|transparent|inherit|initial|unset|revert)\b|^rgba?\([^)]*,\s*0(?:\.0+)?\s*\)$|^#[0-9a-f]{6}00$|^#[0-9a-f]{3}0$/i

/** Whether a border declaration draws a line, or null when it cannot be read. */
function borderLine(
  name: string,
  value: string,
  props: Vars,
  root: number
): boolean | null {
  const v = value.trim().toLowerCase()
  if (name === 'border-style') return v !== 'none' && v !== 'hidden'
  if (name === 'border-width') {
    const w = pxOf(parts(v)[0] ?? '', props, root)
    return w === null ? null : w > 0
  }
  // `border: 2px solid #000`, `border: none`, `border: 0`.
  if (/^(?:none|0|0px|hidden)\b/.test(v)) return false
  for (const p of parts(v)) {
    const w = pxOf(p, props, root)
    if (w !== null) return w > 0
    if (/^(?:thin|medium|thick)$/.test(p)) return true
  }
  return /\b(?:solid|dashed|dotted|double)\b/.test(v) ? true : null
}

const transformCase = (v: string): 'none' | 'uppercase' | null =>
  /^uppercase$/i.test(v.trim())
    ? 'uppercase'
    : /^(?:none|capitalize|lowercase)$/i.test(v.trim())
      ? 'none'
      : null

const weightOf = (v: string) => {
  const t = v.trim().toLowerCase()
  if (t === 'bold') return 700
  if (t === 'normal') return 400
  return /^\d{3}$/.test(t) ? Number(t) : null
}

/** The px values spaces are made of: whole px from 2 to 96. */
const spaceValue = (n: number | null) =>
  n !== null && Number.isInteger(Math.round(n * 100) / 100) && n >= 2 && n <= 96
    ? Math.round(n)
    : null

/** Units a site's spaces may be multiples of, largest first. */
const units = [12, 10, 8, 6, 5, 4, 3, 2]
/** Fewest spaces read before a unit is named, and the share that must fit it. */
const minSpaces = 6
const unitShare = 0.75
const maxSteps = 8

/**
 * The spacing unit and scale: the largest unit at least three quarters of
 * the site's spaces are multiples of (at least six spaces read), and its
 * most used multiples (at most eight, at least two). A unit the site names
 * (`--spacing-unit: 8px`) wins.
 */
function spacing(spaces: readonly number[], named: number | null) {
  const out: SiteTokens = {}
  let base: number | null = named
  if (base === null && spaces.length >= minSpaces)
    base =
      units.find(
        (u) =>
          spaces.filter((v) => v % u === 0).length / spaces.length >= unitShare
      ) ?? null
  if (base === null) return out
  out['spacing.base'] = base
  const counts = new Map<number, number>()
  for (const v of spaces)
    if (v % base === 0) counts.set(v, (counts.get(v) ?? 0) + 1)
  const steps = [...counts]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, maxSteps)
    .map(([v]) => v)
    .sort((a, b) => a - b)
  if (steps.length >= 2) out['spacing.steps'] = steps
  return out
}

type Node = T.ChildNode | T.ParentNode
const isElement = (n: Node): n is T.Element => 'tagName' in n
const children = (n: Node): T.ChildNode[] =>
  'childNodes' in n ? n.childNodes : []
const textOf = (n: T.Element) =>
  children(n)
    .map((t) => ('value' in t ? t.value : ''))
    .join('')

/**
 * The tokens one page sets, from its `<style>` blocks and the `sheets`
 * passed back (each read once, at most `maxTotalCss` characters in all),
 * clamped. Bad CSS or HTML gives fewer tokens, never an error.
 */
export function siteTokens(
  html: string,
  { sheets = [] }: { sheets?: readonly Sheet[] } = {}
): SiteTokens {
  try {
    return read(html, sheets)
  } catch {
    return {}
  }
}

function read(html: string, sheets: readonly Sheet[]): SiteTokens {
  const f: Found = { entries: [], props: new Map(), budget: maxTotalCss }
  const stack = [...children(parse(html.slice(0, 2_000_000)))].reverse()
  while (stack.length) {
    const c = stack.pop()!
    if (!isElement(c)) continue
    if (c.tagName === 'style') readCss(textOf(c), f)
    const kids = children(c)
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!)
  }
  for (const sheet of sheets) readCss(sheet.css, f)
  const props: Vars = {
    get: (name) => f.props.get(name),
    left: maxQuantities,
    cache: new Map()
  }
  // The page's root size (`html { font-size: 62.5% }` makes 1rem 10 px).
  let root = 16
  for (const e of f.entries)
    if (e.kinds.includes('root') && e.name === 'font-size') {
      const v = pxOf(e.value, props, 16, 16)
      if (v !== null && v >= 8 && v <= 24) root = v
    }
  const found: Record<string, unknown> = {}
  const set = (key: TokenKey, value: unknown) => {
    if (value !== null && value !== undefined) found[key] = value
  }
  const of = (kind: Kind) => f.entries.filter((e) => e.kinds.includes(kind))
  const last = <V>(list: readonly Entry[], read: (e: Entry) => V | null) => {
    let out: V | null = null
    for (const e of list) {
      const v = read(e)
      if (v !== null) out = v
    }
    return out
  }
  const fontSize = (e: Entry) =>
    e.name === 'font-size' ? pxOf(e.value, props, root, 16) : null
  const fromShorthand = (e: Entry) => {
    // `font: 600 16px/1.5 Inter` holds the size (and line height).
    if (e.name !== 'font') return null
    const m =
      /(?:^|\s)([\d.]+(?:px|rem|em|pt))(?:\s*\/\s*([\d.]+(?:px|rem|em|%)?))?/i.exec(
        e.value
      )
    return m ? { size: pxOf(m[1]!, props, root), lh: m[2] ?? null } : null
  }

  // Type: the body's size and line height, then each heading's.
  const bodyRules = [...of('body')]
  const body =
    last(bodyRules, fontSize) ??
    last(bodyRules, (e) => fromShorthand(e)?.size ?? null) ??
    last(of('p'), fontSize) ??
    last(
      f.entries.filter((e) => {
        const w = words(e.name)
        return (
          e.name.startsWith('--') &&
          w.includes('size') &&
          w.some((x) => x === 'body' || x === 'base') &&
          w.some((x) => x === 'font' || x === 'text' || x === 'type')
        )
      }),
      (e) => pxOf(e.value, props, root)
    )
  set('type.body', body)
  const lineHeight = (e: Entry) => {
    const raw =
      e.name === 'line-height'
        ? e.value
        : e.name === 'font'
          ? fromShorthand(e)?.lh
          : null
    if (!raw || /^normal$/i.test(raw.trim())) return null
    const percent = /^(\d+(?:\.\d+)?)%$/.exec(raw.trim())
    if (percent) return Number(percent[1]) / 100
    const q = quantity(raw, props, root)
    if (!q) return null
    // A px line height is read against the body's size.
    return q.px ? q.n / (body ?? 16) : q.n
  }
  set(
    'type.lineHeight',
    last(bodyRules, lineHeight) ?? last(of('p'), lineHeight)
  )
  for (const level of ['h1', 'h2', 'h3'] as const)
    set(`type.${level}`, last(of(level), fontSize))
  const headingCase = last([...of('h1'), ...of('h2')], (e) =>
    e.name === 'text-transform' ? transformCase(e.value) : null
  )
  set('type.headingCase', headingCase)

  // The main button: its class rules (`.button`, `.btn`), else the tag's.
  const classButton = of('button')
  const buttonRules = classButton.length ? classButton : of('buttonTag')
  const radius = (e: Entry, percentPill: boolean) => {
    if (e.name !== 'border-radius') return null
    const first = parts(e.value)[0] ?? ''
    if (/%$/.test(first.trim())) {
      const n = Number.parseFloat(first)
      return percentPill && n >= 25 ? 999 : null
    }
    return pxOf(first, props, root)
  }
  // Custom properties that name a radius: `--buttons-radius`, `--media-radius`.
  const radiusProps = (want: Set<string> | null) =>
    f.entries.filter((e) => {
      if (!e.name.startsWith('--')) return false
      const w = words(e.name)
      if (!w.includes('radius') && !w.includes('corner')) return false
      const named = [buttonWords, cardWords, imageWords].some((set) =>
        w.some((x) => set.has(x) || set.has(x.replace(/s$/, '')))
      )
      return want
        ? w.some((x) => want.has(x) || want.has(x.replace(/s$/, '')))
        : !named
    })
  const propRadius = (want: Set<string> | null) =>
    last(radiusProps(want), (e) => pxOf(parts(e.value)[0] ?? '', props, root))
  const generic = propRadius(null)
  set(
    'radius.button',
    last(buttonRules, (e) => radius(e, true)) ??
      propRadius(buttonWords) ??
      generic
  )
  set(
    'radius.card',
    last(of('card'), (e) => radius(e, false)) ??
      propRadius(cardWords) ??
      generic
  )
  set(
    'radius.image',
    last(of('image'), (e) => radius(e, false)) ??
      propRadius(imageWords) ??
      generic
  )
  // Filled or outline: a fill, or no fill with a line around it.
  let fill: boolean | null = null
  let line: boolean | null = null
  for (const e of buttonRules) {
    if (e.name === 'background' || e.name === 'background-color')
      fill = !noFill.test(e.value.trim())
    else if (
      e.name === 'border' ||
      e.name === 'border-width' ||
      e.name === 'border-style'
    ) {
      const l = borderLine(e.name, e.value, props, root)
      if (l !== null) line = l
    }
  }
  set(
    'button.style',
    fill === true
      ? 'filled'
      : fill === false && line === true
        ? 'outline'
        : null
  )
  let padY: number | null = null
  let padX: number | null = null
  for (const e of buttonRules) {
    const v = (x: string | undefined) => (x ? pxOf(x, props, root) : null)
    if (e.name === 'padding') {
      const p = parts(e.value)
      const [top, right] = [v(p[0]), v(p[1] ?? p[0])]
      if (top !== null) padY = top
      if (right !== null) padX = right
    } else if (e.name === 'padding-top' || e.name === 'padding-block') {
      padY = v(parts(e.value)[0]) ?? padY
    } else if (
      e.name === 'padding-left' ||
      e.name === 'padding-right' ||
      e.name === 'padding-inline'
    ) {
      padX = v(parts(e.value)[0]) ?? padX
    }
  }
  // A reset (`padding: 0`) is no button's look.
  set('button.paddingY', padY ? padY : null)
  set('button.paddingX', padX ? padX : null)
  set(
    'button.case',
    last(buttonRules, (e) =>
      e.name === 'text-transform' ? transformCase(e.value) : null
    )
  )
  set(
    'button.weight',
    last(buttonRules, (e) =>
      e.name === 'font-weight' ? weightOf(e.value) : null
    )
  )

  // Spacing: every space the page sets, and a unit it names.
  const spaces: number[] = []
  let named: number | null = null
  for (const e of f.entries) {
    const w = e.name.startsWith('--') ? words(e.name) : []
    const spaceProp =
      w.length > 0 &&
      w.some((x) => ['spacing', 'space', 'spaces', 'gap', 'gutter'].includes(x))
    const spaceDecl =
      /^(?:padding|margin)(?:-(?:top|bottom|left|right|block|inline))?$|^(?:row-|column-)?gap$/.test(
        e.name
      )
    if (!spaceProp && !spaceDecl) continue
    if (spaceProp && w.some((x) => ['unit', 'base'].includes(x))) {
      const u = pxOf(e.value, props, root)
      if (u !== null && Number.isInteger(u) && u >= 2 && u <= 12) named = u
      continue
    }
    for (const p of parts(e.value).slice(0, 4)) {
      const n = spaceValue(pxOf(p, props, root))
      if (n !== null) spaces.push(n)
    }
  }
  Object.assign(found, spacing(spaces, named))
  return clampTokens(found)
}

/**
 * The site's tokens from its pages' (in reading order, the home page
 * first): for each token the first page that set it.
 */
export function mergeSiteTokens(
  pages: readonly (SiteTokens | null | undefined)[]
): SiteTokens {
  const out: Record<string, unknown> = {}
  for (const page of pages)
    for (const key of tokenKeys)
      if (page && page[key] !== undefined && out[key] === undefined)
        out[key] = page[key]
  return clampTokens(out)
}

/**
 * One page's tokens with its theme's stylesheets (the brand's own host's
 * and its store platform's, `siteFonts`' `site` sheets, read through the
 * fonts' shared `sheet` reader, so each is fetched once): the page alone
 * when it links none or no `sheet` reader is given (the sample site).
 * Null, so the caller can keep what it had, when it links stylesheets but
 * none could be read, or when `late()` says the time is up. Never fails.
 */
export async function pageTokens(
  page: { html: string; url: string },
  sheet?: (url: string) => Promise<Sheet | null>,
  late: () => boolean = () => false
): Promise<SiteTokens | null> {
  try {
    const linked = sheet
      ? siteFonts(page.html, page.url)
          .stylesheets.filter((s) => s.from === 'site')
          .map((s) => s.url)
      : []
    if (!linked.length) return siteTokens(page.html)
    const sheets = (await Promise.all(linked.map(sheet!))).filter(
      (s) => s !== null
    )
    if (!sheets.length || late()) return null
    return siteTokens(page.html, { sheets })
  } catch {
    return null
  }
}
