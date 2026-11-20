import {
  defaultTreeAdapter,
  parse,
  type DefaultTreeAdapterMap,
  type DefaultTreeAdapterTypes as T,
  type ParserOptions,
  type TreeAdapter
} from 'parse5'

/**
 * INB-SEC: inbound email HTML is parsed only behind this guard. parse5
 * slows down quadratically on tags nested thousands deep and on many
 * attributes, and a parse cannot be stopped from outside, so the guard
 * counts before the parse (tags, the tokenizer's attribute work) and inside
 * it (the tree builder: nesting, merged attributes, the deadline).
 */

/** The limits; a call may lower them (`GuardOptions.limits`). */
export const parseLimits = Object.freeze({
  /**
   * Characters parsed. Gmail clips an email at 102 KB, so a newsletter is
   * far below 1 MB; a caller refuses or cuts longer HTML.
   */
  html: 1_000_000,
  /** Tags, comments and other markup: each splits the words in pieces. */
  tags: 50_000,
  /** Attributes squared, summed over tags (the tokenizer's own work). */
  attributeWork: 2_000_000,
  /** Elements inside each other (emails nest a few dozen deep). */
  depth: 256,
  /** Attributes merged onto one element (repeated <html> or <body>). */
  mergedAttributes: 1_000,
  /** One deadline for all the work on one email. */
  ms: 3_000
})
export type ParseLimits = { -readonly [K in keyof typeof parseLimits]: number }

/** Where the deadline is read (a test's clock can tell them apart). */
export type DeadlineCheck =
  | 'start'
  | 'scan'
  | 'element'
  | 'walk'
  | 'column'
  | 'block'
  | 'css'
  | 'strings'
  | 'fold'
  | 'pass'
  | 'writer'

export type GuardOptions = {
  /**
   * Lower limits for this email (how a test proves each guard). A limit
   * is never raised: a value above the default, or not a number, is
   * ignored.
   */
  limits?: Partial<ParseLimits>
  /**
   * The clock the deadline is read from, by check (`Date.now`). It can
   * only bring the deadline closer: real time still ends the work.
   */
  clock?: (check: DeadlineCheck) => number
}

/** One email's limits, clock and single deadline. */
export type Guard = {
  limits: ParseLimits
  now: (check: DeadlineCheck) => number
  until: number
  /** By real time, which no passed clock extends. */
  hard: number
}

export type ParseRefusal =
  | 'too_large'
  | 'too_many_tags'
  | 'attribute_flood'
  | 'too_deep'
  | 'merged_attributes'
  | 'out_of_time'

/** Why an email's HTML was not read, as a safe code for logs. */
export class ParseRefused extends Error {
  constructor(readonly code: ParseRefusal) {
    super(code)
    this.name = 'ParseRefused'
  }
}

/** The defaults, each lowered (never raised) by a finite given value. */
export function lower<L extends Record<string, number>>(
  defaults: L,
  given: Partial<Record<keyof L, unknown>> = {}
): L {
  const out = { ...defaults }
  for (const key of Object.keys(defaults) as (keyof L)[]) {
    const v = given[key]
    if (typeof v === 'number' && Number.isFinite(v))
      out[key] = Math.min(defaults[key], v) as L[keyof L]
  }
  return out
}

/** The guard for one email, its deadline counted from now. */
export function guardFor(options: GuardOptions = {}): Guard {
  const limits = lower(parseLimits, options.limits)
  const now = options.clock ?? (() => Date.now())
  return {
    limits,
    now,
    until: now('start') + limits.ms,
    hard: Date.now() + parseLimits.ms
  }
}

export function checkTime(g: Guard, check: DeadlineCheck) {
  if (g.now(check) > g.until || Date.now() > g.hard)
    throw new ParseRefused('out_of_time')
}

const space = (c: string | undefined) =>
  c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f'

/**
 * Counts the markup (tags, comments, any other "<!", "<?" or "</") and the
 * tokenizer's attribute work (it checks each attribute against the tag's
 * others) in one pass. Attributes are counted as the tokenizer splits them
 * (blanks, "/", right after a quote).
 */
function scan(html: string, g: Guard): ParseRefusal | null {
  let count = 0
  let work = 0
  for (let i = html.indexOf('<'); i >= 0; i = html.indexOf('<', i)) {
    let j = i + (html[i + 1] === '/' ? 2 : 1)
    const tag = /[a-z]/i.test(html[j] ?? '')
    if (!tag && !'!?/'.includes(html[i + 1] ?? '')) {
      i = j
      continue
    }
    if (++count > g.limits.tags) return 'too_many_tags'
    if ((count & 4095) === 1) checkTime(g, 'scan')
    if (!tag) {
      i = j
      continue
    }
    while (j < html.length && !space(html[j]) && !'/>'.includes(html[j]!)) j++
    let attrs = 0
    for (;;) {
      while (space(html[j]) || html[j] === '/') j++
      if (j >= html.length || html[j] === '>') break
      attrs++
      j++
      while (j < html.length && !space(html[j]) && !'/>='.includes(html[j]!))
        j++
      while (space(html[j])) j++
      if (html[j] !== '=') continue
      j++
      while (space(html[j])) j++
      const q = html[j]
      if (q === '"' || q === "'") {
        const end = html.indexOf(q, j + 1)
        j = end < 0 ? html.length : end + 1
      } else while (j < html.length && !space(html[j]) && html[j] !== '>') j++
    }
    if ((work += attrs * attrs) > g.limits.attributeWork)
      return 'attribute_flood'
    i = j + 1
  }
  return null
}

/** The parser's own tree builder, counting as it builds. */
function guarded(g: Guard): TreeAdapter<DefaultTreeAdapterMap> {
  const depth = new WeakMap<object, number>()
  const place = (parent: object, child: object) => {
    const d = (depth.get(parent) ?? 0) + 1
    if (d > g.limits.depth) throw new ParseRefused('too_deep')
    depth.set(child, d)
  }
  return {
    ...defaultTreeAdapter,
    createElement(tagName, namespace, attrs) {
      checkTime(g, 'element')
      return defaultTreeAdapter.createElement(tagName, namespace, attrs)
    },
    appendChild(parent, child) {
      place(parent, child)
      defaultTreeAdapter.appendChild(parent, child)
    },
    insertBefore(parent, child, reference) {
      place(parent, child)
      defaultTreeAdapter.insertBefore(parent, child, reference)
    },
    setTemplateContent(template, content) {
      depth.set(content, depth.get(template) ?? 0)
      defaultTreeAdapter.setTemplateContent(template, content)
    },
    adoptAttributes(element, attrs) {
      if (element.attrs.length + attrs.length > g.limits.mergedAttributes)
        throw new ParseRefused('merged_attributes')
      defaultTreeAdapter.adoptAttributes(element, attrs)
    }
  }
}

/**
 * parse5's `parse` behind the guard. Throws `ParseRefused` (with its
 * reason) instead of taking long; nothing else changes.
 */
export function guardedParse(
  html: string,
  g: Guard,
  options: Omit<ParserOptions<DefaultTreeAdapterMap>, 'treeAdapter'> = {}
): T.Document {
  if (html.length > g.limits.html) throw new ParseRefused('too_large')
  const refused = scan(html, g)
  if (refused) throw new ParseRefused(refused)
  return parse(html, { ...options, treeAdapter: guarded(g) })
}
