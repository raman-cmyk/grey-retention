import { partsOf, textOf, type Blueprint, type Item } from './blueprint'

/**
 * DES-ENGINE-002: rule 8 checked on the drawn email. A brand copy of a
 * library email may share the source's structure and nothing a reader
 * sees of it:
 * - no **picture** of the source (its address, inline or https);
 * - no **link** of the source;
 * - no **name** of the source's brand (its own words for itself, given by
 *   the caller: the inbox brand's name and domain);
 * - no **phrase** of the source: three words in a row the source says
 *   (its texts, button words and alt texts);
 * - and every **word** the email shows (its texts, buttons and alt texts,
 *   the library blocks' too) is one of the brand's own: in the words,
 *   facts and catalog the swap was given (`vocabulary`).
 * Code only; the email build refuses a copy with any leak.
 */

const decode = (s: string) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&middot;/g, '·')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) =>
      String.fromCodePoint(parseInt(n, 16))
    )
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')

/** The words of a text, lower case, letters and digits only. */
export const wordsIn = (text: string) =>
  (text.toLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu) ?? []).map(
    (w) => w.replace(/’/g, "'")
  )

/** What a reader sees of an email: its words, alt texts and titles. */
export function shownText(html: string): string[] {
  const body = html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
  const alts = [...body.matchAll(/\salt\s*=\s*"([^"]*)"/gi)].map((m) =>
    decode(m[1]!)
  )
  const text = decode(
    body.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')
  )
  return [text, ...alts]
}

/** Every picture address and link of an email. */
export function addressesIn(html: string): string[] {
  return [...html.matchAll(/\s(?:src|href)\s*=\s*"([^"]*)"/gi)].map((m) =>
    decode(m[1]!)
  )
}

function sourceTexts(bp: Blueprint) {
  const out: string[] = []
  const pics: string[] = []
  const links: string[] = []
  const walk = (items: readonly Item[]) => {
    for (const p of partsOf(items)) {
      if (p.type === 'text') {
        out.push(textOf(p))
        for (const r of p.runs) if (r.href) links.push(r.href)
      }
      if (p.type === 'button') {
        out.push(p.label)
        if (p.href) links.push(p.href)
      }
      if (p.type === 'image') {
        if (p.alt) out.push(p.alt)
        if (p.src) pics.push(p.src)
        if (p.href) links.push(p.href)
      }
    }
  }
  for (const s of bp.sections) walk(s.items)
  return { texts: out, pics, links }
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
  | { kind: 'word'; value: string }

/** Everything of the source a drawn brand copy shows; empty when none. */
export function leaksOf(input: {
  /** The source as measured (with its pictures and links when known). */
  source: Blueprint
  /** The source email's own HTML, when known (its pictures and links). */
  sourceHtml?: string
  /** The drawn brand copy. */
  html: string
  /** The source brand's names (its name, its domain). */
  sourceNames: readonly string[]
  /** Everything the brand's content says (words, facts, catalog, footer). */
  vocabulary: readonly string[]
}): Leak[] {
  const leaks: Leak[] = []
  const src = sourceTexts(input.source)
  const theirs = new Set([
    ...src.pics,
    ...(input.sourceHtml
      ? addressesIn(input.sourceHtml).filter((a) =>
          /^(?:https?:|data:image)/i.test(a)
        )
      : [])
  ])
  const theirLinks = new Set([
    ...src.links,
    ...(input.sourceHtml
      ? addressesIn(input.sourceHtml).filter((a) =>
          /^(?:https?|mailto):/i.test(a)
        )
      : [])
  ])
  for (const a of addressesIn(input.html)) {
    if (theirs.has(a)) leaks.push({ kind: 'picture', value: a.slice(0, 80) })
    else if (theirLinks.has(a)) leaks.push({ kind: 'link', value: a })
  }
  const shown = shownText(input.html)
  const shownWords = shown.flatMap(wordsIn)
  const flat = ` ${shownWords.join(' ')} `
  for (const name of input.sourceNames) {
    const w = wordsIn(name).join(' ')
    if (w && flat.includes(` ${w} `)) leaks.push({ kind: 'name', value: name })
  }
  const ours = triples(input.vocabulary.flatMap(wordsIn))
  const said = new Set<string>()
  for (const t of src.texts) for (const x of triples(wordsIn(t))) said.add(x)
  for (const part of shown)
    for (const x of triples(wordsIn(part)))
      if (said.has(x) && !ours.has(x)) leaks.push({ kind: 'phrase', value: x })
  const vocab = new Set(input.vocabulary.flatMap(wordsIn))
  for (const w of new Set(shownWords))
    if (!vocab.has(w) && !/^\d+$/.test(w))
      leaks.push({ kind: 'word', value: w })
  return leaks
}
