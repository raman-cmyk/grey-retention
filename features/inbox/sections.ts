import {
  parse,
  serializeOuter,
  type DefaultTreeAdapterTypes as T
} from 'parse5'

/**
 * Cuts an email into sections from its HTML structure (INB-003, VISION
 * Step 2): the rows of the 600–700px content container, each usually one
 * block (a header, a hero image, a paragraph, a button, a product grid).
 * The AI only labels sections later; it never decides where they are.
 */

export const maxSections = 40
/** Fewer words than this next to an image makes a design section. */
export const designWords = 30

export type EmailSection = {
  ordinal: number
  html: string
  text: string
  words: number
  images: number
  /** Pictures at least 400px wide (a hero or a banner, not a logo). */
  wideImages: number
  links: { text: string; href: string }[]
  /** design: mostly pictures; text: mostly words. */
  kind: 'text' | 'design'
}

export type SectionedEmail = {
  sections: EmailSection[]
  /** The HTML again, with data-gr-section="n" on each section. */
  markedHtml: string
  /** The hidden preview line many emails start with, if any. */
  preheader: string | null
  /** Share of text sections (0..1), or null without sections. */
  textRatio: number | null
}

type Node = T.ChildNode | T.ParentNode
const isElement = (n: Node): n is T.Element =>
  'tagName' in n && typeof (n as T.Element).tagName === 'string'
const attr = (el: T.Element, name: string) =>
  el.attrs.find((a) => a.name === name)?.value ?? null
const children = (n: Node): T.ChildNode[] =>
  'childNodes' in n ? (n.childNodes as T.ChildNode[]) : []
const elements = (n: Node) => children(n).filter(isElement)

/** Real templates nest a few dozen levels; deeper parts are not read. */
const maxDepth = 200

function walk(n: Node, visit: (el: T.Element) => boolean | void, depth = 0) {
  if (depth > maxDepth) return
  for (const c of children(n))
    if (isElement(c)) {
      if (visit(c) === false) continue
      walk(
        c.tagName === 'template' ? (c as T.Template).content : c,
        visit,
        depth + 1
      )
    }
}

/** A zero that is not the start of 0.8 or 05. */
const zero = String.raw`0(?![.\d])`
const hiddenStyle = new RegExp(
  String.raw`(?:^|[;\s])(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*${zero})`,
  'i'
)
const collapsed = new RegExp(
  String.raw`(?:^|[;\s])max-height\s*:\s*${zero}`,
  'i'
)

/**
 * Not shown at all: display:none, visibility:hidden, opacity:0, the hidden
 * attribute, or a box squeezed to max-height:0 that hides what overflows.
 * font-size:0 and mso-hide:all hide nothing on their own (MJML puts
 * font-size:0 on every column), so they do not count.
 */
function hidden(el: T.Element) {
  if (attr(el, 'hidden') !== null) return true
  const style = attr(el, 'style') ?? ''
  return (
    hiddenStyle.test(style) ||
    (collapsed.test(style) && /overflow\s*:\s*hidden/i.test(style))
  )
}

/**
 * Whether words inside are drawn at size zero: font-size:0 holds until an
 * inner element sets a real size again (the MJML column pattern).
 */
function zeroFont(el: T.Element, inherited: boolean) {
  const m = /(?:^|[;\s])font-size\s*:\s*(\d*\.?\d+)/i.exec(
    attr(el, 'style') ?? ''
  )
  return m ? Number(m[1]) === 0 : inherited
}

/** Blank characters email templates pad text with. */
const blank = /[\s\u200b-\u200d\u2060\ufeff\u034f\u00ad]/g

const skipped = new Set(['script', 'style', 'head', 'title', 'noscript'])

/** Visible words of a subtree (hidden parts and scripts left out). */
function textOf(n: Node): string {
  const parts: string[] = []
  const add = (node: Node, depth: number, small: boolean) => {
    if (depth > maxDepth) return
    for (const c of children(node)) {
      if (c.nodeName === '#text') {
        if (!small) parts.push((c as T.TextNode).value)
      } else if (isElement(c)) {
        if (skipped.has(c.tagName) || hidden(c)) continue
        if (c.tagName === 'br' || c.tagName === 'p' || c.tagName === 'tr')
          parts.push(' ')
        add(c, depth + 1, zeroFont(c, small))
        if (c.tagName === 'td' || c.tagName === 'div') parts.push(' ')
      }
    }
  }
  add(n, 0, isElement(n) ? zeroFont(n, false) : false)
  return parts.join('').replace(blank, ' ').replace(/\s+/g, ' ').trim()
}

/** Real pictures (tracking pixels of 3px or less do not count). */
function pictures(n: Node) {
  const found = { count: 0, wide: 0 }
  const visit = (el: T.Element) => {
    if (hidden(el)) return false
    if (el.tagName !== 'img') return
    const w = pixels(attr(el, 'width'))
    const h = pixels(attr(el, 'height'))
    if ((w !== null && w <= 3) || (h !== null && h <= 3)) return
    found.count++
    // The width attribute wins (MJML sets it next to style width:100%);
    // without one, a picture stretched to 100% is a banner.
    const wide =
      w !== null
        ? w >= 400
        : (widthOf(el) ?? 0) >= 400 ||
          /^100%$/.test(attr(el, 'width') ?? '') ||
          /(?:^|[;\s])width\s*:\s*100%/i.test(attr(el, 'style') ?? '')
    if (wide) found.wide++
  }
  if (isElement(n)) visit(n)
  walk(n, visit)
  return found
}
const imagesOf = (n: Node) => pictures(n).count

function linksOf(n: Node) {
  const out: { text: string; href: string }[] = []
  walk(n, (el) => {
    if (el.tagName !== 'a') return
    const href = attr(el, 'href')
    if (href && /^https?:/i.test(href))
      out.push({ text: textOf(el).slice(0, 120), href: href.slice(0, 500) })
  })
  return out
}

/** 600 or 600px as a number; anything else (100%, auto) as null. */
function pixels(value: string | null) {
  const m = /^\s*(\d+)(?:px)?\s*$/i.exec(value ?? '')
  return m ? Number(m[1]) : null
}

/** A width the template set, from the width attribute or the style. */
function widthOf(el: T.Element) {
  const w = pixels(attr(el, 'width'))
  if (w !== null) return w
  const style = attr(el, 'style') ?? ''
  const m = /(?:^|;)\s*(?:max-)?width\s*:\s*(\d+)px/i.exec(style)
  return m ? Number(m[1]) : null
}

const weight = (n: Node) => textOf(n).length + 60 * imagesOf(n)

const containerTags = new Set(['table', 'div', 'td', 'center', 'section'])

/** A 500–760px container: the width emails are designed at. */
function column(el: T.Element) {
  if (!containerTags.has(el.tagName) || hidden(el)) return false
  const w = widthOf(el)
  return w !== null && w >= 500 && w <= 760
}

/**
 * The content column: the outermost 500–760px container that holds most of
 * the email. MJML and similar builders stack one 600px box per section
 * instead; then all of those boxes, in order, are the content. The body
 * when there is neither.
 */
function contentRoots(body: T.Element): T.Element[] {
  const total = weight(body)
  let best: T.Element[] | null = null
  const visit = (el: T.Element) => {
    if (best || hidden(el)) return false
    const stacked = elements(el).filter(column)
    if (
      stacked.length >= 2 &&
      stacked.reduce((n, c) => n + weight(c), 0) >= total * 0.6
    ) {
      best = stacked
      return false
    }
    if (column(el) && weight(el) >= total * 0.6) {
      best = [el]
      return false
    }
  }
  visit(body)
  if (!best) walk(body, visit)
  return best ?? [body]
}

/** Direct rows of a table (through thead, tbody and tfoot). */
const tableRows = (table: T.Element) =>
  elements(table).flatMap((c) =>
    c.tagName === 'tr'
      ? [c]
      : ['thead', 'tbody', 'tfoot'].includes(c.tagName)
        ? elements(c).filter((r) => r.tagName === 'tr')
        : []
  )

/** Children that show something (not hidden, not empty). */
const meaningful = (els: T.Element[]) =>
  els.filter((e) => !hidden(e) && (textOf(e) || imagesOf(e) > 0))

/** Tags that sit inside a line of text rather than making a block. */
const inlineTags = new Set([
  'a',
  'abbr',
  'b',
  'br',
  'code',
  'em',
  'font',
  'i',
  'img',
  'mark',
  's',
  'small',
  'span',
  'strike',
  'strong',
  'sub',
  'sup',
  'u'
])

/** Words written straight into the element, outside any child tag. */
const ownWords = (el: T.Element) =>
  children(el).some(
    (c) =>
      c.nodeName === '#text' &&
      (c as T.TextNode).value.replace(blank, '').length > 0
  )

/** Columns side by side (MJML's inline-block column divs, floats). */
const sideBySide = (el: T.Element) =>
  el.tagName === 'div' &&
  /display\s*:\s*inline-block|float\s*:\s*(left|right)/i.test(
    attr(el, 'style') ?? ''
  )

/**
 * The rows of a container. A wrapper with one meaningful child (a cell
 * around a table, a div around a div) is looked through.
 */
function rowsOf(el: T.Element, depth = 0): T.Element[] {
  if (depth > 12) return [el]
  if (el.tagName === 'table') {
    const rows = meaningful(tableRows(el))
    if (rows.length !== 1) return rows
    const cells = meaningful(elements(rows[0]!))
    if (cells.length !== 1) return rows
    return rowsOf(cells[0]!, depth + 1)
  }
  const inner = meaningful(elements(el))
  // Only words (or a broken tree): the container itself is the section.
  if (!inner.length) return textOf(el) || imagesOf(el) ? [el] : []
  // A line of words with links or bold parts in it is one block, and so
  // are columns standing side by side (a product row).
  if (
    ownWords(el) ||
    inner.every((e) => inlineTags.has(e.tagName)) ||
    (inner.length >= 2 && inner.every(sideBySide))
  )
    return [el]
  if (
    inner.length === 1 &&
    ['table', 'div', 'td', 'center', 'section', 'tbody'].includes(
      inner[0]!.tagName
    )
  )
    return rowsOf(inner[0]!, depth + 1)
  return inner
}

/** One section from one or more consecutive rows. */
function sectionOf(rows: T.Element[], ordinal: number): EmailSection {
  const text = rows.map(textOf).filter(Boolean).join(' ')
  const words = text ? text.split(' ').length : 0
  const found = rows.map(pictures)
  const images = found.reduce((n, p) => n + p.count, 0)
  const wideImages = found.reduce((n, p) => n + p.wide, 0)
  return {
    ordinal,
    html: rows.map((r) => serializeOuter(r)).join(''),
    text: text.slice(0, 4000),
    words,
    images,
    wideImages,
    links: rows.flatMap(linksOf).slice(0, 20),
    kind: images > 0 && words < designWords ? 'design' : 'text'
  }
}

/** The first hidden text near the top: the preview line inboxes show. */
function preheaderOf(body: T.Element) {
  let found: string | null = null
  walk(body, (el) => {
    if (found) return false
    if (hidden(el)) {
      const text = textOf(el)
      if (text.length >= 3) found = text.slice(0, 200)
      return false
    }
  })
  return found
}

const proseTags = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'ul',
  'ol',
  'blockquote',
  'span'
])

/**
 * Sections of one email's HTML, its marked copy and its text:design share.
 * Without a layout table, consecutive plain paragraphs stay one text
 * section (a letter is one block, not one block per paragraph).
 */
export function sectionEmail(html: string): SectionedEmail {
  try {
    return sectioned(html)
  } catch {
    // A tree too odd to read (for example nested thousands deep) is kept
    // whole: the email simply has no sections.
    return { sections: [], markedHtml: html, preheader: null, textRatio: null }
  }
}

/**
 * Where to write data-gr-section into the original HTML: right after the
 * row's own tag name. Rows the parser made up (no start tag of their own in
 * the source) are not marked; their crop is simply missing.
 */
function markAt(html: string, el: T.Element) {
  const at = el.sourceCodeLocation?.startTag?.startOffset
  if (at === undefined || html[at] !== '<') return null
  const end = at + 1 + el.tagName.length
  return html.slice(at + 1, end).toLowerCase() === el.tagName ? end : null
}

/**
 * The original HTML with data-gr-section="n" on each section's rows. The
 * source is changed only there: the doctype, entities and every other
 * byte stay as sent, so the screenshot shows the email as it really looks.
 */
function marked(html: string, groups: { rows: T.Element[] }[]) {
  const marks = new Map<number, number>()
  groups.forEach((g, i) => {
    for (const row of g.rows) {
      const at = markAt(html, row)
      if (at !== null && !marks.has(at)) marks.set(at, i + 1)
    }
  })
  const parts: string[] = []
  let from = 0
  for (const [at, n] of [...marks].sort((a, b) => a[0] - b[0])) {
    parts.push(html.slice(from, at), ` data-gr-section="${n}"`)
    from = at
  }
  parts.push(html.slice(from))
  return parts.join('')
}

function sectioned(html: string): SectionedEmail {
  const doc = parse(html.slice(0, 2_000_000), { sourceCodeLocationInfo: true })
  let body: T.Element | null = null
  walk(doc, (el) => {
    if (el.tagName === 'body') {
      body = el
      return false
    }
  })
  if (!body)
    return { sections: [], markedHtml: html, preheader: null, textRatio: null }
  const groups: { rows: T.Element[]; prose: boolean }[] = []
  for (const root of contentRoots(body))
    for (const row of rowsOf(root)) {
      const prose =
        root.tagName !== 'table' &&
        proseTags.has(row.tagName) &&
        imagesOf(row) === 0
      const last = groups.at(-1)
      if (prose && last?.prose) last.rows.push(row)
      else groups.push({ rows: [row], prose })
    }
  const kept = groups.slice(0, maxSections)
  const sections = kept.map((g, i) => sectionOf(g.rows, i + 1))
  return {
    sections,
    // Every row of a section carries its number; the screenshot browser
    // crops the box around all of them.
    markedHtml: marked(html, kept),
    preheader: preheaderOf(body),
    textRatio: sections.length
      ? sections.filter((s) => s.kind === 'text').length / sections.length
      : null
  }
}
