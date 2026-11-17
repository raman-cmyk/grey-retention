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
  /**
   * Lower limits for this call (how a test proves each guard). A limit is
   * never raised: a value above the default, or not a number, is ignored.
   */
  limits?: Partial<PrivacyLimits>
  /**
   * The clock the HTML deadline is read from, by check (`Date.now`). It
   * can only bring the deadline closer: real time still ends the work.
   */
  clock?: (check: DeadlineCheck) => number
}

/** The limits; a call may lower them (`CleanOptions.limits`). */
export const privacyLimits = Object.freeze({
  subject: 200,
  preview: 300,
  text: 10_000,
  /** Text read before cleaning, per limit (cut after a whole word). */
  readFactor: 4,
  /**
   * HTML characters read. Gmail clips an email at 102 KB, so a newsletter
   * is far below 1 MB; above it, it is refused, which keeps every guard
   * below cheap. Escaping may make the cleaned HTML longer: later rounds
   * are not held to it.
   */
  html: 1_000_000,
  /** Tags, comments and other markup: each splits the words in pieces. */
  tags: 50_000,
  /** Attributes merged onto one element (repeated <html> or <body>). */
  tagAttributes: 1_000,
  /** Attributes squared, summed over tags (the tokenizer's own work). */
  attributeWork: 2_000_000,
  /** Elements inside each other (emails nest a few dozen deep). */
  depth: 256,
  /** One deadline for all the rounds of one email's HTML. */
  htmlMs: 3_000,
  /**
   * The inbox's bare local part ("sampleinbox") is removed as a word only
   * from this length on: a shorter one may be an ordinary word. With a
   * +alias, dots or an @ it always goes.
   */
  localLength: 8
})
export type PrivacyLimits = {
  -readonly [K in keyof typeof privacyLimits]: number
}
/** Where the HTML deadline is read (a test's clock tells them apart). */
export type DeadlineCheck =
  'start' | 'scan' | 'element' | 'walk' | 'block' | 'css' | 'strings' | 'writer'

export const escape = (s: string) => s.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&')
const word = String.raw`[\p{L}\p{N}]`
const localChars = String.raw`\p{L}\p{N}._%+'=!#$&*/?^\x60{|}~-`
const local = String.raw`(?<![${localChars}])[${localChars}]+`
const at = String.raw`[@\u{fe6b}]`
const host = String.raw`[\p{L}\p{N}-]+`
const domain = String.raw`${host}(?:\.${host})+`

const sentTo = new RegExp(
  String.raw`(?<!\p{L})(?:(?:this|the|your)\s+(?:e-?mail|message|newsletter|mail)\s+(?:was\s+|is\s+|has\s+been\s+)?(?:(?:sent|addressed|delivered)\s+to|intended\s+for)|(?:sent|delivered)\s+to:?)(?=\s*[^\s@]{1,64}${at})(?:[^\n.!?]|[.!?](?=\S)){0,400}[.!?]?`,
  'giu'
)
const urlChar = String.raw`[^\s<>"'[\]{}]`
/** Links with a scheme, starting with //, or a host and a path; mailto. */
const url = new RegExp(
  String.raw`(?:\b(?:https?|ftp):|(?<![\p{L}\p{N}:/]))\/\/${urlChar}+(?:\n(?=\S*[=&%/?#])${urlChar}+)*|(?<![\p{L}\p{N}@._%+-])(?:[a-z\d-]+\.)+[a-z]{2,}(?=[/?#])${urlChar}+|\bmailto:\S*`,
  'giu'
)
/**
 * Any local@domain (a quoted local part, a [bracketed] IP domain too); with
 * blanks (NBSP, a line break) around @, a dot as well.
 */
export const address = new RegExp(
  String.raw`(?:${local}|"[^"\n]{1,64}")(?:${at}(?:${domain}|\[[\d.:a-f]{2,45}\])|\s{1,2}${at}\s{0,2}${domain}|${at}\s{1,2}${domain})`,
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
  String.raw`${local}(?:${bracket('(?:at|@)')}${host}(?:(?:${bracket('dot')}|\.)${host})+|\s+at\s+(?:(?:${mailHosts})\.(?:${tlds})|${host}(?:\s+dot\s+${host}){0,3}\s+dot\s+(?:${tlds}))(?!${word}))`,
  'giu'
)
const greeting = new RegExp(
  String.raw`(?<!${word})(hi|hey|hello|hiya|heya|howdy|dear)(,?[ \t\u{a0}]+)(${word}[\p{L}\p{N}.'’+_-]{0,63}(?:[ \t]\p{L}[\p{L}'’-]{0,39}){0,2})(?=[ \t\u{a0}]*(?:[,!?;:.\n—–-]|\p{Extended_Pictographic}|$))`,
  'giu'
)
export const greetingEnd =
  /(?<![\p{L}\p{N}])(?:hi|hey|hello|hiya|heya|howdy|(dear)),?\s*$/iu

export type Rules = {
  locals: RegExp | null
  /** The bare local part at any length (for picture addresses). */
  localsAnyLength: RegExp | null
  local: RegExp | null
  names: RegExp | null
  nameSet: Set<string>
  keep: RegExp | null
  /** The inbox's own address, however its local part and domain are spaced. */
  own: RegExp | null
  images: Map<string, string>
  stored: Set<string>
  limits: PrivacyLimits
  now: (check: DeadlineCheck) => number
}

/** Scripts written without spaces between words. */
const spaceless =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u

/** Whole words; a name in a script without spaces anywhere it stands. */
function anyOf(words: string[]) {
  const pattern = (set: string[]) =>
    set
      .sort((a, b) => b.length - a.length)
      .map((n) => escape(n).replace(/ /g, String.raw`\s{1,5}`))
      .join('|')
  const spaced = words.filter((w) => !spaceless.test(w))
  const plain = words.filter((w) => spaceless.test(w))
  const alternatives = [
    ...(spaced.length
      ? [String.raw`(?<!${word})(?:${pattern(spaced)})(?:['’]s)?(?!${word})`]
      : []),
    ...(plain.length ? [pattern(plain)] : [])
  ]
  return alternatives.length ? new RegExp(alternatives.join('|'), 'giu') : null
}

/** Whole names and each of their words. */
function nameWords(names: string[]) {
  const all = new Set<string>()
  for (const raw of names.slice(0, 20)) {
    const name = skeleton(
      raw.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase()
    ).text
    if (name.length < 2) continue
    all.add(name)
    for (const w of name.split(' ')) if (w.length >= 2) all.add(w)
  }
  return all
}

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
    ? String.raw`(?:${locals.join('|')})(?:\+[\p{L}\p{N}._-]+)?`
    : null
  // "capture at inbox.example", "samriv [at] example": its own domain (or
  // the domain's first word) after any at sign, so a short one goes too.
  const blank = String.raw`\s{0,3}`
  const atSign = String.raw`(?:${blank}${at}${blank}|${blank}[[({]${blank}(?:at|@)${blank}[\])}]${blank}|\s{1,3}at\s{1,3})`
  const dot = String.raw`(?:${blank}(?:\.|[[({]${blank}dot${blank}[\])}])${blank}|\s{1,3}dot\s{1,3})`
  const owns = identity.addresses.flatMap((a) => {
    const found = bareAddress(a)
    if (!found) return []
    const at = found.lastIndexOf('@')
    const own = canonical(
      found.slice(0, at).split('+')[0]!,
      found.slice(at + 1)
    )
    const chars = [...own.local].map(escape)
    const name = chars.join(own.domain === 'gmail.com' ? String.raw`\.?` : '')
    const [first, ...rest] = own.domain.split('.').map(escape)
    return own.local && first
      ? [
          String.raw`${name}(?:\+[\p{L}\p{N}._-]+)?${atSign}${first}(?:${dot}${rest.join(dot)})?`
        ]
      : []
  })
  const nameSet = nameWords(identity.names)
  const localWord = local ? new RegExp(`^${local}$`, 'iu') : null
  // The brand's words are kept, but never one that is a name or the
  // inbox's local part: keep cannot switch those rules off.
  const keep = (options.keep ?? [])
    .map((k) => k.replace(/\s+/g, ' ').trim())
    .filter(
      (k) =>
        k && !nameSet.has(skeleton(k.toLowerCase()).text) && !localWord?.test(k)
    )
  const images = new Map<string, string>()
  const rules: Rules = {
    locals: local
      ? new RegExp(String.raw`(?<![\p{L}\p{N}])${local}(?![\p{L}\p{N}])`, 'giu')
      : null,
    localsAnyLength: local
      ? new RegExp(String.raw`(?<![\p{L}\p{N}])${local}(?![\p{L}\p{N}])`, 'giu')
      : null,
    local: localWord,
    names: anyOf([...nameSet]),
    nameSet,
    keep: anyOf(keep),
    own: owns.length
      ? new RegExp(
          String.raw`(?<![\p{L}\p{N}])(?:${owns.join('|')})(?![\p{L}\p{N}])`,
          'giu'
        )
      : null,
    images,
    stored: new Set(images.values()),
    limits: lower(privacyLimits, options.limits),
    now: options.clock ?? (() => Date.now())
  }
  // A personalised picture (its address names the person) is not shown,
  // not even its stored copy: such services draw the name into it.
  for (const { ref, path } of options.images ?? [])
    if (!pictureNames(ref, rules))
      for (const key of [ref.trim(), decode(ref).trim()]) images.set(key, path)
  rules.stored = new Set(images.values())
  return rules
}

/** The defaults, each lowered (never raised) by a finite given value. */
function lower<L extends Record<string, number>>(
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

/** Characters a reader never sees: format and default-ignorable ones. */
const unseen = /^[\p{Cf}\p{Default_Ignorable_Code_Point}]$/u
/** Text the skeleton changes: anything but plain ASCII, or "&" and "%". */
const special = /[^\x00-\x7f]|[&%]/
/** HTML character references in a text part ("samriv&#64;example.com"). */
const entity =
  /&(?:#(\d{1,7});?|#x([\da-f]{1,6});?|(commat|nbsp|amp|period|plus|lowbar|hyphen|dash|apos);)/iy
/** A run of percent escapes ("%D0%90", "%2540"). */
const percents = /(?:%(?:25)*[\da-f]{2})+/iy
const named: Record<string, string> = {
  commat: '@',
  nbsp: '\u{a0}',
  amp: '&',
  period: '.',
  plus: '+',
  lowbar: '_',
  hyphen: '-',
  dash: '-',
  apos: "'"
}
/**
 * Cyrillic and Greek letters that look Latin, capital and small alike, so
 * a name and the text fold the same way whatever their case; curly
 * apostrophes as straight ones.
 */
const lookalikes = new Map<string, string>([
  ...[
    // Cyrillic: A B E K M H O P C T X Y S I J (and h, d).
    '\u{410}\u{430}a \u{412}\u{432}b \u{415}\u{435}e \u{41a}\u{43a}k \u{41c}\u{43c}m \u{41d}\u{43d}h \u{41e}\u{43e}o \u{420}\u{440}p \u{421}\u{441}c \u{422}\u{442}t \u{425}\u{445}x \u{423}\u{443}y \u{405}\u{455}s \u{406}\u{456}i \u{408}\u{458}j \u{4ba}\u{4bb}h \u{500}\u{501}d',
    // Greek: A B E Z H I K M N O P T Y X.
    '\u{391}\u{3b1}a \u{392}\u{3b2}b \u{395}\u{3b5}e \u{396}\u{3b6}z \u{397}\u{3b7}h \u{399}\u{3b9}i \u{39a}\u{3ba}k \u{39c}\u{3bc}m \u{39d}\u{3bd}n \u{39f}\u{3bf}o \u{3a1}\u{3c1}p \u{3a4}\u{3c4}t \u{3a5}\u{3c5}y \u{3a7}\u{3c7}x'
  ]
    .join(' ')
    .split(' ')
    .flatMap(([big, small, latin]): [string, string][] => [
      [big!, latin!.toUpperCase()],
      [small!, latin!]
    ]),
  ['\u{2018}', "'"],
  ['\u{2019}', "'"]
])

/** A run of percent escapes, read as UTF-8, also when applied twice or more. */
function percentRun(run: string) {
  let out = run
  for (let i = 0; i < 4 && /%[\da-f]{2}/i.test(out); i++) {
    const once = out.replace(/%(?:25)+(?=[\da-f]{2})/gi, '%')
    try {
      out = decodeURIComponent(once)
    } catch {
      out = once.replace(/%([0-7][\da-f])/gi, (_, h: string) =>
        String.fromCharCode(parseInt(h, 16))
      )
    }
  }
  return out
}

const folds = new Map<string, string>()
/**
 * One character as a reader matches it: compatibility forms as plain ones
 * (NFKC), accents dropped, small letters (ß as ss, a final sigma as a
 * sigma), lookalike letters as Latin, invisible ones left out.
 */
function fold(ch: string) {
  let f = folds.get(ch)
  if (f !== undefined) return f
  f = ''
  for (const c of ch.normalize('NFKC').normalize('NFD').toLowerCase())
    if (!/\p{M}/u.test(c) && !unseen.test(c))
      f +=
        c === '\u{df}'
          ? 'ss'
          : c === '\u{3c2}'
            ? '\u{3c3}'
            : (lookalikes.get(c) ?? c)
  if (folds.size > 50_000) folds.clear()
  folds.set(ch, f)
  return f
}

/**
 * What a reader sees, for matching only (the text written is never this):
 * each character folded (see `fold`), character references and percent
 * escapes read. `at` and `end` map a position back to the characters it
 * came from.
 */
function skeleton(s: string) {
  if (!special.test(s))
    return { text: s, at: (i: number) => i, end: (i: number) => i + 1 }
  const starts: number[] = []
  const ends: number[] = []
  let text = ''
  for (let i = 0; i < s.length;) {
    entity.lastIndex = i
    percents.lastIndex = i
    const ref = s[i] === '&' ? entity.exec(s) : null
    const run = s[i] === '%' ? percents.exec(s) : null
    let read: string
    let next: number
    if (ref) {
      const code = ref[1]
        ? Number(ref[1])
        : ref[2]
          ? parseInt(ref[2], 16)
          : named[ref[3]!.toLowerCase()]!.codePointAt(0)!
      read = code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
      next = i + ref[0].length
    } else if (run) {
      read = percentRun(run[0])
      next = i + run[0].length
    } else {
      read = String.fromCodePoint(s.codePointAt(i)!)
      next = i + read.length
    }
    for (const ch of read) {
      const folded = fold(ch)
      text += folded
      for (let k = 0; k < folded.length; k++) {
        starts.push(i)
        ends.push(next)
      }
    }
    i = next
  }
  return {
    text,
    at: (k: number) => starts[k] ?? s.length,
    end: (k: number) => ends[k] ?? s.length
  }
}

/** The bare local part counts only when long enough (see `localLength`). */
const ownLocal = (m: string, r: Rules) =>
  /[+.]/.test(m) || m.length >= r.limits.localLength

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
      if (m[0] && (re !== r.locals || ownLocal(m[0], r)))
        cuts.push([sk.at(m.index), sk.end(m.index + m[0].length - 1)])
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

/** The patterns for addresses (and the inbox's local part), and names. */
export const addressRules = (r: Rules) => [address, obfuscated, r.own, r.locals]

/**
 * Addresses and the inbox's local part removed, names too unless
 * `names` is false (no tidying).
 */
export const scrub = (s: string, r: Rules, names = true) =>
  remove(s, [...addressRules(r), names ? r.names : null], r)

/**
 * Whether a value (a link, a tag or attribute name) holds an address or
 * the inbox's local part, or with `names` a name; escapes read.
 */
export const hit = (value: string, r: Rules, names = true) =>
  ranges(value, [...addressRules(r), names ? r.names : null], r).length > 0

/**
 * Whether a picture's address names the person, so not even its stored
 * copy is shown (services draw the name into it). Stricter than for
 * words, as a false alarm costs one picture: the inbox's local part at
 * any length, and long base64-looking parts read as text too.
 */
export function pictureNames(ref: string, r: Rules): boolean {
  const all = [...addressRules(r), r.localsAnyLength, r.names]
  if (ranges(ref, all, r).length) return true
  for (const [token] of ref.matchAll(/[a-z\d+_-]{12,}={0,2}/gi)) {
    let text = ''
    try {
      text = atob(token.replace(/-/g, '+').replace(/_/g, '/'))
    } catch {
      continue
    }
    if (/^[\x20-\x7e]+$/.test(text) && ranges(text, all, r).length) return true
  }
  return false
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
  let s = input
    .normalize('NFC')
    .replace(anchors, '')
    .replace(sentTo, '')
    .replace(url, linkTail)
  s = remove(s, [address, obfuscated, r.own], r)
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

/**
 * Cleans until nothing changes, in at most three passes; text that still
 * changes then is refused (nothing is kept of it), as HTML is.
 */
export function clean(text: string, r: Rules, edges = false) {
  let out = text
  for (let i = 0; i < 3; i++) {
    const next = pass(out, r, edges)
    if (next === out) return out
    out = next
  }
  return pass(out, r, edges) === out ? out : ''
}

/** At most `max` characters, cut after a whole word (or a whole character). */
function cut(value: string, max: number) {
  if (value.length <= max) return value
  let s = value.slice(0, max)
  if (/[\u{d800}-\u{dbff}]$/u.test(s)) s = s.slice(0, -1)
  const at = Math.max(s.lastIndexOf(' '), s.lastIndexOf('\n'))
  return (at > max / 2 ? s.slice(0, at) : s).trimEnd()
}

/**
 * The part read: cut at a blank, so no piece of a word (of an address)
 * is left at its end; one long word is not read at all.
 */
function read(value: string, max: number, r: Rules) {
  const limit = Math.max(0, Math.floor(max * r.limits.readFactor))
  if (value.length <= limit) return value
  const s = value.slice(0, limit)
  if (/\s/.test(value[limit]!)) return s
  return s.slice(0, Math.max(s.lastIndexOf(' '), s.lastIndexOf('\n'), 0))
}

export function cleanEmailText(
  text: string,
  identity: InboxIdentity,
  options?: CleanOptions
) {
  const r = rulesFor(identity, options)
  return cut(clean(read(text, r.limits.text, r), r), r.limits.text)
}

/** A subject or preview line: one line, cleaned, cut to its limit. */
const oneLine =
  (limit: 'subject' | 'preview') =>
  (value: string, identity: InboxIdentity, options?: CleanOptions) => {
    const r = rulesFor(identity, options)
    const max = r.limits[limit]
    return cut(clean(read(value, max, r).replace(/\s+/g, ' ').trim(), r), max)
  }

export const cleanEmailSubject = oneLine('subject')
export const cleanEmailPreview = oneLine('preview')
