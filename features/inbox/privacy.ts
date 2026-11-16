import {
  defaultTreeAdapter,
  parse,
  type DefaultTreeAdapterMap,
  type DefaultTreeAdapterTypes as T,
  type TreeAdapter
} from 'parse5'
import { bareAddress, canonical } from './addresses'
import type { InboxConfig } from './config'
import { decode } from './images'

/**
 * REAL-1b1, Raman's decision of 16 November: a workspace may read a real
 * brand's newsletter, but never a person's name or email address from the
 * inbox. These pure functions clean one captured email (subject, text,
 * preview line and HTML) before any workspace may read it. Every rule is
 * linear on hostile input; HTML the parser would be slow on, or that does
 * not read back as itself once cleaned, is refused.
 */

/** The inbox's own addresses and the names it subscribed with. */
export type InboxIdentity = { addresses: string[]; names: string[] }

/** Treated as unchanging: the rules made from them are kept. */
export type CleanOptions = {
  /** Words never taken for a person's name, e.g. the brand's own name. */
  keep?: string[]
  /**
   * The stored copies (`inbox_message_images`): each image becomes its
   * path, and any other remote image is emptied.
   */
  images?: { ref: string; path: string }[]
}

export const privacyLimits = {
  subject: 200,
  preview: 300,
  text: 10_000,
  /** Text read before cleaning, per limit (cut after a whole word). */
  readFactor: 4,
  html: 4_000_000,
  tags: 100_000,
  tagAttributes: 1_000,
  /** Elements inside each other (emails nest a few dozen deep). */
  depth: 256,
  parseMs: 3_000
}

/** The identity from the inbox configuration (its address, the names). */
export function inboxIdentity(config: InboxConfig): InboxIdentity {
  const base = config.ready ? config.transport.base : null
  return {
    addresses: [
      ...new Set([
        ...(config.inboxAddresses ?? []),
        ...(base ? [`${base.local}@${base.domain}`] : [])
      ])
    ],
    names: config.subscriberNames ?? []
  }
}

const escape = (s: string) => s.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&')
const word = String.raw`[\p{L}\p{N}]`
const localChars = String.raw`\p{L}\p{N}._%+'=-`
const local = String.raw`(?<![${localChars}])[${localChars}]+`
const at = String.raw`[@\u{ff20}\u{fe6b}]`
const host = String.raw`[\p{L}\p{N}-]+`

// Every pattern starts only where a run starts (a lookbehind) and never
// rescans it, so each stays linear on long runs of letters or @ signs.
const sentTo = new RegExp(
  String.raw`(?<!\p{L})(?:(?:this|the|your)\s+(?:e-?mail|message|newsletter|mail)\s+(?:was\s+|is\s+|has\s+been\s+)?(?:(?:sent|addressed|delivered)\s+to|intended\s+for)|(?:sent|delivered)\s+to:?)(?=\s*(?:you\b|[^\s@]{1,64}${at}))(?:[^\n.!?]|[.!?](?=\S)){0,400}[.!?]?`,
  'giu'
)
const urlChar = String.raw`[^\s<>"'[\]{}]`
/** Links with a scheme, starting with //, or a host and a path; mailto. */
const url = new RegExp(
  String.raw`(?:\b(?:https?|ftp):|(?<![\p{L}\p{N}:/]))\/\/${urlChar}+(?:\n(?=\S*[=&%/?#])${urlChar}+)*|(?<![\p{L}\p{N}@._%+-])(?:[a-z\d-]+\.)+[a-z]{2,}(?=[/?#])${urlChar}+|\bmailto:\S*`,
  'giu'
)
const address = new RegExp(
  String.raw`${local}(?:${at}${host}(?:\.${host})*| ?${at} ?${host}(?:\.${host})+)`,
  'giu'
)
const bracket = (w: string) =>
  String.raw`[ \t]{0,3}[[({][ \t]{0,3}${w}[ \t]{0,3}[\])}][ \t]{0,3}`
const tlds =
  'com|net|org|io|co|uk|us|ca|au|de|fr|nl|es|it|info|biz|me|email|example|test'
const obfuscated = new RegExp(
  String.raw`${local}(?:${bracket('at')}${host}(?:(?:${bracket('dot')}|\.)${host})+|\s+at\s+${host}(?:\s+dot\s+${host}){0,3}\s+dot\s+(?:${tlds})(?!${word}))`,
  'giu'
)
/** The few escapes an address hides behind in a link. */
const encoded = /%(?:40|2b|2e|2d|5f|20)/gi
const unescape = (s: string) => s.replace(encoded, (e) => decodeURIComponent(e))
const greeting = new RegExp(
  String.raw`(?<!${word})(hi|hey|hello|hiya|heya|howdy|dear)(,?[ \t\u{a0}]+)(${word}[\p{L}\p{N}.'’+_-]{0,63}(?:[ \t]\p{L}[\p{L}'’-]{0,39}){0,2})(?=[ \t\u{a0}]*([,!?;:.\n—–-]|\p{Extended_Pictographic}|$))`,
  'giu'
)
const greetingWord = /^(?:hi|hey|hello|hiya|heya|howdy|dear)$/i
/** Words after "Hi" that are not a person: "Hi there,", "Dear Diary,". */
const notNames = new Set(
  (
    'there all everyone everybody friend friends folks team you yall y’all guys gang fam family ' +
    'beautiful gorgeous lovely love lovers babe darling dear diary dude bestie sunshine stranger world ' +
    'again new hi hey hello kitty spring summer autumn fall winter weekend holidays holiday season ' +
    'halloween christmas easter insider insiders member members vip vips valued customer customers ' +
    'shopper shoppers reader readers subscriber subscribers beauty mama monday tuesday wednesday ' +
    'thursday friday saturday sunday january february march april may june july august september ' +
    'october november december'
  ).split(' ')
)

type Rules = {
  locals: RegExp | null
  local: RegExp | null
  names: RegExp | null
  nameSet: Set<string>
  keep: RegExp | null
  keepWords: Set<string>
  images: Map<string, string>
}

const anyOf = (alternatives: string[]) =>
  alternatives.length
    ? new RegExp(
        String.raw`(?<!${word})(?:${alternatives.join('|')})(?:['’]s)?(?!${word})`,
        'giu'
      )
    : null

/** Whole names and each of their words. */
function nameWords(names: string[]) {
  const all = new Set<string>()
  for (const raw of names.slice(0, 20)) {
    const name = raw.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase()
    if (name.length < 2) continue
    all.add(name)
    for (const w of name.split(' ')) if (w.length >= 2) all.add(w)
  }
  return all
}

const phrases = (set: Set<string>) =>
  [...set]
    .sort((a, b) => b.length - a.length)
    .map((n) => escape(n).replace(/ /g, String.raw`\s{1,5}`))

function compile(identity: InboxIdentity, options: CleanOptions): Rules {
  // The inbox's local part (Gmail ignores its dots), with any +alias.
  const locals = identity.addresses.flatMap((a) => {
    const found = bareAddress(a)
    if (!found) return []
    const at = found.lastIndexOf('@')
    const own = canonical(
      found.slice(0, at).split('+')[0]!,
      found.slice(at + 1)
    )
    if (!own.local) return []
    const chars = [...own.local].map(escape)
    return [chars.join(own.domain === 'gmail.com' ? String.raw`\.?` : '')]
  })
  const local = locals.length
    ? String.raw`(?:${locals.join('|')})(?:\+[\p{L}\p{N}_-]+)?`
    : null
  const nameSet = nameWords(identity.names)
  const keep = (options.keep ?? []).map((k) => k.replace(/\s+/g, ' ').trim())
  const images = new Map<string, string>()
  for (const { ref, path } of options.images ?? []) {
    images.set(ref.trim(), path)
    images.set(decode(ref).trim(), path)
  }
  return {
    locals: local
      ? new RegExp(
          String.raw`(?<![\p{L}\p{N}._%+-])${local}(?![\p{L}\p{N}_%+-]|\.[\p{L}\p{N}])`,
          'giu'
        )
      : null,
    local: local ? new RegExp(`^${local}$`, 'iu') : null,
    names: anyOf(phrases(nameSet)),
    nameSet,
    keep: anyOf(phrases(new Set(keep.filter(Boolean)))),
    keepWords: nameWords(keep),
    images
  }
}

const compiled = new WeakMap<InboxIdentity, WeakMap<CleanOptions, Rules>>()
const noOptions: CleanOptions = {}

/** The rules for an identity, made once per identity and options. */
function rulesFor(identity: InboxIdentity, options = noOptions): Rules {
  let byOptions = compiled.get(identity)
  if (!byOptions) compiled.set(identity, (byOptions = new WeakMap()))
  let rules = byOptions.get(options)
  if (!rules) byOptions.set(options, (rules = compile(identity, options)))
  return rules
}

/**
 * A person's name after a greeting: one of the inbox's names or its local
 * part, or (`loose`: one word before a comma, starting a line) any
 * capitalized word that is not a common word or the brand's own.
 */
function isName(r: Rules, candidate: string, loose: boolean) {
  const name = candidate.replace(/\s+/g, ' ')
  if (r.nameSet.has(name.toLowerCase()) || r.local?.test(name)) return true
  return (
    loose &&
    /^\p{Lu}[\p{L}'’-]*$/u.test(name) &&
    !notNames.has(name.toLowerCase()) &&
    !r.keepWords.has(name.toLowerCase())
  )
}

/** Whether a match starts a line (only a few blanks before it). */
const startsLine = (s: string, at: number) =>
  /(?:^|\n)[ \t\u{a0}]{0,8}$/u.test(s.slice(Math.max(0, at - 9), at)) &&
  (at > 8 || !s.slice(0, at).trim())

/** A link's own trailing punctuation (and an unmatched ")") stays. */
function linkTail(m: string) {
  let open = 0
  for (const c of m) open += c === '(' ? 1 : c === ')' ? -1 : 0
  let end = m.length
  for (; end > 0; end--) {
    const c = m[end - 1]!
    if (c === ')' && open < 0) open++
    else if (!'.,!?;:'.includes(c)) break
  }
  return m.slice(end)
}

/** Tidies what a removal left: spaces, empty brackets, stray commas. */
function tidy(s: string, edges: boolean) {
  const out = s
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\([ \t]*\)|\[[ \t]*\]|<[ \t]*>|\{[ \t]*\}/g, '')
    .replace(/(?<![ \t\u{a0}])[ \t\u{a0}]+(?=[,.!?;:])/gu, '')
    .replace(/[,;:][ \t]?(?=[,.!?;:])/g, '')
    .replace(/[ \t]{2,}/g, ' ')
  return edges
    ? out
    : out
        .replace(/[ \t]+$/gm, '')
        .replace(/^[ \t]*(?:[,;:][ \t]*)?/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

const anchors = /[\u{fff9}-\u{fffb}]/gu
const parked = /\u{fff9}([\u{e000}-\u{f8ff}])\u{fffb}/gu

function pass(input: string, r: Rules, edges: boolean) {
  let s = unescape(input.normalize('NFC').replace(anchors, ''))
    .replace(sentTo, '')
    .replace(url, linkTail)
    .replace(address, '')
    .replace(obfuscated, '')
  // The brand's own name is set aside, so no rule below can touch it.
  const saved: string[] = []
  if (r.keep)
    s = s.replace(r.keep, (m) =>
      saved.length < 6_000
        ? `\u{fff9}${String.fromCharCode(0xe000 + saved.push(m) - 1)}\u{fffb}`
        : m
    )
  s = s.replace(
    greeting,
    (
      m,
      hi: string,
      _sep: string,
      candidate: string,
      after: string,
      offset: number,
      all: string
    ) => {
      const name = candidate.replace(/\.+$/, '')
      const loose = after === ',' && startsLine(all, offset)
      if (!isName(r, name, loose)) return m
      const word = /^dear$/i.test(hi) ? (hi[0] === 'D' ? 'Hi' : 'hi') : hi
      return `${word} there${candidate.slice(name.length)}`
    }
  )
  if (r.locals) s = s.replace(r.locals, (m) => (/[+.]/.test(m) ? '' : m))
  if (r.names) s = s.replace(r.names, '')
  if (saved.length)
    s = s.replace(parked, (_, c: string) => saved[c.charCodeAt(0) - 0xe000]!)
  return s === input ? input : tidy(s, edges)
}

/** Cleans until nothing changes (at most three passes). */
function clean(text: string, r: Rules, edges = false) {
  let out = text
  for (let i = 0; i < 3; i++) {
    const next = pass(out, r, edges)
    if (next === out) break
    out = next
  }
  return out
}

/** Whether a value (a link, a style) holds an address or a name. */
function hit(value: string, r: Rules) {
  let s = value
  try {
    s = decodeURIComponent(value)
  } catch {
    s = unescape(value)
  }
  for (const re of [address, obfuscated, r.names]) {
    if (!re) continue
    re.lastIndex = 0
    if (re.test(s)) return true
  }
  return [...(r.locals ? s.matchAll(r.locals) : [])].some((m) =>
    /[+.]/.test(m[0])
  )
}

/** Addresses, the inbox's local part and the names, removed (no tidying). */
function scrub(s: string, r: Rules) {
  let out = s.replace(address, '').replace(obfuscated, '')
  if (r.locals) out = out.replace(r.locals, (m) => (/[+.]/.test(m) ? '' : m))
  return r.names ? out.replace(r.names, '') : out
}

/** At most `max` characters, cut after a whole word (or a whole character). */
function cut(value: string, max: number) {
  if (value.length <= max) return value
  let s = value.slice(0, max)
  if (/[\u{d800}-\u{dbff}]$/u.test(s)) s = s.slice(0, -1)
  const at = Math.max(s.lastIndexOf(' '), s.lastIndexOf('\n'))
  return (at > max / 2 ? s.slice(0, at) : s).trimEnd()
}

const read = (value: string, max: number) =>
  cut(value, max * privacyLimits.readFactor)

export const cleanEmailText = (
  text: string,
  identity: InboxIdentity,
  options?: CleanOptions
) =>
  cut(
    clean(read(text, privacyLimits.text), rulesFor(identity, options)),
    privacyLimits.text
  )

/** A subject or preview line: one line, cleaned, cut to `max`. */
const oneLine =
  (max: number) =>
  (value: string, identity: InboxIdentity, options?: CleanOptions) =>
    cut(
      clean(
        read(value, max).replace(/\s+/g, ' ').trim(),
        rulesFor(identity, options)
      ),
      max
    )

export const cleanEmailSubject = oneLine(privacyLimits.subject)
export const cleanEmailPreview = oneLine(privacyLimits.preview)

// ---------------------------------------------------------------- HTML

type Node = T.ChildNode | T.ParentNode
const isElement = (n: Node): n is T.Element => 'tagName' in n
const children = (n: Node): T.ChildNode[] =>
  'childNodes' in n ? (n.childNodes as T.ChildNode[]) : []
const attr = (el: T.Element, name: string) =>
  el.attrs.find((a) => a.name === name)?.value ?? null
const htmlNs = 'http://www.w3.org/1999/xhtml'

const tags = (names: string) => new Set(names.split(' '))
const voidTags = tags(
  'area base basefont bgsound br col embed frame hr img input keygen link meta param source track wbr'
)
/** Whole subtrees that go: active content, frames, fields, foreign markup. */
const dropTags = tags(
  'script noscript iframe object embed applet frame frameset base link input select textarea keygen datalist noembed noframes portal svg math'
)
const blockTags = tags(
  'address article aside blockquote body br caption center dd details div dl dt figcaption figure footer form h1 h2 h3 h4 h5 h6 header hr li main nav ol p pre section summary table tbody td tfoot th thead tr ul'
)
const linkAttrs = tags(
  'action formaction ping cite longdesc codebase archive manifest data profile classid dynsrc lowsrc'
)

const space = (c: string | undefined) =>
  c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f'

/**
 * Whether the tokenizer stays fast: it checks each attribute against the
 * tag's others (quadratic), so a tag with thousands of them is refused, and
 * so is an email of more tags than any newsletter has. Attributes are
 * counted like the tokenizer splits them (blanks, "/", after a quote).
 */
function scannable(html: string) {
  let count = 0
  for (let i = html.indexOf('<'); i >= 0; i = html.indexOf('<', i)) {
    let j = i + (html[i + 1] === '/' ? 2 : 1)
    if (!/[a-z]/i.test(html[j] ?? '')) {
      i = j
      continue
    }
    if (++count > privacyLimits.tags) return false
    while (j < html.length && !space(html[j]) && !'/>'.includes(html[j]!)) j++
    for (let attrs = 0; ;) {
      while (space(html[j]) || html[j] === '/') j++
      if (j >= html.length || html[j] === '>') break
      if (++attrs > privacyLimits.tagAttributes) return false
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
    i = j + 1
  }
  return true
}

class Refused extends Error {}

/**
 * The parser's own tree builder, counting as it builds: nesting deeper than
 * any email, too many attributes merged onto one element (repeated <html>
 * or <body> tags) or too long a parse stop it.
 */
function guarded(): TreeAdapter<DefaultTreeAdapterMap> {
  const depth = new WeakMap<object, number>()
  const until = Date.now() + privacyLimits.parseMs
  let calls = 0
  const place = (parent: object, child: object) => {
    const d = (depth.get(parent) ?? 0) + 1
    if (d > privacyLimits.depth) throw new Refused()
    if ((++calls & 1023) === 0 && Date.now() > until) throw new Refused()
    depth.set(child, d)
  }
  return {
    ...defaultTreeAdapter,
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
      if (element.attrs.length + attrs.length > privacyLimits.tagAttributes)
        throw new Refused()
      defaultTreeAdapter.adoptAttributes(element, attrs)
    }
  }
}

/** Open-tracking pixels: 1x1 or 0x0, or on a tracking address. */
function trackingPixel(el: T.Element) {
  const size = (name: string) => {
    const css = new RegExp(String.raw`(?:^|[;\s])${name}\s*:\s*([^;]*)`, 'i')
    const v = (attr(el, name) ?? css.exec(attr(el, 'style') ?? '')?.[1])?.trim()
    if (v === undefined) return null
    const m = /^(\d+)(?:px)?$/i.exec(v)
    // 100% or auto: a real width (a divider line), not a pixel.
    return m ? Number(m[1]) : Infinity
  }
  const w = size('width')
  const h = size('height')
  if ((w ?? 1) <= 1 && (h ?? 1) <= 1 && (w !== null || h !== null)) return true
  try {
    // A //host link is resolved as https, like an email app does.
    const link = new URL(attr(el, 'src') ?? '', 'https://image.invalid/')
    return (
      /^(?:trk|track|tracking|pixel|beacon|opens?)\d*$/i.test(
        link.hostname.split('.')[0]!
      ) ||
      /\/(?:open|opened|pixel|beacon)(?:\.(?:gif|png|php|aspx?))?$|\/(?:track|wf)\/open/i.test(
        link.pathname
      )
    )
  } catch {
    return false
  }
}

/**
 * A picture's address: its stored copy's path; else a web address without
 * its query and fragment. Empty when it names the person, uses another
 * scheme, or (with stored copies given) has no stored copy.
 */
function imageUrl(value: string, r: Rules) {
  const v = value.trim()
  const stored = r.images.get(v)
  if (stored !== undefined) return stored
  if (/^(?:cid:|data:image\/)/i.test(v)) return value
  if (/^[a-z][a-z\d+.-]*:/i.test(v) && !/^https?:/i.test(v)) return ''
  if (r.images.size && /^(?:https?:)?\/\//i.test(v)) return ''
  const at = v.search(/[?#]/)
  const bare = at < 0 ? v : v.slice(0, at)
  if (hit(bare, r)) return ''
  return bare === v ? value : bare
}

/** srcset candidates (a link may hold commas; one ends at a blank). */
function srcset(value: string, r: Rules) {
  const out: string[] = []
  for (let i = 0; i < value.length;) {
    while (i < value.length && (space(value[i]) || value[i] === ',')) i++
    let j = i
    while (j < value.length && !space(value[j])) j++
    let link = value.slice(i, j)
    let size = ''
    if (link.endsWith(',')) link = link.replace(/,+$/, '')
    else {
      const comma = value.indexOf(',', j)
      size = value.slice(j, comma < 0 ? value.length : comma).trim()
      j = comma < 0 ? value.length : comma + 1
    }
    const clean = link ? imageUrl(link, r) : ''
    if (clean) out.push(size ? `${clean} ${size}` : clean)
    i = j
  }
  return out.join(', ')
}

/** Removes CSS comments in one pass (an open one runs to the end). */
function dropComments(css: string) {
  let out = ''
  for (let at = 0; ;) {
    const open = css.indexOf('/*', at)
    if (open < 0) return out + css.slice(at)
    out += css.slice(at, open)
    const close = css.indexOf('*/', open + 2)
    if (close < 0) return out
    at = close + 2
  }
}

/**
 * CSS (a style attribute or a <style> block): no comments and no "<" (so
 * nothing can close the block early), every url() and every quoted link
 * cleaned like an image's address, then addresses and names removed.
 */
function cleanCss(css: string, r: Rules) {
  const s = dropComments(css)
    .replace(/</g, '')
    .replace(
      /url\(\s*(['"]?)([^'"()\s]{1,4000})\1\s*\)/gi,
      (m, q: string, u: string) => {
        const next = imageUrl(u, r)
        return !next ? 'none' : next === u ? m : `url(${q}${next}${q})`
      }
    )
    .replace(/"([^"\n]{0,4000})"|'([^'\n]{0,4000})'/g, (m, d, s) => {
      const value = (d ?? s) as string
      if (!/^\s*(?:[a-z][a-z\d+.-]*:|\/)/i.test(value)) return m
      const next = imageUrl(value, r)
      return next === value ? m : `${m[0]}${next}${m[0]}`
    })
  return scrub(s, r)
}

function cleanAttrs(el: T.Element, r: Rules) {
  const tag = el.tagName
  el.attrs = el.attrs.flatMap((a): T.Element['attrs'] => {
    const name = a.name.toLowerCase()
    if (
      name.startsWith('on') ||
      linkAttrs.has(name) ||
      (name.startsWith('data-') && name !== 'data-gr-section')
    )
      return []
    let value = a.value
    // Every link target goes: hrefs carry per-subscriber tracking tokens.
    if (name === 'href') {
      if (tag === 'a' || tag === 'area') value = ''
      else if (!value.trim().startsWith('#')) return []
    } else if (name === 'src' || name === 'background' || name === 'poster')
      value = imageUrl(value, r)
    else if (name === 'srcset') value = srcset(value, r)
    else if (name === 'style') value = cleanCss(value, r)
    else value = clean(value, r)
    return [value === a.value ? a : { ...a, value }]
  })
}

const dropped = (el: T.Element) =>
  dropTags.has(el.tagName) ||
  el.namespaceURI !== htmlNs ||
  (el.tagName === 'img' && trackingPixel(el)) ||
  (el.tagName === 'meta' && /refresh/i.test(attr(el, 'http-equiv') ?? ''))

const greetingEnd =
  /(?<![\p{L}\p{N}])(?:hi|hey|hello|hiya|heya|howdy|(dear)),?\s*$/iu
const nameOnly = /^(\s*)(\S.{0,79}?)([.,!?;:]*\s*)$/su

/**
 * The words of one block (a paragraph, a cell) joined: an address or a name
 * cut in pieces by tags ("sampleinbox<wbr>@gmail.com") is removed too.
 */
function scrubAcross(nodes: T.TextNode[], r: Rules) {
  if (nodes.length < 2) return
  const joined = nodes.map((t) => t.value).join('')
  const gone = new Uint8Array(joined.length)
  let found = false
  for (const re of [address, obfuscated, r.locals, r.names])
    for (const m of re ? joined.matchAll(re) : [])
      if (re !== r.locals || /[+.]/.test(m[0])) {
        gone.fill(1, m.index, m.index + m[0].length)
        found = true
      }
  if (!found) return
  let at = 0
  for (const t of nodes) {
    const kept: string[] = []
    for (let i = 0; i < t.value.length; i++)
      if (!gone[at + i]) kept.push(t.value[i]!)
    at += t.value.length
    t.value = kept.join('')
  }
}

/** Walks the tree with a list (never recursion) and cleans it in place. */
function cleanTree(doc: T.Document, r: Rules) {
  const gone = new Set<Node>()
  const parents = new Set<T.ParentNode>()
  const stack: (Node | 'end')[] = [...children(doc)].reverse()
  // The words just before, for "Hi <b>Sam</b>," (the name in its own tag),
  // and all the words of the block so far.
  let before: T.TextNode | null = null
  let block: T.TextNode[] = []
  const endBlock = () => {
    scrubAcross(block, r)
    block = []
    before = null
  }
  while (stack.length) {
    const n = stack.pop()!
    if (n === 'end') {
      endBlock()
      continue
    }
    if (n.nodeName === '#comment' || (isElement(n) && dropped(n))) {
      gone.add(n)
      const parent = (n as T.ChildNode).parentNode
      if (parent) parents.add(parent)
      continue
    }
    if (n.nodeName === '#text') {
      const text = n as T.TextNode
      const parent = text.parentNode
      if (parent && isElement(parent) && parent.tagName === 'style') {
        text.value = cleanCss(text.value, r)
        continue
      }
      block.push(text)
      if (!/[\p{L}\p{N}@%\u{ff20}\u{fe6b}]/u.test(text.value)) continue
      let value = text.value
      const greeted = before ? greetingEnd.exec(before.value) : null
      const own = greeted ? nameOnly.exec(value) : null
      if (
        before &&
        greeted &&
        own &&
        isName(
          r,
          own[2]!,
          own[3]!.startsWith(',') &&
            greetingWord.test(before.value.replace(/[\s,]/g, ''))
        )
      ) {
        value = `${own[1]}there${own[3]}`
        if (greeted[1])
          before.value = before.value.replace(
            /dear(,?\s*)$/i,
            (m, rest) => `${m[0] === 'D' ? 'Hi' : 'hi'}${rest}`
          )
      }
      text.value = clean(value, r, true)
      if (text.value.trim()) before = text
      continue
    }
    if (!isElement(n)) continue
    const isBlock = blockTags.has(n.tagName)
    if (isBlock) endBlock()
    cleanAttrs(n, r)
    // A form keeps its look as a plain box, raw-text blocks become <pre>
    // (written escaped, so their words can never turn into tags).
    if (n.tagName === 'form') n.tagName = n.nodeName = 'div'
    if (n.tagName === 'xmp' || n.tagName === 'plaintext')
      n.tagName = n.nodeName = 'pre'
    if (isBlock) stack.push('end')
    const kids = children(
      n.tagName === 'template' ? (n as T.Template).content : n
    )
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!)
  }
  endBlock()
  for (const p of parents)
    p.childNodes = p.childNodes.filter((c) => !gone.has(c)) as never
}

const escapeText = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/\u{a0}/gu, '&nbsp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
const escapeAttr = (s: string) => escapeText(s).replace(/"/g, '&quot;')
const quoted = (id: string) => (id.includes('"') ? `'${id}'` : `"${id}"`)

/**
 * The HTML again, without recursion. The doctype keeps its public and
 * system ids (they decide how the email lays out); a quirks-mode email
 * gets none, which keeps it in quirks mode.
 */
function serialize(doc: T.Document) {
  const out: string[] = []
  const stack: (Node | string)[] = [...children(doc)].reverse()
  while (stack.length) {
    const n = stack.pop()!
    if (typeof n === 'string') out.push(n)
    else if (n.nodeName === '#documentType') {
      const d = n as T.DocumentType
      if (doc.mode !== 'quirks')
        out.push(
          `<!DOCTYPE ${d.name}${d.publicId ? ` PUBLIC ${quoted(d.publicId)}` : d.systemId ? ' SYSTEM' : ''}${d.systemId ? ` ${quoted(d.systemId)}` : ''}>`
        )
    } else if (n.nodeName === '#text') {
      const parent = (n as T.TextNode).parentNode
      const raw = parent && isElement(parent) && parent.tagName === 'style'
      out.push(
        raw ? (n as T.TextNode).value : escapeText((n as T.TextNode).value)
      )
    } else if (isElement(n)) {
      out.push(
        `<${n.tagName}${n.attrs
          .map(
            (a) =>
              ` ${a.prefix ? `${a.prefix}:` : ''}${a.name}="${escapeAttr(a.value)}"`
          )
          .join('')}>`
      )
      if (voidTags.has(n.tagName)) continue
      stack.push(`</${n.tagName}>`)
      const kids = children(
        n.tagName === 'template' ? (n as T.Template).content : n
      )
      // The parser drops a <pre>'s first line break; one more keeps it.
      const first = kids[0]
      if (
        n.tagName === 'pre' &&
        first?.nodeName === '#text' &&
        (first as T.TextNode).value.startsWith('\n')
      )
        out.push('\n')
      for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!)
    }
  }
  return out.join('')
}

function cleanOnce(html: string, r: Rules) {
  if (html.length > privacyLimits.html || !scannable(html)) return null
  let doc: T.Document
  try {
    doc = parse(html, { scriptingEnabled: false, treeAdapter: guarded() })
  } catch (error) {
    if (error instanceof Refused) return null
    throw error
  }
  cleanTree(doc, r)
  return serialize(doc)
}

/**
 * The email's HTML, cleaned: every text and attribute cleaned like the
 * text; no link targets, comments, scripts, frames, form fields, SVG or
 * MathML, tracking pixels or CSS comments; image addresses without their
 * query (or their stored copy's path). Structure, styles and images stay,
 * so it looks the same. The result must read back as itself (cleaned
 * again, nothing changes). Null when the HTML is too large or too odd to
 * read safely: then no HTML may be shown at all.
 */
export function cleanEmailHtml(
  html: string,
  identity: InboxIdentity,
  options?: CleanOptions
) {
  const r = rulesFor(identity, options)
  let out = cleanOnce(html, r)
  for (let i = 0; out !== null && i < 2; i++) {
    const again = cleanOnce(out, r)
    if (again === out) return out
    out = again
  }
  return null
}

export type EmailParts = {
  subject: string
  text: string
  preview: string | null
  html: string | null
}

/** All four parts cleaned; `changed` when any differs from what was given. */
export function cleanEmail(
  email: EmailParts,
  identity: InboxIdentity,
  options?: CleanOptions
): EmailParts & { changed: boolean } {
  const out: EmailParts = {
    subject: cleanEmailSubject(email.subject, identity, options),
    text: cleanEmailText(email.text, identity, options),
    preview:
      email.preview === null
        ? null
        : cleanEmailPreview(email.preview, identity, options),
    html:
      email.html === null ? null : cleanEmailHtml(email.html, identity, options)
  }
  const changed = (Object.keys(out) as (keyof EmailParts)[]).some(
    (k) => out[k] !== email[k]
  )
  return { ...out, changed }
}
