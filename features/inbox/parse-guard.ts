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
 * it (the tree builder: nesting, merged attributes, a deadline).
 */

/** Read on every call, so a test can lower one to prove it holds. */
export const parseLimits = {
  /** Characters parsed (a caller refuses or cuts longer HTML). */
  html: 4_000_000,
  /** Start and end tags. */
  tags: 200_000,
  /** Attributes squared, summed over tags (the tokenizer's own work). */
  attributeWork: 2_000_000,
  /** Elements inside each other (emails nest a few dozen deep). */
  depth: 256,
  /** Attributes merged onto one element (repeated <html> or <body>). */
  mergedAttributes: 1_000,
  /** One deadline for all the work on one email. */
  ms: 8_000
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

/** The deadline for one email, from now. */
export const deadline = () => Date.now() + parseLimits.ms

export function checkTime(until: number) {
  if (Date.now() > until) throw new ParseRefused('out_of_time')
}

const space = (c: string | undefined) =>
  c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f'

/**
 * Counts tags and the tokenizer's attribute work (it checks each attribute
 * against the tag's others) in one pass. Attributes are counted as the
 * tokenizer splits them (blanks, "/", right after a quote).
 */
function scan(html: string, until: number): ParseRefusal | null {
  let count = 0
  let work = 0
  for (let i = html.indexOf('<'); i >= 0; i = html.indexOf('<', i)) {
    let j = i + (html[i + 1] === '/' ? 2 : 1)
    if (!/[a-z]/i.test(html[j] ?? '')) {
      i = j
      continue
    }
    if (++count > parseLimits.tags) return 'too_many_tags'
    if ((count & 4095) === 0 && Date.now() > until) return 'out_of_time'
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
    if ((work += attrs * attrs) > parseLimits.attributeWork)
      return 'attribute_flood'
    i = j + 1
  }
  return null
}

/** The parser's own tree builder, counting as it builds. */
function guarded(until: number): TreeAdapter<DefaultTreeAdapterMap> {
  const depth = new WeakMap<object, number>()
  const place = (parent: object, child: object) => {
    const d = (depth.get(parent) ?? 0) + 1
    if (d > parseLimits.depth) throw new ParseRefused('too_deep')
    depth.set(child, d)
  }
  return {
    ...defaultTreeAdapter,
    createElement(tagName, namespace, attrs) {
      checkTime(until)
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
      if (element.attrs.length + attrs.length > parseLimits.mergedAttributes)
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
  until: number,
  options: Omit<ParserOptions<DefaultTreeAdapterMap>, 'treeAdapter'> = {}
): T.Document {
  if (html.length > parseLimits.html) throw new ParseRefused('too_large')
  const refused = scan(html, until)
  if (refused) throw new ParseRefused(refused)
  return parse(html, { ...options, treeAdapter: guarded(until) })
}
