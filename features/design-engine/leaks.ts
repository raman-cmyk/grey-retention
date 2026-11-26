import { klaviyoFooterTags } from '../blocks/klaviyo-tags'
import { partsOf, textOf, type Blueprint, type Item } from './blueprint'

/**
 * DES-ENGINE-002: rule 8 checked on the drawn email. A brand copy of a
 * library email may share the source's structure and nothing a reader
 * sees of it:
 * - no **picture** of the source: the same address, or the same host and
 *   path (query strings aside), or the same picture file name anywhere;
 * - no **link** of the source (host and path, query strings aside);
 * - no **name** of the source's brand (given by the caller: the inbox
 *   brand's name and domain);
 * - no **phrase** of the source: three words in a row it says anywhere
 *   (its words, its alt texts and titles, its `<title>`, comments,
 *   subject and preview line);
 * - no **number** the source shows (prices, percents, numeric codes)
 *   unless the brand's own content has it;
 * - and every **word** the copy shows (its words, alt texts, titles,
 *   `<title>`, comments, subject and preview line, the library blocks'
 *   too) is one of the brand's own: in the words, facts and catalog the
 *   swap was given (`vocabulary`);
 * - DES-ENGINE-003: no **hidden mark** in the copy: a named character the
 *   engine never writes (`Ac&zz;me` reads as "Ac me" to the word check but
 *   may show as anything), or an invisible character (zero-width space,
 *   joiner and non-joiner, word joiner, byte-order mark, soft hyphen), as
 *   a character or written as `&#…;`, which could split a source word so
 *   the word check misses it.
 * It refuses to run (throws `LeakCheckError`) without the source's own
 * HTML: a stored blueprint has no pictures or links, so a check from it
 * alone could pass a copy that is not clean. Code only.
 */

export class LeakCheckError extends Error {}

const named: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  middot: '·',
  bull: '•',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  copy: '©',
  reg: '®',
  trade: '™',
  euro: '€',
  pound: '£',
  yen: '¥',
  cent: '¢',
  times: '×',
  // The library blocks' "Shop now →".
  rarr: '→',
  // Invisible: read as nothing, so a word they split is read whole
  // (`hiddenMarks` reports them in a copy, DES-ENGINE-003).
  zwnj: '',
  zwj: '',
  shy: ''
}

/** A name of the table (never an object's own, `constructor`). */
const knownName = (name: string) => Object.hasOwn(named, name)

/**
 * DES-ENGINE-003: characters a reader cannot see: every format character
 * (zero-width space, non-joiner and joiner, word joiner, byte-order mark,
 * soft hyphen, direction marks…) and the other blank ones (the combining
 * grapheme joiner, the Hangul fillers).
 */
const invisible = /[\p{Cf}\u034F\u115F\u1160\u3164\uFFA0]/gu
/** The named ones, as a browser reads them. */
const invisibleByName: Record<string, string> = {
  shy: '\u00AD',
  zwnj: '\u200C',
  zwj: '\u200D',
  zwsp: '\u200B',
  nobreak: '\u2060',
  lrm: '\u200E',
  rlm: '\u200F'
}

const codePoint = (n: number) =>
  n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff)
    ? String.fromCodePoint(n)
    : ' '

export const decode = (s: string) =>
  s
    // As a browser reads them: leading zeros, and the semicolon optional.
    .replace(/&#0*(\d{1,8});?/g, (_, n: string) => codePoint(Number(n)))
    .replace(/&#x0*([0-9a-f]{1,7});?/gi, (_, n: string) =>
      codePoint(parseInt(n, 16))
    )
    // A named character this table lacks (&hearts;) is read as a space, never
    // as its name; `hiddenMarks` reports it in a copy (DES-ENGINE-003).
    .replace(/&([a-z][a-z0-9]*);/gi, (_, n: string) =>
      knownName(n.toLowerCase()) ? named[n.toLowerCase()]! : ' '
    )
    // A browser reads `&shy` without its semicolon too.
    .replace(/&shy(?!;)/gi, '')
    // Invisible characters are read as nothing: a word they split is one.
    .replace(invisible, '')

/**
 * The words of a text, lower case, letters and digits only; an invisible
 * character inside a word does not split it (DES-ENGINE-003).
 */
export const wordsIn = (text: string) =>
  (
    text
      .replace(invisible, '')
      .toLowerCase()
      .match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu) ?? []
  ).map((w) => w.replace(/’/g, "'"))

/** Numbers as shown: "$48.00", "40%", "1234" (spaces aside). */
/**
 * Numbers by value: currency signs, percent signs, thousands separators
 * and a zero fraction set aside ("$1,299.00", "1299" and "1.299,00" are
 * one number).
 */
export const numbersIn = (text: string) =>
  (text.match(/\d[\d.,]*/g) ?? []).flatMap((raw) => {
    const n = raw.replace(/[.,]$/, '')
    const normal = /^\d{1,3}(\.\d{3})+(,\d+)?$|^\d+,\d{1,2}$/.test(n)
      ? n.replace(/\./g, '').replace(',', '.')
      : n.replace(/,/g, '')
    const v = Number(normal)
    return Number.isFinite(v) ? [String(v)] : []
  })

const addressAttrs = new Set([
  'src',
  'href',
  'background',
  'poster',
  'srcset',
  'action',
  'data',
  'xlink:href',
  'longdesc',
  'cite'
])
const wordAttrs = new Set([
  'alt',
  'title',
  'aria-label',
  'aria-description',
  'placeholder',
  'value',
  'label',
  'summary'
])

export type ReadEmail = {
  /** What a reader may see or hear: texts, alt texts, titles, comments. */
  texts: string[]
  /** Every picture address and link (src, href, background, style url()…). */
  addresses: string[]
}

/** The engine's own Klaviyo tags (`klaviyoFooterTags`) and their labels. */
const ownTags = Object.values(klaviyoFooterTags).map((tag) => ({
  tag,
  label: /"([^"]*)"/.exec(tag)?.[1] ?? ''
}))

/** The email with the engine's own Klaviyo tags replaced by their labels. */
export function withoutOwnTags(html: string): string {
  let out = html
  for (const { tag, label } of ownTags)
    out = out.split(tag).join(label ? ` ${label} ` : ' ')
  return out
}

/**
 * DES-ENGINE-002b2: template code a copy shows that is not one of the
 * engine's own Klaviyo tags (`{{ "Acme Deals" }}`, `{% with … %}`): it
 * could print anything when Klaviyo sends, so it is a leak (short excerpts).
 */
export function klaviyoCode(html: string): string[] {
  return [
    ...withoutOwnTags(html).matchAll(/\{\{[\s\S]{0,60}|\{%[\s\S]{0,60}/g)
  ].map((m) => m[0].slice(0, 80))
}

/**
 * DES-ENGINE-003: what a copy hides from the word check, in short
 * excerpts: every named character the engine does not write (`&zz;`,
 * `&hearts;`; it escapes every `&` of the words it draws, so an unknown
 * name can only be put there to hide something), and every invisible
 * character that splits a word (a letter or digit on both sides), as
 * itself, as a number (`&#8203;`, `&#00008203`) or by its name (`&shy;`,
 * `&shy`), unless the whole word is one of the brand's own (`vocabulary`,
 * read without them). An invisible joiner inside an emoji (🏳️‍🌈) splits no
 * word. The engine's own Klaviyo tags are left out first, as everywhere.
 */
export function hiddenMarks(
  email: string,
  vocabulary: ReadonlySet<string> = new Set()
): string[] {
  const html = withoutOwnTags(email)
  const out: string[] = []
  for (const m of html.matchAll(/&([a-z][a-z0-9]*);/gi)) {
    const name = m[1]!.toLowerCase()
    if (!knownName(name) || Object.hasOwn(invisibleByName, name)) out.push(m[0])
  }
  // The text as a browser shows it, invisible characters kept.
  const shown = html
    .replace(/&#0*(\d{1,8});?/g, (_, n: string) => codePoint(Number(n)))
    .replace(/&#x0*([0-9a-f]{1,7});?/gi, (_, n: string) =>
      codePoint(parseInt(n, 16))
    )
    .replace(
      /&(?:(shy|zwnj|zwj|zwsp|nobreak|lrm|rlm);|(shy)(?!;))/gi,
      (_, n: string | undefined, legacy: string | undefined) =>
        invisibleByName[(n ?? legacy ?? 'shy').toLowerCase()]!
    )
  const letter = /[\p{L}\p{N}]/u
  for (const m of shown.matchAll(invisible)) {
    const at = m.index!
    // The nearest visible characters on each side.
    let before = at - 1
    while (before >= 0 && /[\p{Cf}\u034F]/u.test(shown[before]!)) before--
    let after = at + m[0].length
    while (after < shown.length && /[\p{Cf}\u034F]/u.test(shown[after]!))
      after++
    if (!letter.test(shown[before] ?? '') || !letter.test(shown[after] ?? ''))
      continue
    // The word it splits, read whole.
    let from = before
    while (from > 0 && /[\p{L}\p{N}\p{Cf}\u034F]/u.test(shown[from - 1]!))
      from--
    let to = after
    while (
      to + 1 < shown.length &&
      /[\p{L}\p{N}\p{Cf}\u034F]/u.test(shown[to + 1]!)
    )
      to++
    const word = shown
      .slice(from, to + 1)
      .replace(invisible, '')
      .toLowerCase()
    if (vocabulary.has(word)) continue
    out.push(
      `U+${m[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`
    )
  }
  return [...new Set(out)]
}

/** Everything a reader may see of an email, and every address it reaches. */
export function readEmail(email: string): ReadEmail {
  // DES-ENGINE-002b2: Klaviyo's own footer tags, exactly as the engine
  // writes them, are code Klaviyo fills when it sends, not words a reader
  // sees: only their labels are read. Any other `{{`/`{%` stays as it is
  // (`klaviyoCode` reports it in a copy).
  const html = withoutOwnTags(email)
  const texts: string[] = []
  const addresses: string[] = []
  const title = /<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i.exec(html)
  if (title) texts.push(decode(title[1]!))
  for (const m of html.matchAll(/<!--([\s\S]*?)-->/g)) texts.push(decode(m[1]!))
  const urlsIn = (css: string) => {
    for (const u of css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi))
      addresses.push(decode(u[2]!.trim()))
  }
  for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi))
    urlsIn(m[1]!)
  for (const tag of html.matchAll(/<[a-zA-Z][^>]*>/g))
    for (const a of tag[0].matchAll(
      /\s([^\s=/>"']+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/g
    )) {
      const name = a[1]!.toLowerCase()
      const value = decode(a[2] ?? a[3] ?? a[4] ?? '')
      if (name === 'srcset')
        for (const part of value.split(','))
          addresses.push(part.trim().split(/\s+/)[0] ?? '')
      else if (addressAttrs.has(name)) addresses.push(value.trim())
      else if (name === 'style') urlsIn(value)
      else if (wordAttrs.has(name)) texts.push(value)
    }
  const body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<head(?:\s[^>]*)?>[\s\S]*?<\/head>/gi, ' ')
    .replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  texts.push(decode(body))
  return { texts, addresses: addresses.filter(Boolean) }
}

/** An address compared by what it points at: host and path (query aside). */
function addressKey(address: string): string {
  if (/^data:/i.test(address)) return address
  try {
    const u = new URL(address, 'https://relative.invalid/')
    return `${u.protocol === 'mailto:' ? 'mailto:' : ''}${u.hostname.toLowerCase()}${decodeURIComponent(u.pathname)}`
  } catch {
    return address
  }
}

/** A picture's file name, when it is distinctive enough to compare. */
function fileName(address: string): string | null {
  if (/^data:/i.test(address)) return null
  const name = addressKey(address).split('/').pop() ?? ''
  return /^.{8,}\.(?:png|jpe?g|gif|webp|svg|avif)$/i.test(name)
    ? name.toLowerCase()
    : null
}

function blueprintTexts(bp: Blueprint) {
  const texts: string[] = []
  const addresses: string[] = []
  const walk = (items: readonly Item[]) => {
    for (const p of partsOf(items)) {
      if (p.type === 'text') {
        texts.push(textOf(p))
        for (const r of p.runs) if (r.href) addresses.push(r.href)
      }
      if (p.type === 'button') {
        texts.push(p.label)
        if (p.href) addresses.push(p.href)
      }
      if (p.type === 'image') {
        if (p.alt) texts.push(p.alt)
        if (p.src) addresses.push(p.src)
        if (p.href) addresses.push(p.href)
      }
    }
  }
  for (const s of bp.sections) walk(s.items)
  return { texts, addresses }
}

const triples = (words: readonly string[]) => {
  const out = new Set<string>()
  for (let i = 0; i + 2 < words.length; i++)
    out.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`)
  return out
}

export type Leak =
  | { kind: 'picture'; value: string }
  | { kind: 'link'; value: string }
  | { kind: 'name'; value: string }
  | { kind: 'phrase'; value: string }
  | { kind: 'number'; value: string }
  | { kind: 'word'; value: string }
  /** DES-ENGINE-003: an unknown named character or an invisible one. */
  | { kind: 'hidden'; value: string }

/** Everything of the source a drawn brand copy shows; empty when none. */
export function leaksOf(input: {
  /** The source email's own HTML (its pictures, links and words). Required. */
  sourceHtml: string
  /** The source's blueprint as measured, when known. */
  source?: Blueprint
  /** The source's subject and preview line, when known. */
  sourceSubject?: string
  sourcePreheader?: string
  /** The drawn brand copy, with its subject and preview line. */
  html: string
  subject?: string
  preheader?: string
  /** The source brand's names (its name, its domain). */
  sourceNames: readonly string[]
  /** Everything the brand's content says (words, facts, catalog, footer). */
  vocabulary: readonly string[]
}): Leak[] {
  if (!input.sourceHtml?.trim())
    throw new LeakCheckError(
      'The leak check needs the original email’s own HTML, not only its stored blueprint.'
    )
  const leaks: Leak[] = []
  const add = (leak: Leak) => {
    if (!leaks.some((l) => l.kind === leak.kind && l.value === leak.value))
      leaks.push(leak)
  }
  const theirs = readEmail(input.sourceHtml)
  const fromBp = input.source
    ? blueprintTexts(input.source)
    : { texts: [], addresses: [] }
  const sourceTexts = [
    ...theirs.texts,
    ...fromBp.texts,
    input.sourceSubject ?? '',
    input.sourcePreheader ?? ''
  ]
  const sourceAddresses = [...theirs.addresses, ...fromBp.addresses].filter(
    (a) => /^(?:https?:|data:image|mailto:|\/\/)/i.test(a)
  )
  const keys = new Set(sourceAddresses.map(addressKey))
  // The source brand's own domains (from its names): any address there is
  // its, whatever the path. Other hosts it linked to (a social network)
  // are fine for the brand's own pages there.
  const domains = input.sourceNames
    .map((n) => n.trim().toLowerCase())
    .filter((n) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(n))
  const onTheirDomain = (a: string) => {
    if (/^data:/i.test(a)) return false
    try {
      const host = new URL(
        a,
        'https://relative.invalid/'
      ).hostname.toLowerCase()
      return domains.some((d) => host === d || host.endsWith(`.${d}`))
    } catch {
      return false
    }
  }
  const files = new Set(sourceAddresses.flatMap((a) => fileName(a) ?? []))
  const ours = readEmail(input.html)
  for (const code of klaviyoCode(input.html)) add({ kind: 'word', value: code })
  for (const mark of hiddenMarks(
    input.html,
    new Set(input.vocabulary.flatMap(wordsIn))
  ))
    add({ kind: 'hidden', value: mark })
  for (const a of ours.addresses) {
    const kind = /\.(?:png|jpe?g|gif|webp|svg|avif)$|^data:image/i.test(
      addressKey(a)
    )
      ? 'picture'
      : 'link'
    if (keys.has(addressKey(a)) || onTheirDomain(a))
      add({ kind, value: a.slice(0, 80) })
    else if (fileName(a) && files.has(fileName(a)!))
      add({ kind: 'picture', value: a.slice(0, 80) })
  }
  const shown = [...ours.texts, input.subject ?? '', input.preheader ?? '']
  const shownWords = shown.flatMap(wordsIn)
  const flat = ` ${shownWords.join(' ')} `
  for (const name of input.sourceNames) {
    const w = wordsIn(name).join(' ')
    if (w && flat.includes(` ${w} `)) add({ kind: 'name', value: name })
  }
  const vocabulary = input.vocabulary
  const ourTriples = triples(vocabulary.flatMap(wordsIn))
  const said = new Set<string>()
  for (const t of sourceTexts) for (const x of triples(wordsIn(t))) said.add(x)
  for (const part of shown)
    for (const x of triples(wordsIn(part)))
      if (said.has(x) && !ourTriples.has(x)) add({ kind: 'phrase', value: x })
  const theirNumbers = new Set(sourceTexts.flatMap(numbersIn))
  const ourNumbers = new Set(vocabulary.flatMap(numbersIn))
  for (const n of new Set(shown.flatMap(numbersIn)))
    if (theirNumbers.has(n) && !ourNumbers.has(n))
      add({ kind: 'number', value: n })
  const vocab = new Set(vocabulary.flatMap(wordsIn))
  for (const w of new Set(shownWords))
    if (!vocab.has(w) && !/^\d+$/.test(w)) add({ kind: 'word', value: w })
  return leaks
}
