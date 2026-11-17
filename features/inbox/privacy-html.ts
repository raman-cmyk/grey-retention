import {
  defaultTreeAdapter,
  parse,
  type DefaultTreeAdapterMap,
  type DefaultTreeAdapterTypes as T,
  type TreeAdapter
} from 'parse5'
import {
  addressRules,
  clean,
  greetingEnd,
  hit,
  isName,
  ranges,
  rulesFor,
  scrub,
  type CleanOptions,
  type DeadlineCheck,
  type InboxIdentity,
  type Rules
} from './privacy-text'

/**
 * REAL-1b1: an email's HTML without the inbox's people (see `privacy.ts`).
 * Parsed with parse5, walked and written again without recursion. Refused
 * (null) when it is too large or odd to read in time, or when the cleaned
 * HTML does not read back as itself.
 */

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
/** Whole subtrees that go: active content, frames, form fields. */
const dropTags = tags(
  'script noscript iframe object embed applet frame frameset base link input select textarea keygen datalist noembed noframes portal'
)
const blockTags = tags(
  'address article aside blockquote body caption center dd details div dl dt figcaption figure footer form h1 h2 h3 h4 h5 h6 header hr li main nav ol p pre section summary table tbody td tfoot th thead tr ul'
)
const linkAttrs = tags(
  'action formaction ping cite longdesc codebase archive manifest data profile classid dynsrc lowsrc'
)
/** The only tag and attribute names written: plain ones. */
const plainName = /^[a-z][a-z\d-]*$/
/**
 * Tag and attribute names HTML knows: a person's name never removes one
 * (a persona called "Li", "Em" or "Max" breaks no layout).
 */
const knownTags = new Set([
  ...voidTags,
  ...dropTags,
  ...blockTags,
  ...tags(
    'a abbr audio b bdi bdo big blink button canvas code data del dfn em fieldset font head html i ins kbd label legend listing mark marquee meter nobr optgroup option picture plaintext progress q rp rt ruby s samp small span strike strong style sub sup template time title tt u var video xmp'
  )
])
const knownAttrs = tags(
  'abbr align alt background bgcolor border cellpadding cellspacing class color cols colspan content dir face frame headers height hspace id label lang max media min name nowrap role rows rowspan rules scope size span start style summary target title type valign value vspace width'
)

class Refused extends Error {}
/** The one deadline, read at a named check (a test's clock tells them apart). */
const late = (r: Rules, until: number, check: DeadlineCheck) =>
  r.now(check) > until

const space = (c: string | undefined) =>
  c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f'

/**
 * Whether the tokenizer stays fast: it checks each attribute against the
 * tag's others (quadratic), so the attributes squared, summed over the
 * email's tags, are capped. So are its tags, comments and other markup,
 * since each one splits the words into one more piece to clean. Attributes
 * are counted as the tokenizer splits them (blanks, "/", after a quote).
 */
function scannable(html: string, r: Rules, until: number) {
  let count = 0
  let work = 0
  for (let i = html.indexOf('<'); i >= 0; i = html.indexOf('<', i)) {
    let j = i + (html[i + 1] === '/' ? 2 : 1)
    const tag = /[a-z]/i.test(html[j] ?? '')
    if (!tag && !'!?/'.includes(html[i + 1] ?? '')) {
      i = j
      continue
    }
    if (++count > r.limits.tags) return false
    if ((count & 4095) === 1 && late(r, until, 'scan')) throw new Refused()
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
    if ((work += attrs * attrs) > r.limits.attributeWork) return false
    i = j + 1
  }
  return true
}

/**
 * The parser's own tree builder, counting as it builds: nesting deeper than
 * any email, too many attributes merged onto one element (repeated <html>
 * or <body> tags) or the deadline stop it.
 */
function guarded(r: Rules, until: number): TreeAdapter<DefaultTreeAdapterMap> {
  const depth = new WeakMap<object, number>()
  const place = (parent: object, child: object) => {
    const d = (depth.get(parent) ?? 0) + 1
    if (d > r.limits.depth) throw new Refused()
    depth.set(child, d)
  }
  return {
    ...defaultTreeAdapter,
    createElement(tagName, namespace, attrs) {
      if (late(r, until, 'element')) throw new Refused()
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
      if (element.attrs.length + attrs.length > r.limits.tagAttributes)
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
    // A //host link is read as https, like an email app does.
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
 * A picture's address: its stored copy's path, or a small raster data:
 * image. Anything else (a remote or cid: picture without a stored copy,
 * SVG data, another scheme) is emptied: only stored copies are shown.
 */
function imageUrl(value: string, r: Rules) {
  const v = value.trim()
  const stored = r.images.get(v)
  if (stored !== undefined) return stored
  return r.stored.has(v) ||
    /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z\d+/=\s]*$/i.test(v)
    ? value
    : ''
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
    const kept = link ? imageUrl(link, r) : ''
    // A size is a number of pixels or a density, nothing else.
    if (kept && (!size || /^\d+(?:\.\d+)?[wx]$/i.test(size)))
      out.push(size ? `${kept} ${size}` : kept)
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

/** CSS escapes read as what they stand for (\75rl( is url(). */
const unescapeCss = (css: string) =>
  css.replace(
    /\\(?:([\da-f]{1,6})[ \t\n]?|([^\n\da-f]))/gi,
    (_, hex: string | undefined, c: string | undefined) => {
      if (c !== undefined) return c
      const code = parseInt(hex!, 16)
      return code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : '\u{fffd}'
    }
  )

/** How often CSS loads a file (an escape can hide one). */
const loads = (css: string) =>
  (
    css
      .toLowerCase()
      .match(/url\(|@import|image-set\(|image\(|expression\(/g) ?? []
  ).length

/**
 * Every url(...) (brackets and quotes inside included): its stored copy,
 * or none.
 */
function cssLinks(css: string, r: Rules) {
  const lower = css.toLowerCase()
  let out = ''
  let from = 0
  for (let i = lower.indexOf('url('); i >= 0; i = lower.indexOf('url(', from)) {
    let j = i + 3
    for (let depth = 0, q = ''; j < css.length; j++) {
      const c = css[j]
      if (q) q = c === q ? '' : q
      else if (c === '"' || c === "'") q = c
      else if (c === '(') depth++
      else if (c === ')' && --depth === 0) break
    }
    const inner = css
      .slice(i + 4, j)
      .trim()
      .replace(/^(['"])([^]*)\1$/, '$2')
    const kept = imageUrl(inner, r)
    out += css.slice(from, i) + (kept ? `url("${kept}")` : 'none')
    from = Math.min(css.length, j + 1)
  }
  return out + css.slice(from)
}

/**
 * Every CSS string, read to its closing quote: one that runs over lines (a
 * backslash at a line end) or never ends goes, whatever its length; a link in one
 * (@import, image-set) is its stored copy or nothing; any other loses
 * addresses and names (a font named like the person).
 */
function cssStrings(css: string, r: Rules) {
  let out = ''
  for (let i = 0; i < css.length;) {
    const a = css.indexOf('"', i)
    const b = css.indexOf("'", i)
    const start = a < 0 ? b : b < 0 ? a : Math.min(a, b)
    if (start < 0) return out + css.slice(i)
    const q = css[start]!
    let j = start + 1
    for (; j < css.length && css[j] !== q; j++) if (css[j] === '\\') j++
    const value = css.slice(start + 1, j)
    const plain = unescapeCss(value)
    out += css.slice(i, start)
    if (j >= css.length || /\\[\n\r\f]/.test(value)) out += `${q}${q}`
    else if (/^\s*(?:[a-z][a-z\d+.-]*:|\/)|[?#]/i.test(plain))
      out += `${q}${imageUrl(plain, r)}${q}`
    else out += `${q}${scrub(value, r)}${q}`
    i = j + 1
  }
  return out
}

/**
 * CSS (a style attribute or a <style> block). CSS escapes that would hide a
 * way to load a file drop it all; otherwise no comments, no "<" that
 * could start a tag (so a block can never close early), every link its
 * stored copy or none,
 * every string read as above, and addresses and the inbox's local part
 * removed. Names go only from strings: a name may also be a CSS word
 * ("Georgia", "max-width").
 */
function cleanCss(css: string, r: Rules) {
  if (loads(unescapeCss(css)) > loads(css)) return ''
  const plain = dropComments(css).replace(/<(?=[a-z/!?])/gi, '')
  return scrub(cssStrings(cssLinks(plain, r), r), r, false)
}

function cleanAttrs(el: T.Element, r: Rules, named: (s: string) => boolean) {
  const tag = el.tagName
  el.attrs = el.attrs.flatMap((a): T.Element['attrs'] => {
    const name = a.name
    if (
      !plainName.test(name) ||
      named(name) ||
      name.startsWith('on') ||
      linkAttrs.has(name) ||
      (name.startsWith('data-') && name !== 'data-gr-section')
    )
      return []
    let value = a.value
    // Every link target goes: hrefs carry per-subscriber tracking tokens.
    if (name === 'href') {
      if (tag !== 'a' && tag !== 'area') return []
      value = ''
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

const nameOnly = /^(\s*)(\S.{0,79}?)([.,!?;:]*\s*)$/su
const wordish = /[\p{L}\p{N}@%\u{ff20}\u{fe6b}]/u

/**
 * The words of one block (a paragraph, a cell; a <br> counts as a line
 * break). Addresses and names cut in pieces by tags are matched on the
 * joined words first and every piece is removed; then each text is
 * cleaned, a name in its own tag after a greeting too ("Hi <b>Sam</b>,").
 */
function cleanBlock(nodes: (T.TextNode | '\n')[], r: Rules, until: number) {
  const parts = nodes.map((n) => (n === '\n' ? n : n.value))
  if (parts.length > 1) {
    const joined = parts.join('')
    const starts: number[] = []
    let end = 0
    for (const v of parts) starts.push((end += v.length) - v.length)
    /** The piece a position is in. */
    const piece = (at: number) => {
      let lo = 0
      let hi = starts.length - 1
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (starts[mid]! <= at) lo = mid
        else hi = mid - 1
      }
      return lo
    }
    // Only what spans pieces: within one, each text's own cleaning (with
    // its greeting) does it.
    const cuts = ranges(joined, [...addressRules(r), r.names], r).filter(
      ([a, b]) => piece(a) !== piece(b - 1)
    )
    if (cuts.length) {
      // Each match widens to the whole word it touches, so no piece of an
      // address is left beside it. One sweep: no character is read twice.
      const gone = new Uint8Array(joined.length)
      let reach = 0
      for (const cut of cuts) {
        let [a, b] = cut
        while (a > reach && !space(joined[a - 1])) a--
        b = Math.max(b, reach)
        while (b < joined.length && !space(joined[b])) b++
        gone.fill(1, Math.max(a, reach), b)
        reach = b
      }
      let at = 0
      nodes.forEach((n, k) => {
        const v = parts[k]!
        if (n !== '\n' && gone.subarray(at, at + v.length).includes(1)) {
          let kept = ''
          for (let i = 0; i < v.length; i++) if (!gone[at + i]) kept += v[i]
          n.value = kept
        }
        at += v.length
      })
    }
  }
  let before: T.TextNode | null = null
  for (let k = 0; k < nodes.length; k++) {
    if ((k & 1023) === 0 && late(r, until, 'block')) throw new Refused()
    const n = nodes[k]!
    if (n === '\n') {
      before = null
      continue
    }
    if (!wordish.test(n.value)) continue
    let value = n.value
    // Only the end of the words before can be a greeting.
    const greeted = before ? greetingEnd.exec(before.value.slice(-40)) : null
    const own = greeted ? nameOnly.exec(value) : null
    if (before && greeted && own && isName(r, own[2]!)) {
      value = `${own[1]}there${own[3]}`
      if (greeted[1])
        before.value = before.value.replace(
          /dear(,?\s*)$/i,
          (m, rest) => `${m[0] === 'D' ? 'Hi' : 'hi'}${rest}`
        )
    }
    n.value = clean(value, r, true)
    if (n.value.trim()) before = n
  }
}

/** Walks the tree with a list (never recursion) and cleans it in place. */
function cleanTree(doc: T.Document, r: Rules, until: number) {
  const gone = new Set<Node>()
  const unwrapped = new Set<Node>()
  const parents = new Set<T.ParentNode>()
  const stack: (Node | 'end')[] = [...children(doc)].reverse()
  // A tag or attribute name naming the person: an address or the inbox's
  // local part always, a name only when HTML does not know it.
  const seen = new Map<string, boolean>()
  const naming = (known: Set<string>) => (s: string) => {
    const key = `${known === knownTags ? 't' : 'a'}${s}`
    let found = seen.get(key)
    if (found === undefined)
      seen.set(key, (found = hit(s, r, false) || (!known.has(s) && hit(s, r))))
    return found
  }
  const named = naming(knownTags)
  const namedAttr = naming(knownAttrs)
  let block: (T.TextNode | '\n')[] = []
  const endBlock = () => {
    cleanBlock(block, r, until)
    block = []
  }
  for (let steps = 0; stack.length; steps++) {
    if ((steps & 1023) === 0 && late(r, until, 'walk')) throw new Refused()
    const n = stack.pop()!
    if (n === 'end') {
      endBlock()
      continue
    }
    if (n.nodeName === '#text') {
      const parent = (n as T.TextNode).parentNode
      if (parent && isElement(parent) && parent.tagName === 'style')
        (n as T.TextNode).value = cleanCss((n as T.TextNode).value, r)
      else block.push(n as T.TextNode)
      continue
    }
    // Comments are never written (see `serialize`).
    if (!isElement(n)) continue
    const parent = n.parentNode
    if (dropped(n)) {
      gone.add(n)
      if (parent) parents.add(parent)
      continue
    }
    // A tag named like the person, or not a plain name ("<sam@x.com>"),
    // goes; what is inside it stays.
    if (!plainName.test(n.tagName) || named(n.tagName)) {
      unwrapped.add(n)
      if (parent) parents.add(parent)
    }
    if (n.tagName === 'br') block.push('\n')
    // A box set to display inline is part of its line (its words join).
    const isBlock =
      blockTags.has(n.tagName) &&
      !/(?:^|;)\s*display\s*:\s*inline/i.test(attr(n, 'style') ?? '')
    if (isBlock) endBlock()
    cleanAttrs(n, r, namedAttr)
    // A form keeps its look as a plain box, raw-text blocks become <pre>
    // (written escaped, so their words can never turn into tags).
    if (n.tagName === 'form') n.tagName = n.nodeName = 'div'
    if (['xmp', 'plaintext', 'listing'].includes(n.tagName))
      n.tagName = n.nodeName = 'pre'
    if (isBlock) stack.push('end')
    const kids = children(
      n.tagName === 'template' ? (n as T.Template).content : n
    )
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!)
  }
  endBlock()
  // Innermost first, so an unwrapped tag's own children are settled.
  for (const p of [...parents].reverse())
    p.childNodes = p.childNodes.flatMap((c) => {
      if (gone.has(c)) return []
      if (!unwrapped.has(c)) return [c]
      const kids = children(c)
      for (const k of kids) k.parentNode = p as T.ParentNode as never
      return kids
    }) as never
}

const escapeText = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/\u{a0}/gu, '&nbsp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
const escapeAttr = (s: string) => escapeText(s).replace(/"/g, '&quot;')

/**
 * Our own doctype for the email's layout mode, never the email's text: a
 * quirks-mode email gets none, which keeps it in quirks mode.
 */
const doctypes: Record<T.Document['mode'], string> = {
  'no-quirks': '<!DOCTYPE html>',
  'limited-quirks':
    '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">',
  quirks: ''
}

/** The HTML again, without recursion; comments are never written. */
function serialize(doc: T.Document, r: Rules, until: number) {
  const out: string[] = []
  const stack: (Node | string)[] = [...children(doc)].reverse()
  for (let steps = 0; stack.length; steps++) {
    if ((steps & 4095) === 0 && late(r, until, 'writer')) throw new Refused()
    const n = stack.pop()!
    if (typeof n === 'string') out.push(n)
    else if (n.nodeName === '#documentType') out.push(doctypes[doc.mode])
    else if (n.nodeName === '#text') {
      const parent = (n as T.TextNode).parentNode
      const value = (n as T.TextNode).value
      const raw = parent && isElement(parent) && parent.tagName === 'style'
      out.push(raw ? value : escapeText(value))
    } else if (isElement(n)) {
      out.push(
        `<${n.tagName}${n.attrs.map((a) => ` ${a.name}="${escapeAttr(a.value)}"`).join('')}>`
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

/**
 * One round. The size limit holds for the email itself (`first`): escaping
 * may make the cleaned HTML longer, and that is read again as it is.
 */
function cleanOnce(html: string, r: Rules, until: number, first: boolean) {
  if ((first && html.length > r.limits.html) || !scannable(html, r, until))
    return null
  const doc = parse(html, {
    scriptingEnabled: false,
    treeAdapter: guarded(r, until)
  })
  cleanTree(doc, r, until)
  return serialize(doc, r, until)
}

/**
 * The cleaned HTML must read back as itself: cleaned again, nothing may
 * change (two more rounds at most). Null otherwise.
 */
export function settle(
  first: string | null,
  again: (html: string) => string | null
) {
  let out = first
  for (let i = 0; out !== null && i < 2; i++) {
    const next = again(out)
    if (next === out) return out
    out = next
  }
  return null
}

/**
 * The email's HTML, cleaned: every text and attribute cleaned like the
 * text; no link targets, comments, scripts, frames, form fields, SVG or
 * MathML, tracking pixels or CSS comments; pictures only as their stored
 * copies. Structure and styles stay. Null when the HTML is refused: then
 * no HTML (and no picture made from it) may be shown at all.
 */
export function cleanEmailHtml(
  html: string,
  identity: InboxIdentity,
  options?: CleanOptions
) {
  const r = rulesFor(identity, options)
  // One deadline for every round of this email.
  const until = r.now('start') + r.limits.htmlMs
  try {
    return settle(cleanOnce(html, r, until, true), (out) =>
      cleanOnce(out, r, until, false)
    )
  } catch (error) {
    if (error instanceof Refused) return null
    throw error
  }
}
