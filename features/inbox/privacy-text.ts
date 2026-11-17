import { bareAddress, canonical } from './addresses'
import { decode } from './images'

/**
 * REAL-1b1: the rules that find the inbox's people in words (see
 * `privacy.ts`). Every pattern starts only where a run starts (a
 * lookbehind) and never rescans it, so each is linear on long runs.
 */

/** The inbox's own addresses and the names it subscribed with. */
export type InboxIdentity = { addresses: string[]; names: string[] }

/** Treated as unchanging: the rules made from them are kept. */
export type CleanOptions = {
  /** Words never taken for a person's name, e.g. the brand's own name. */
  keep?: string[]
  /**
   * The stored copies (`inbox_message_images`): each picture becomes its
   * path. Any other picture is emptied (only stored copies are shown).
   */
  images?: { ref: string; path: string }[]
}

/** Read on every call, so a test can lower one to prove it holds. */
export const privacyLimits = {
  subject: 200,
  preview: 300,
  text: 10_000,
  /** Text read before cleaning, per limit (cut after a whole word). */
  readFactor: 4,
  html: 4_000_000,
  /** Start and end tags in one email. */
  tags: 200_000,
  /** Attributes merged onto one element (repeated <html> or <body>). */
  tagAttributes: 1_000,
  /** Attributes squared, summed over tags (the tokenizer's own work). */
  attributeWork: 2_000_000,
  /** Elements inside each other (emails nest a few dozen deep). */
  depth: 256,
  /** One deadline for all the rounds of one email's HTML. */
  htmlMs: 8_000,
  /**
   * The inbox's bare local part ("sampleinbox") is removed as a word only
   * from this length on: a shorter one may be an ordinary word. With a
   * +alias, dots or an @ it always goes.
   */
  localLength: 8
}

export const escape = (s: string) => s.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&')
const word = String.raw`[\p{L}\p{N}]`
const localChars = String.raw`\p{L}\p{N}._%+'=-`
const local = String.raw`(?<![${localChars}])[${localChars}]+`
const at = String.raw`[@\u{ff20}\u{fe6b}]`
const host = String.raw`[\p{L}\p{N}-]+`
const domain = String.raw`${host}(?:\.${host})+`

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
/** Any local@domain; with blanks (NBSP, a line break) around @, a dot too. */
export const address = new RegExp(
  String.raw`${local}(?:${at}${host}(?:\.${host})*|\s{1,2}${at}\s{0,2}${domain}|${at}\s{1,2}${domain})`,
  'giu'
)
const bracket = (w: string) =>
  String.raw`[ \t]{0,3}[[({][ \t]{0,3}${w}[ \t]{0,3}[\])}][ \t]{0,3}`
const mailHosts =
  'gmail|googlemail|yahoo|outlook|hotmail|live|icloud|me|aol|proton|protonmail|gmx'
const tlds =
  'com|net|org|io|co|uk|us|ca|au|de|fr|nl|es|it|info|biz|me|email|example|test'
/** name [at] domain [dot] com, name at gmail.com, name at x dot com. */
export const obfuscated = new RegExp(
  String.raw`${local}(?:${bracket('at')}${host}(?:(?:${bracket('dot')}|\.)${host})+|\s+at\s+(?:(?:${mailHosts})\.(?:${tlds})|${host}(?:\s+dot\s+${host}){0,3}\s+dot\s+(?:${tlds}))(?!${word}))`,
  'giu'
)
/** The few escapes an address hides behind (one level a pass). */
const encoded = /%(?:25|40|2b|2e|2d|5f|20)/gi
const unescape = (s: string) => s.replace(encoded, (e) => decodeURIComponent(e))
const greeting = new RegExp(
  String.raw`(?<!${word})(hi|hey|hello|hiya|heya|howdy|dear)(,?[ \t\u{a0}]+)(${word}[\p{L}\p{N}.'’+_-]{0,63}(?:[ \t]\p{L}[\p{L}'’-]{0,39}){0,2})(?=[ \t\u{a0}]*(?:[,!?;:.\n—–-]|\p{Extended_Pictographic}|$))`,
  'giu'
)
export const greetingEnd =
  /(?<![\p{L}\p{N}])(?:hi|hey|hello|hiya|heya|howdy|(dear)),?\s*$/iu

export type Rules = {
  locals: RegExp | null
  local: RegExp | null
  names: RegExp | null
  nameSet: Set<string>
  keep: RegExp | null
  images: Map<string, string>
  stored: Set<string>
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
  const keep = (options.keep ?? []).map((k) => k.replace(/\s+/g, ' ').trim())
  const images = new Map<string, string>()
  for (const { ref, path } of options.images ?? []) {
    images.set(ref.trim(), path)
    images.set(decode(ref).trim(), path)
  }
  return {
    locals: local
      ? new RegExp(
          String.raw`(?<![\p{L}\p{N}_%+-])${local}(?![\p{L}\p{N}_%+-]|\.[\p{L}\p{N}])`,
          'giu'
        )
      : null,
    local: local ? new RegExp(`^${local}$`, 'iu') : null,
    names: anyOf(phrases(nameWords(identity.names))),
    nameSet: nameWords(identity.names),
    keep: anyOf(phrases(new Set(keep.filter(Boolean)))),
    images,
    stored: new Set(images.values())
  }
}

const compiled = new WeakMap<InboxIdentity, WeakMap<CleanOptions, Rules>>()
const noOptions: CleanOptions = {}

/** The rules for an identity, made once per identity and options. */
export function rulesFor(identity: InboxIdentity, options = noOptions): Rules {
  let byOptions = compiled.get(identity)
  if (!byOptions) compiled.set(identity, (byOptions = new WeakMap()))
  let rules = byOptions.get(options)
  if (!rules) byOptions.set(options, (rules = compile(identity, options)))
  return rules
}

/** Zero-width and other format characters (U+00AD, U+200B…, U+FEFF…). */
const isFormat = (c: number) =>
  c === 0xad ||
  (c >= 0x600 && c <= 0x605) ||
  c === 0x61c ||
  c === 0x6dd ||
  c === 0x70f ||
  c === 0x180e ||
  (c >= 0x200b && c <= 0x200f) ||
  (c >= 0x202a && c <= 0x202e) ||
  (c >= 0x2060 && c <= 0x206f) ||
  c === 0xfeff ||
  (c >= 0xfff9 && c <= 0xfffb)
const special =
  /[\u{ad}\u{600}-\u{605}\u{61c}\u{6dd}\u{70f}\u{180e}\u{200b}-\u{200f}\u{202a}-\u{202e}\u{2060}-\u{206f}\u{feff}\u{fff9}-\u{fffb}\u{370}-\u{52f}\u{ff01}-\u{ff5e}]/u
/** Cyrillic and Greek letters that look Latin, and what they look like. */
const lookalikes = new Map(
  [
    ...'\u{410}\u{412}\u{415}\u{41a}\u{41c}\u{41d}\u{41e}\u{420}\u{421}\u{422}\u{425}\u{430}\u{435}\u{43e}\u{440}\u{441}\u{443}\u{445}\u{405}\u{455}\u{406}\u{456}\u{408}\u{458}\u{4bb}\u{501}\u{391}\u{392}\u{395}\u{396}\u{397}\u{399}\u{39a}\u{39c}\u{39d}\u{39f}\u{3a1}\u{3a4}\u{3a5}\u{3a7}\u{3b1}\u{3bf}'
  ].map((c, i) => [c, 'ABEKMHOPCTXaeopcyxSsIiJjhdABEZHIKMNOPTYXao'[i]!])
)

/**
 * What a reader sees: format characters left out, full-width and
 * lookalike letters read as Latin. `at` maps a position back.
 */
function skeleton(s: string) {
  if (!special.test(s)) return { text: s, at: (i: number) => i }
  const index = new Int32Array(s.length + 1)
  let text = ''
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i)
    if (isFormat(code)) continue
    text +=
      code >= 0xff01 && code <= 0xff5e
        ? String.fromCharCode(code - 0xfee0)
        : (lookalikes.get(s[i]!) ?? s[i]!)
    index[n++] = i
  }
  index[n] = s.length
  return { text, at: (k: number) => index[k]! }
}

/** The bare local part counts only when long enough (see `localLength`). */
const ownLocal = (m: string) =>
  /[+.]/.test(m) || m.length >= privacyLimits.localLength

/** Where the patterns match, read as a reader sees the text. */
export function ranges(
  s: string,
  patterns: (RegExp | null)[],
  r: Rules
): [number, number][] {
  const sk = skeleton(s)
  const cuts: [number, number][] = []
  for (const re of patterns)
    for (const m of re ? sk.text.matchAll(re) : [])
      if (m[0] && (re !== r.locals || ownLocal(m[0])))
        cuts.push([sk.at(m.index), sk.at(m.index + m[0].length - 1) + 1])
  return cuts.sort((a, b) => a[0] - b[0])
}

function remove(s: string, patterns: (RegExp | null)[], r: Rules) {
  const cuts = ranges(s, patterns, r)
  if (!cuts.length) return s
  let out = ''
  let from = 0
  for (const [a, b] of cuts) {
    if (a > from) out += s.slice(from, a)
    from = Math.max(from, b)
  }
  return out + s.slice(from)
}

/** Addresses, the inbox's local part and the names, removed (no tidying). */
export const scrub = (s: string, r: Rules) =>
  remove(s, [address, obfuscated, r.locals, r.names], r)

/** Whether a value (a tag or attribute name, a link) names the person. */
export function hit(value: string, r: Rules) {
  let s = value
  for (let i = 0; i < 3 && /%[\da-f]{2}/i.test(s); i++)
    try {
      s = decodeURIComponent(s)
    } catch {
      s = unescape(s)
    }
  return ranges(s, [address, obfuscated, r.locals, r.names], r).length > 0
}

/** One of the inbox's names or its local part (any case, any lookalike). */
export function isName(r: Rules, candidate: string) {
  const name = skeleton(candidate).text.replace(/\s+/g, ' ')
  return r.nameSet.has(name.toLowerCase()) || Boolean(r.local?.test(name))
}

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
  s = remove(s, [address, obfuscated], r)
  // The brand's own name is set aside, so no rule below can touch it.
  const saved: string[] = []
  if (r.keep)
    s = s.replace(r.keep, (m) =>
      saved.length < 6_000
        ? `\u{fff9}${String.fromCharCode(0xe000 + saved.push(m) - 1)}\u{fffb}`
        : m
    )
  s = s.replace(greeting, (m, hi: string, _sep: string, candidate: string) => {
    const name = candidate.replace(/\.+$/, '')
    if (!isName(r, name)) return m
    const word = /^dear$/i.test(hi) ? (hi[0] === 'D' ? 'Hi' : 'hi') : hi
    return `${word} there${candidate.slice(name.length)}`
  })
  s = remove(s, [r.locals, r.names], r)
  if (saved.length)
    s = s.replace(parked, (_, c: string) => saved[c.charCodeAt(0) - 0xe000]!)
  return s === input ? input : tidy(s, edges)
}

/** Cleans until nothing changes (at most three passes). */
export function clean(text: string, r: Rules, edges = false) {
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

/** A subject or preview line: one line, cleaned, cut to its limit. */
const oneLine =
  (limit: 'subject' | 'preview') =>
  (value: string, identity: InboxIdentity, options?: CleanOptions) =>
    cut(
      clean(
        read(value, privacyLimits[limit]).replace(/\s+/g, ' ').trim(),
        rulesFor(identity, options)
      ),
      privacyLimits[limit]
    )

export const cleanEmailSubject = oneLine('subject')
export const cleanEmailPreview = oneLine('preview')
