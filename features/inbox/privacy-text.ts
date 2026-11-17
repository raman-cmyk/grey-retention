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
  | 'start'
  | 'scan'
  | 'element'
  | 'walk'
  | 'block'
  | 'css'
  | 'strings'
  | 'fold'
  | 'pass'
  | 'writer'
/** Reads the deadline at a check: throws once it has passed. */
export type Check = (at: DeadlineCheck) => void

export const escape = (s: string) => s.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&')
/** Letters and digits; an accent (a mark of its own, see `fold`) too. */
const word = String.raw`[\p{L}\p{M}\p{N}]`
const localChars = String.raw`\p{L}\p{M}\p{N}._%+'=!#$&*/?^\x60{|}~-`
const local = String.raw`(?<![${localChars}])[${localChars}]+`
const at = String.raw`[@\u{fe6b}]`
const host = String.raw`[\p{L}\p{M}\p{N}-]+`
/** A host's last label has a letter: "1.99" is a price, not a host. */
const top = String.raw`(?=[\p{M}\p{N}-]*\p{L})${host}`
const domain = String.raw`${host}(?:\.${host})*\.${top}`

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
  String.raw`${local}(?:${bracket('(?:at|@)')}${host}(?:(?:${bracket('dot')}|\.)${host})+|\s+at\s+(?:(?:${mailHosts})\.(?:${tlds})|${top}(?:\s+dot\s+${host}){0,3}\s+dot\s+(?:${tlds}))(?!${word}))`,
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
  /** The names in words: exactly in any case, or written like a name. */
  names: RegExp[]
  /** The names in any case, an accent or ß they have missing or not. */
  anyName: RegExp | null
  /** A name inside a longer word (pictures only). */
  inside: RegExp | null
  /** One name or word of one, nothing else (`isName`). */
  whole: RegExp | null
  /** The inbox's own address, however its local part and domain are spaced. */
  own: RegExp | null
  images: Map<string, string>
  stored: Set<string>
  limits: PrivacyLimits
  now: (check: DeadlineCheck) => number
  /** The HTML deadline, read while long text is matched (none for text). */
  check: Check
}

/** Scripts written without spaces between words. */
const spaceless =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u

/**
 * How a name is read, one way only: `exact` with every accent it has (as
 * marks, see `fold`); `loose` with any of its accents, or ß as ss, missing
 * (José as Jose, Strauß as STRAUSS) but never one it lacks added (Noel is
 * not Noël, Weiss not Weiß); `capitals` loose, starting with a capital
 * (written like a name: "Angel", not the word "angel"). Any case, read
 * without /i, which would take the letter ι for a mark.
 */
type Reading = 'exact' | 'loose' | 'capitals'

/** One letter of a name in either case, or only as a capital. */
function cased(c: string, capital: boolean, how: Reading) {
  if (c === '\u{df}')
    return how === 'exact'
      ? capital
        ? '\u{1e9e}'
        : '[\u{df}\u{1e9e}]'
      : capital
        ? '(?:\u{1e9e}|SS)'
        : '(?:[\u{df}\u{1e9e}]|[sS]{2})'
  const up = c.toUpperCase()
  const big = [...up].length === 1 ? up : c
  if (capital) return escape(big)
  const forms = [...new Set([c, big, ...(c === '\u{3c3}' ? ['\u{3c2}'] : [])])]
  return forms.length > 1 ? `[${forms.map(escape).join('')}]` : escape(c)
}

/** A name (folded, small letters) as a pattern, read as `how` says. */
function fragment(name: string, how: Reading) {
  const chars = [...name]
  let out = ''
  for (let i = 0; i < chars.length;) {
    const first = i === 0
    const c = chars[i++]!
    if (c === ' ') {
      out += String.raw`\s{1,5}`
      continue
    }
    const marks: string[] = []
    while (/\p{M}/u.test(chars[i] ?? '')) marks.push(chars[i++]!)
    out += cased(c, first && how === 'capitals', how)
    if (marks.length)
      out +=
        how === 'exact'
          ? marks.map(escape).join('')
          : `(?:${marks.map(escape).join('|')}){0,${marks.length}}`
    // No accent the name does not have.
    out += String.raw`(?!\p{M})`
  }
  return out
}

/** Katakana, the script of names from other languages ("サム"). */
const kana = String.raw`[\p{Script=Katakana}\u{30fc}]`

/**
 * Whole words; a name in a script without spaces anywhere it stands, but a
 * katakana name never inside a longer katakana word ("サムスン").
 */
function anyOf(words: string[], how: Reading) {
  const pattern = (set: string[]) =>
    [...set]
      .sort((a, b) => b.length - a.length)
      .map((w) => fragment(w, how))
      .join('|')
  const spaced = words.filter((w) => !spaceless.test(w))
  const plain = words.filter((w) => spaceless.test(w))
  const alternatives = [
    ...(spaced.length
      ? [
          String.raw`(?<!${word})(?:${pattern(spaced)})(?:['’][sS]|\d+)?(?!${word})`
        ]
      : []),
    ...plain
      .sort((a, b) => b.length - a.length)
      .map(
        (w) =>
          (/^\p{Script=Katakana}/u.test(w) ? `(?<!${kana})` : '') +
          fragment(w, how) +
          (/\p{Script=Katakana}\p{M}*$/u.test(w) ? `(?!${kana})` : '')
      )
  ]
  return alternatives.length ? new RegExp(alternatives.join('|'), 'gu') : null
}

/**
 * The person's own name with its words joined (a merge field without a
 * blank): at a capital ("SamRivera") or digits ("Sam2Rivera").
 */
function joinedNames(words: string[]) {
  return words
    .filter((w) => w.includes(' ') && !spaceless.test(w))
    .map((w) => {
      const [first, ...rest] = w.split(' ')
      return (
        fragment(first!, 'loose') +
        rest
          .map(
            (n) => `(?:\\d+${fragment(n, 'loose')}|${fragment(n, 'capitals')})`
          )
          .join('')
      )
    })
}

/**
 * Joined names as words (digits may follow), and a name word in a
 * hashtag at a capital ("#TeamSam"; "#TeamSamsung" stays).
 */
function joinedOf(words: string[]) {
  const joined = joinedNames(words)
  const single = words.filter((w) => !w.includes(' ') && !spaceless.test(w))
  const alternatives = [
    ...(joined.length
      ? [String.raw`(?<!${word})(?:${joined.join('|')})\d*(?!${word})`]
      : []),
    ...(single.length
      ? [
          String.raw`#[\p{L}\p{M}\p{N}_]*?(?<=[\p{Ll}\p{N}_])(?:${single.map((w) => fragment(w, 'capitals')).join('|')})(?![\p{Ll}\p{M}])`
        ]
      : [])
  ]
  return alternatives.length ? new RegExp(alternatives.join('|'), 'gu') : null
}

/**
 * For pictures only (a wrong guess costs one picture): a name word of
 * three letters or more, or a whole name without its blanks, anywhere,
 * also inside a longer word ("?code=SAM20", "?n=samrivera").
 */
function insideOf(words: string[]) {
  const parts = [
    ...new Set(
      words
        .map((w) => w.replace(/ /g, ''))
        .filter((w) => [...w.replace(/\p{M}/gu, '')].length >= 3)
    )
  ].sort((a, b) => b.length - a.length)
  return parts.length
    ? new RegExp(parts.map((w) => fragment(w, 'loose')).join('|'), 'gu')
    : null
}

/** Text as names are compared: one blank, small letters, σ for ς. */
const canon = (s: string) =>
  s
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\u{3c2}/gu, '\u{3c3}')

/** Whole names and each of their words, folded (see `fold`). */
function nameWords(names: string[]) {
  const all = new Set<string>()
  for (const raw of names.slice(0, 20)) {
    const name = canon(skeleton(raw.normalize('NFC')).text)
    if (name.length < 2) continue
    all.add(name)
    for (const w of name.split(' ')) if (w.length >= 2) all.add(w)
  }
  return [...all]
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
  const words = nameWords(identity.names)
  // Only a name with an accent or ß can be read loosely.
  const marked = words.filter((w) => /[\p{M}\u{df}]/u.test(w))
  const images = new Map<string, string>()
  const rules: Rules = {
    locals: local
      ? new RegExp(String.raw`(?<![\p{L}\p{N}])${local}(?![\p{L}\p{N}])`, 'giu')
      : null,
    localsAnyLength: local
      ? new RegExp(String.raw`(?<![\p{L}\p{N}])${local}(?![\p{L}\p{N}])`, 'giu')
      : null,
    local: local ? new RegExp(`^${local}$`, 'iu') : null,
    names: [
      anyOf(words, 'exact'),
      anyOf(marked, 'capitals'),
      joinedOf(words)
    ].filter((re): re is RegExp => re !== null),
    inside: insideOf(words),
    anyName: anyOf(words, 'loose'),
    whole: words.length
      ? new RegExp(
          `^(?:${[...words.map((w) => fragment(w, 'loose')), ...joinedNames(words)].join('|')})$`,
          'u'
        )
      : null,
    own: owns.length
      ? new RegExp(
          String.raw`(?<![\p{L}\p{N}])(?:${owns.join('|')})(?![\p{L}\p{N}])`,
          'giu'
        )
      : null,
    images,
    stored: new Set(images.values()),
    limits: lower(privacyLimits, options.limits),
    now: options.clock ?? (() => Date.now()),
    check: () => {}
  }
  // A personalised picture (its address names the person) is not shown,
  // not even its stored copy: such services draw the name into it. An
  // address longer than any link is not read (it is read before any
  // deadline), so its stored copy is not shown either.
  for (const { ref, path } of options.images ?? [])
    if (ref.length <= pictureAddress && !pictureNames(ref, rules))
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

/** The longest picture address read (links are far shorter). */
const pictureAddress = 8_192

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
const unseen = /[\p{Cf}\p{Default_Ignorable_Code_Point}]/gu
/**
 * Marks read as if they were not there, in a name and in the text alike:
 * Arabic vowel signs (harakat) and Hebrew points (niqqud), often written
 * or left out, and the overlay marks (a stroke, a slash) and the dot
 * below that only decorate a letter ("S̶a̶m̶", "Sạm").
 */
const soft =
  /[\u{64b}-\u{65f}\u{670}\u{6d6}-\u{6dc}\u{6df}-\u{6e4}\u{6e7}\u{6e8}\u{6ea}-\u{6ed}\u{591}-\u{5bd}\u{5bf}\u{5c1}\u{5c2}\u{5c4}\u{5c5}\u{5c7}\u{323}\u{334}-\u{338}]/gu
/** Text the skeleton changes: anything but plain ASCII, or "&" and "%". */
const special = /[^\x00-\x7f]|[&%]/
/** HTML character references in a text part ("samriv&#64;example.com"). */
const entity =
  /&(?:#(\d{1,7});?|#x([\da-f]{1,6});?|(commat|nbsp|amp|period|plus|lowbar|hyphen|dash|apos);)/iy
/** A run of percent escapes ("%D0%90", "%2540"). */
const percents = /(?:%(?:25)*[\da-f]{2})+/iy
/** A percent escape of a byte that is not plain ASCII. */
const highByte = /%(?:25)*[89a-f][\da-f]/i
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
/** Cyrillic and Greek letters that look Latin, each as its Latin letter. */
const lookalikes = new Map<string, string>(
  [
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
    ])
)
const lookalike = new RegExp(`[${[...lookalikes.keys()].join('')}]`, 'gu')
const lookalikeIn = new RegExp(lookalike.source, 'u')
const scripts = [
  /\p{Script=Latin}/u,
  /\p{Script=Cyrillic}/u,
  /\p{Script=Greek}/u
]
const foreign = /[\p{Script=Cyrillic}\p{Script=Greek}]/u
const wordRun = /[\p{L}\p{M}\p{N}]+/gu

/**
 * A word that mixes Latin, Cyrillic and Greek letters is a disguise: its
 * lookalike letters read as Latin ("Ѕаm" as Sam). A word in one script is
 * written in that language ("том", "και") and is read as written. Each
 * lookalike is one character for one, so positions stay.
 */
const unmask = (text: string) =>
  foreign.test(text)
    ? text.replace(wordRun, (w) =>
        lookalikeIn.test(w) &&
        Number(scripts[0]!.test(w)) +
          Number(scripts[1]!.test(w)) +
          Number(scripts[2]!.test(w)) >
          1
          ? w.replace(lookalike, (c) => lookalikes.get(c)!)
          : w
      )
    : text

/**
 * The UTF-8 length a byte starts, or 0 when it starts none. An overlong
 * form ("%C1%93" for S) is read as its character too: a lax server reads
 * it so.
 */
const lead = (b: number) =>
  b >= 0xc0 && b <= 0xdf
    ? 2
    : b >= 0xe0 && b <= 0xef
      ? 3
      : b >= 0xf0 && b <= 0xf7
        ? 4
        : 0

/** The character a UTF-8 sequence starting at `k` stands for, or -1. */
function utf8At(bytes: Uint8Array, k: number, n: number) {
  if (!n || k + n > bytes.length) return -1
  let code = bytes[k]! & (n === 2 ? 0x1f : n === 3 ? 0x0f : 0x07)
  for (let j = 1; j < n; j++) {
    const c = bytes[k + j]!
    if ((c & 0xc0) !== 0x80) return -1
    code = (code << 6) | (c & 0x3f)
  }
  // Nothing past the last character.
  return code > 0x10ffff ? -1 : code
}

const hexValue = (c: number) => (c <= 0x39 ? c - 0x30 : (c | 0x20) - 0x57)

/**
 * Percent escapes read one sequence at a time: a UTF-8 sequence as its
 * character, any other byte as Latin-1 ("Jos%E9"), or as `bad` when given;
 * also escapes applied twice or more ("%2553"). Read by hand (no decoder
 * that throws), the deadline every 4,096 bytes.
 */
function percentRun(run: string, bad?: string, check?: Check) {
  let out = run
  for (let i = 0; i < 4 && /%[\da-f]{2}/i.test(out); i++)
    out = out
      .replace(/%(?:25)+(?=[\da-f]{2})/gi, '%')
      .replace(/(?:%[\da-f]{2})+/gi, (escapes) => {
        const bytes = new Uint8Array(escapes.length / 3)
        for (let k = 0; k < bytes.length; k++)
          bytes[k] =
            hexValue(escapes.charCodeAt(3 * k + 1)) * 16 +
            hexValue(escapes.charCodeAt(3 * k + 2))
        const codes: number[] = []
        let read = ''
        for (let k = 0, due = 4_096; k < bytes.length;) {
          if (k >= due) {
            check?.('fold')
            due += 4_096
          }
          const b = bytes[k]!
          const n = lead(b)
          const code = b < 0x80 ? b : utf8At(bytes, k, n)
          if (code >= 0) k += b < 0x80 ? 1 : n
          else k++
          if (code >= 0) codes.push(code)
          else if (bad === undefined) codes.push(b)
          else {
            read += String.fromCodePoint(...codes) + bad
            codes.length = 0
          }
          if (codes.length >= 4_096) {
            read += String.fromCodePoint(...codes)
            codes.length = 0
          }
        }
        return read + String.fromCodePoint(...codes)
      })
  return out
}

/** What each character of the first plane folds to, kept once read. */
const folds: (string | undefined)[] = new Array(0x10000)

/**
 * One character as it is matched: compatibility forms as plain ones and an
 * accent as a mark of its own (NFKD, so a name reads it one way, see
 * `fragment`), curly apostrophes as straight ones, invisible characters
 * left out. Case stays (patterns read it). A sign that stands for a whole
 * word stays one sign. Never more than 4 characters for one.
 */
function fold(ch: string) {
  // The capital dotted I of Turkish is a capital i, not an i with an accent.
  let f = ch === '\u{130}' ? 'I' : ch.normalize('NFKD')
  if (f.length > 4) f = ch
  return f
    .replace(unseen, '')
    .replace(soft, '')
    .replace(/[\u{2018}\u{2019}]/gu, "'")
}

/** Where plain ASCII (but "&" and "%", which are read) ends. */
const plainEnd = /[^\x00-\x24\x27-\x7f]/g

/**
 * What a reader sees, for matching only (the text written is never this):
 * each character folded (see `fold`), character references and percent
 * escapes read (a byte that is no UTF-8 as Latin-1, or as `bad`), lookalike
 * letters in a word of mixed scripts as Latin. `at` and `end` map a
 * position back to the characters it came from. The deadline is read every
 * 4,096 characters.
 */
function skeleton(s: string, check?: Check, bad?: string) {
  if (!special.test(s))
    return { text: s, at: (i: number) => i, end: (i: number) => i + 1 }
  // Each character of the skeleton, and where it came from (at most four
  // for one character read).
  let units = new Uint16Array(s.length + 8)
  let starts = new Int32Array(s.length + 8)
  let ends = new Int32Array(s.length + 8)
  let t = 0
  const room = (count: number) => {
    if (t + count <= units.length) return
    const size = Math.max(units.length * 2, t + count)
    const grow = <A extends Uint16Array | Int32Array>(a: A, b: A) => {
      b.set(a)
      return b
    }
    units = grow(units, new Uint16Array(size))
    starts = grow(starts, new Int32Array(size))
    ends = grow(ends, new Int32Array(size))
  }
  const put = (read: string, from: number, to: number) => {
    room(read.length)
    for (let k = 0; k < read.length; k++) {
      units[t] = read.charCodeAt(k)
      starts[t] = from
      ends[t++] = to
    }
  }
  for (let i = 0, n = 0; i < s.length; n++) {
    if ((n & 4095) === 4095) check?.('fold')
    const c = s.charCodeAt(i)
    if (c < 0x80 && c !== 0x25 && c !== 0x26) {
      plainEnd.lastIndex = i
      const j = plainEnd.exec(s)?.index ?? s.length
      room(j - i)
      for (; i < j; i++) {
        units[t] = s.charCodeAt(i)
        starts[t] = i
        ends[t++] = i + 1
      }
      continue
    }
    entity.lastIndex = i
    percents.lastIndex = i
    const ref = c === 0x26 ? entity.exec(s) : null
    const run = c === 0x25 ? percents.exec(s) : null
    if (ref) {
      const code = ref[1]
        ? Number(ref[1])
        : ref[2]
          ? parseInt(ref[2], 16)
          : named[ref[3]!.toLowerCase()]!.codePointAt(0)!
      const next = i + ref[0].length
      if (code > 0 && code <= 0x10ffff)
        put(fold(String.fromCodePoint(code)), i, next)
      i = next
    } else if (run) {
      const next = i + run[0].length
      for (const ch of percentRun(run[0], bad, check)) put(fold(ch), i, next)
      i = next
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const ch = String.fromCodePoint(s.codePointAt(i)!)
      put(fold(ch), i, i + ch.length)
      i += ch.length
    } else {
      // A character of the first plane: its fold is kept once read.
      put((folds[c] ??= fold(s[i]!)), i, i + 1)
      i++
    }
  }
  let text = ''
  for (let k = 0; k < t; k += 8_192)
    text += String.fromCharCode(...units.subarray(k, Math.min(t, k + 8_192)))
  const size = t
  return {
    text: unmask(text),
    at: (k: number) => (k < size ? starts[k]! : s.length),
    end: (k: number) => (k < size ? ends[k]! : s.length)
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
  const views = [{ sk: skeleton(s, r.check), from: 0 }]
  // A byte that is no UTF-8 is read as Latin-1 ("Jos%E9") and also as a
  // break, so it can neither hide a name nor join one to a word ("Sam%FF"):
  // the second reading covers only the escapes and what is next to them.
  for (const [a, b] of nearHighBytes(s))
    views.push({ sk: skeleton(s.slice(a, b), r.check, '\u{fffd}'), from: a })
  const cuts: [number, number][] = []
  for (const { sk, from } of views)
    for (const re of patterns)
      for (const m of re ? sk.text.matchAll(re) : [])
        if (m[0] && (re !== r.locals || ownLocal(m[0], r))) {
          let end = from + sk.end(m.index + m[0].length - 1)
          // The accents of the last letter go with it.
          while (end < s.length && mark.test(s[end]!)) end++
          cuts.push([from + sk.at(m.index), end])
        }
  return cuts.sort((a, b) => a[0] - b[0])
}

const mark = /\p{M}/u
const percentRuns = new RegExp(percents.source, 'gi')

/** The parts around percent escapes of bytes that are not ASCII. */
function nearHighBytes(s: string) {
  const near: [number, number][] = []
  if (!highByte.test(s)) return near
  percentRuns.lastIndex = 0
  for (let m; (m = percentRuns.exec(s));) {
    if (!highByte.test(m[0])) continue
    const a = Math.max(0, m.index - 512)
    const b = Math.min(s.length, m.index + m[0].length + 512)
    const last = near.at(-1)
    if (last && a <= last[1]) last[1] = b
    else near.push([a, b])
  }
  return near
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
  remove(s, [...addressRules(r), ...(names ? r.names : [])], r)

/**
 * Whether a value (a link, a tag or attribute name) holds an address or
 * the inbox's local part, or with `names` a name; escapes read.
 */
export const hit = (value: string, r: Rules, names = true) =>
  ranges(value, [...addressRules(r), ...(names ? r.names : [])], r).length > 0

const utf8 = new TextDecoder()

/**
 * Whether a picture's address names the person, so not even its stored
 * copy is shown (services draw the name into it). Stricter than for
 * words, as a false alarm costs one picture: a name in any case with or
 * without its accents, the inbox's local part at any length, and every
 * base64-looking part read as text too, from each of its first four
 * characters (so a short part, or one with a prefix joined to it, is read
 * at its own place), as UTF-8 and as Latin-1.
 */
export function pictureNames(ref: string, r: Rules): boolean {
  const all = [...addressRules(r), r.localsAnyLength, r.anyName, r.inside]
  if (ranges(ref, all, r).length) return true
  const plain = ref.replace(new RegExp(percents.source, 'gi'), (run) =>
    percentRun(run)
  )
  for (const source of new Set([ref, plain]))
    for (const [part] of source.matchAll(/[a-z\d+/_-]{4,}/gi))
      for (let k = 0; k < 4 && part.length - k >= 4; k++) {
        let token = part.slice(k).replace(/-/g, '+').replace(/_/g, '/')
        if (token.length % 4 === 1) token = token.slice(0, -1)
        let bytes: string
        try {
          bytes = atob(token)
        } catch {
          continue
        }
        const text = utf8.decode(Uint8Array.from(bytes, (c) => c.charCodeAt(0)))
        if (ranges(text, all, r).length || ranges(bytes, all, r).length)
          return true
      }
  return false
}

/**
 * One of the inbox's names (any case, an accent or ß it has missing or not)
 * or its local part.
 */
export function isName(r: Rules, candidate: string) {
  const name = skeleton(candidate).text
  return Boolean(r.whole?.test(name) || r.local?.test(name))
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

function pass(input: string, r: Rules, edges: boolean) {
  let s = input.normalize('NFC').replace(sentTo, '').replace(url, linkTail)
  s = remove(s, [address, obfuscated, r.own], r)
  s = s.replace(greeting, (m, hi: string, _sep: string, candidate: string) => {
    const name = candidate.replace(/\.+$/, '')
    if (!isName(r, name)) return m
    const word = /^dear$/i.test(hi) ? (hi[0] === 'D' ? 'Hi' : 'hi') : hi
    return `${word} there${candidate.slice(name.length)}`
  })
  s = remove(s, [r.locals, ...r.names], r)
  return s === input ? input : tidy(s, edges)
}

/**
 * Cleans until nothing changes, in at most three passes; text that still
 * changes then is refused (nothing is kept of it), as HTML is. The HTML
 * deadline is read before each pass.
 */
export function clean(text: string, r: Rules, edges = false) {
  let out = text
  for (let i = 0; i < 3; i++) {
    r.check('pass')
    const next = pass(out, r, edges)
    if (next === out) return out
    out = next
  }
  r.check('pass')
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
 * is left at its end; one long word is not read at all. An address the
 * cut goes through ("samriv @ example.com" has blanks) is left out whole.
 */
function read(value: string, max: number, r: Rules) {
  const limit = Math.max(0, Math.floor(max * r.limits.readFactor))
  if (value.length <= limit) return value
  let end = /\s/.test(value[limit]!)
    ? limit
    : Math.max(
        value.lastIndexOf(' ', limit - 1),
        value.lastIndexOf('\n', limit - 1),
        0
      )
  const from = Math.max(0, end - 1_024)
  const near = ranges(value.slice(from, end + 1_024), addressRules(r), r)
  for (const [a, b] of near.reverse())
    if (from + a < end && from + b > end) end = from + a
  return value.slice(0, end)
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
