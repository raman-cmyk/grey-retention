import { parse, type DefaultTreeAdapterTypes as T } from 'parse5'
import { bareAddress, canonical } from './addresses'
import type { InboxConfig } from './config'
import { decode } from './images'

/**
 * REAL-01b1, Raman's decision of 16 November: a workspace may read a real
 * brand's newsletter, but never a person's name or email address from the
 * inbox. These pure functions clean one captured email (subject, text,
 * preview line and HTML) before any workspace may read it. Every rule is
 * linear on hostile input; HTML the parser would be slow on is refused.
 */

/** The inbox's own addresses and the names it subscribed with. */
export type InboxIdentity = { addresses: string[]; names: string[] }

export type CleanOptions = {
  /** Words never taken for a person's name, e.g. the brand's own name. */
  keep?: string[]
  /** Stored copies (`inbox_message_images`): an image's src becomes its path. */
  images?: { ref: string; path: string }[]
}

export const privacyLimits = {
  subject: 200,
  preview: 300,
  text: 10_000,
  html: 4_000_000,
  /** About the parser's work (open tags times their depth). */
  parseWork: 10_000_000,
  tagAttributes: 1_000
}

/** The identity from the inbox configuration (its address, the names). */
export function inboxIdentity(config: InboxConfig): InboxIdentity {
  const base = config.ready ? config.transport.base : null
  return {
    addresses: base ? [`${base.local}@${base.domain}`] : [],
    names: config.subscriberNames ?? []
  }
}

const escape = (s: string) => s.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&')
const word = String.raw`[\p{L}\p{N}]`

// Every pattern starts only where a run starts (a lookbehind) and never
// rescans it, so each stays linear on long runs of letters or @ signs.
const sentTo = new RegExp(
  String.raw`(?<!\p{L})(?:(?:this|the|your)\s+(?:e-?mail|message|newsletter|mail)\s+(?:was\s+|is\s+|has\s+been\s+)?(?:(?:sent|addressed|delivered)\s+to|intended\s+for)|(?:sent|delivered)\s+to:?(?=\s*[^\s@]{1,64}@))(?:[^\n.!?]|[.!?](?=\S)){0,400}[.!?]?`,
  'giu'
)
const url = /\b(?:https?|ftp):\/\/[^\s<>"'()[\]{}]+/giu
const localChars = String.raw`\p{L}\p{N}._%+'=-`
const address = new RegExp(
  String.raw`(?:mailto:)?(?<![${localChars}])[${localChars}]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*`,
  'giu'
)
const bracket = (w: string) =>
  String.raw`[ \t]{0,3}[[({][ \t]{0,3}${w}[ \t]{0,3}[\])}][ \t]{0,3}`
const obfuscated = new RegExp(
  String.raw`(?<![${localChars}])[${localChars}]+${bracket('at')}[\p{L}\p{N}-]+(?:(?:${bracket('dot')}|\.)[\p{L}\p{N}-]+)+`,
  'giu'
)
const greeting = new RegExp(
  String.raw`(?<!${word})(hi|hey|hello|hiya|heya|howdy|dear)(,?[ \t\u00a0]+)(${word}[\p{L}\p{N}.'’+_-]{0,63}(?:[ \t]\p{L}[\p{L}'’-]{0,39}){0,2})(?=[ \t\u00a0]*([,!?;:.\n—–-]|\p{Extended_Pictographic}|$))`,
  'giu'
)
/** Words after "Hi" that are not a person: "Hi there", "Hello Spring!". */
const notNames = new Set(
  (
    'there all everyone everybody friend friends folks team you yall y’all guys gang fam family ' +
    'beautiful gorgeous lovely love babe darling dear bestie sunshine stranger world again new hi hey hello ' +
    'spring summer autumn fall winter weekend holidays holiday season insider insiders member members vip vips ' +
    'valued customer customers shopper shoppers reader readers subscriber subscribers beauty mama ' +
    'monday tuesday wednesday thursday friday saturday sunday january february march april may june july ' +
    'august september october november december'
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

/** Whole names and each of their words, longest first. */
function nameWords(names: string[]) {
  const all = new Set<string>()
  for (const raw of names.slice(0, 20)) {
    const name = raw.replace(/\s+/g, ' ').trim().toLowerCase()
    if (name.length < 2) continue
    all.add(name)
    for (const w of name.split(' ')) if (w.length >= 2) all.add(w)
  }
  return all
}

function rulesFor(identity: InboxIdentity, options: CleanOptions = {}): Rules {
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
  const keepWords = nameWords(options.keep ?? [])
  const phrases = (set: Set<string>) =>
    [...set]
      .sort((a, b) => b.length - a.length)
      .map((n) => escape(n).replace(/ /g, String.raw`\s{1,5}`))
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
    keep: anyOf(
      phrases(
        new Set(
          (options.keep ?? [])
            .map((k) => k.replace(/\s+/g, ' ').trim())
            .filter(Boolean)
        )
      )
    ),
    keepWords,
    images
  }
}

/**
 * A person's name after a greeting: one of the inbox's names or its local
 * part, else capitalized words that are not common greeting words or the
 * brand's own (several words only before a comma: "Dear Sam Rivera,").
 */
function isName(r: Rules, candidate: string, several: boolean) {
  const name = candidate.replace(/\s+/g, ' ')
  if (r.nameSet.has(name.toLowerCase()) || r.local?.test(name)) return true
  const words = name.split(' ')
  return (
    (words.length === 1 || several) &&
    !/[\d.+_]/.test(name) &&
    words.every(
      (w) =>
        /^\p{Lu}/u.test(w) &&
        !notNames.has(w.toLowerCase()) &&
        !r.keepWords.has(w.toLowerCase())
    )
  )
}

/** Tidies what a removal left: spaces, empty brackets, stray commas. */
function tidy(s: string, edges: boolean) {
  const out = s
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\([ \t]*\)|\[[ \t]*\]|<[ \t]*>|\{[ \t]*\}/g, '')
    .replace(/(?<![ \t\u00a0])[ \t\u00a0]+(?=[,.!?;:])/g, '')
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

function pass(input: string, r: Rules, edges: boolean) {
  let s = input
    .replace(/[\ufff9-\ufffb]/g, '')
    .replace(sentTo, '')
    .replace(url, (m) => /[.,!?;:]+$/.exec(m)?.[0] ?? '')
    .replace(address, '')
    .replace(obfuscated, '')
  // The brand's own name is set aside, so no rule below can touch it.
  const saved: string[] = []
  if (r.keep)
    s = s.replace(r.keep, (m) =>
      saved.length < 6_000
        ? `\ufff9${String.fromCharCode(0xe000 + saved.push(m) - 1)}\ufffb`
        : m
    )
  s = s.replace(
    greeting,
    (m, hi: string, _sep: string, candidate: string, after: string) => {
      const name = candidate.replace(/\.+$/, '')
      if (!isName(r, name, after === ',')) return m
      const word = /^dear$/i.test(hi) ? (hi[0] === 'D' ? 'Hi' : 'hi') : hi
      return `${word} there${candidate.slice(name.length)}`
    }
  )
  if (r.locals) s = s.replace(r.locals, (m) => (/[+.]/.test(m) ? '' : m))
  if (r.names) s = s.replace(r.names, '')
  if (saved.length)
    s = s.replace(
      /\ufff9([\ue000-\uf8ff])\ufffb/g,
      (_, c: string) => saved[c.charCodeAt(0) - 0xe000] ?? ''
    )
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

/** At most `max` characters, cut after a whole word (or a whole character). */
function cut(value: string, max: number) {
  if (value.length <= max) return value
  let s = value.slice(0, max)
  if (/[\ud800-\udbff]$/.test(s)) s = s.slice(0, -1)
  const at = Math.max(s.lastIndexOf(' '), s.lastIndexOf('\n'))
  return (at > max / 2 ? s.slice(0, at) : s).trimEnd()
}

/** A subject or preview line: one line, cleaned, cut to `max`. */
const oneLine =
  (max: number) =>
  (value: string, identity: InboxIdentity, options?: CleanOptions) =>
    cut(
      clean(value.replace(/\s+/g, ' ').trim(), rulesFor(identity, options)),
      max
    )

export const cleanEmailText = (
  text: string,
  identity: InboxIdentity,
  options?: CleanOptions
) => cut(clean(text, rulesFor(identity, options)), privacyLimits.text)
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
/** Tags whose end the parser may supply: they never nest deep. */
const uncounted = new Set([
  ...voidTags,
  ...tags(
    'p li dt dd tr td th option optgroup thead tbody tfoot colgroup caption rb rt rp rtc html head body'
  )
])
const rawTags = tags('style xmp plaintext')
const dropTags = tags(
  'script iframe object embed applet frame frameset base link input select textarea keygen datalist noembed noframes portal'
)
const blockTags = tags(
  'address blockquote body br center div h1 h2 h3 h4 h5 h6 hr li ol p section table td th tr ul'
)
const linkAttrs = tags(
  'action formaction ping cite longdesc codebase archive manifest data profile classid dynsrc lowsrc'
)

/**
 * Whether the parser stays fast: it slows down (quadratically) on tags
 * nested thousands deep and on one tag with thousands of attributes.
 */
function parseable(html: string) {
  let depth = 0
  let work = 0
  for (const m of html.matchAll(/<(\/?)([a-z][^\s/<>]{0,30})[^<>]*>/gi)) {
    const tag = m[0]
    if (
      tag.length > 1_000 &&
      tag.replace(/"[^"]*"|'[^']*'/g, '""').split(/\s+/).length >
        privacyLimits.tagAttributes
    )
      return false
    if (uncounted.has(m[2]!.toLowerCase()) || tag.endsWith('/>')) continue
    if (m[1]) depth = Math.max(0, depth - 1)
    else if ((work += ++depth) > privacyLimits.parseWork) return false
  }
  return true
}

/** Open-tracking pixels: 1x1 or 0x0, or on a tracking address. */
function trackingPixel(el: T.Element) {
  const size = (name: string) => {
    const m =
      /^\s*(\d+)(?:px)?\s*$/i.exec(attr(el, name) ?? '') ??
      new RegExp(String.raw`(?:^|[;\s])${name}\s*:\s*(\d+)px`, 'i').exec(
        attr(el, 'style') ?? ''
      )
    return m ? Number(m[1]) : null
  }
  const w = size('width')
  const h = size('height')
  if ((w ?? 1) <= 1 && (h ?? 1) <= 1 && (w !== null || h !== null)) return true
  try {
    const link = new URL(attr(el, 'src') ?? '')
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

/** A stored copy's path, or the address without its query and fragment. */
function imageUrl(value: string, r: Rules) {
  const v = value.trim()
  const stored = r.images.get(v)
  if (stored !== undefined) return stored
  if (/^(?:cid|data):/i.test(v)) return value
  // Only web addresses and the email's own parts are pictures.
  if (/^[a-z][a-z\d+.-]*:/i.test(v) && !/^https?:/i.test(v)) return ''
  const at = v.search(/[?#]/)
  return at < 0 ? value : v.slice(0, at)
}

const cssUrls = (css: string, r: Rules) =>
  css.replace(
    /url\(\s*(['"]?)([^'"()\s]{1,4000})\1\s*\)/gi,
    (m, q: string, u: string) => {
      const next = imageUrl(u, r)
      return next === u ? m : `url(${q}${next}${q})`
    }
  )

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
      else if (tag === 'image') value = imageUrl(value, r)
      else if (!value.trim().startsWith('#')) return []
    } else if (name === 'src' || name === 'background' || name === 'poster')
      value = imageUrl(value, r)
    else if (name === 'srcset')
      value = value
        .split(',')
        .map((part) => {
          const [u = '', ...size] = part.trim().split(/\s+/)
          return [imageUrl(u, r), ...size].join(' ')
        })
        .join(', ')
    else if (name === 'style') value = cssUrls(value, r)
    else value = clean(value, r)
    return [value === a.value ? a : { ...a, value }]
  })
}

const dropped = (el: T.Element) =>
  dropTags.has(el.tagName) ||
  (el.tagName === 'img' && trackingPixel(el)) ||
  (el.tagName === 'meta' && /refresh/i.test(attr(el, 'http-equiv') ?? ''))

const greetingEnd =
  /(?<![\p{L}\p{N}])(?:hi|hey|hello|hiya|heya|howdy|(dear)),?\s*$/iu
const nameOnly = /^(\s*)(\S.{0,79}?)([.,!?;:]*\s*)$/su

/** Walks the tree with a list (never recursion) and cleans it in place. */
function cleanTree(doc: T.Document, r: Rules) {
  const gone = new Set<Node>()
  const parents = new Set<T.ParentNode>()
  const stack: Node[] = [...children(doc)].reverse()
  // The words just before, for "Hi <b>Sam</b>," (the name in its own tag).
  let before: T.TextNode | null = null
  while (stack.length) {
    const n = stack.pop()!
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
        text.value = cssUrls(text.value, r)
        continue
      }
      if (!/[\p{L}\p{N}@]/u.test(text.value)) continue
      let value = text.value
      const greeted = before ? greetingEnd.exec(before.value) : null
      const own = greeted ? nameOnly.exec(value) : null
      if (
        before &&
        greeted &&
        own &&
        isName(r, own[2]!, own[3]!.startsWith(','))
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
    if (blockTags.has(n.tagName)) before = null
    cleanAttrs(n, r)
    // A form keeps its look as a plain box; its fields and target go.
    if (n.tagName === 'form') n.tagName = n.nodeName = 'div'
    const kids = children(
      n.tagName === 'template' ? (n as T.Template).content : n
    )
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!)
  }
  for (const p of parents)
    p.childNodes = p.childNodes.filter((c) => !gone.has(c)) as never
}

const escapeText = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/\u00a0/g, '&nbsp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
const escapeAttr = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/\u00a0/g, '&nbsp;')
    .replace(/"/g, '&quot;')

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
          `<!DOCTYPE ${d.name}${d.publicId ? ` PUBLIC "${d.publicId}"` : d.systemId ? ' SYSTEM' : ''}${d.systemId ? ` "${d.systemId}"` : ''}>`
        )
    } else if (n.nodeName === '#text') {
      const parent = (n as T.TextNode).parentNode
      const raw =
        parent &&
        isElement(parent) &&
        parent.namespaceURI === htmlNs &&
        rawTags.has(parent.tagName)
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
      if (n.namespaceURI === htmlNs && voidTags.has(n.tagName)) continue
      stack.push(`</${n.tagName}>`)
      const kids = children(
        n.tagName === 'template' ? (n as T.Template).content : n
      )
      for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!)
    }
  }
  return out.join('')
}

/**
 * The email's HTML, cleaned: every text and alt/title cleaned like the
 * text; no link targets, comments, scripts, forms' fields or tracking
 * pixels; image addresses without their query (or their stored copy's
 * path). Structure, styles and images stay, so it looks the same. Null when
 * the HTML is too large or nested too deep to read safely: then no HTML may
 * be shown at all.
 */
export function cleanEmailHtml(
  html: string,
  identity: InboxIdentity,
  options?: CleanOptions
) {
  if (html.length > privacyLimits.html || !parseable(html)) return null
  const doc = parse(html, { scriptingEnabled: false })
  cleanTree(doc, rulesFor(identity, options))
  return serialize(doc)
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
