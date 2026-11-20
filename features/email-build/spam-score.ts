import { drawnText } from './drawn-text'
import { phrase, spamPhrases } from './inspect'

/**
 * Owner pick #93 (D27): the spam check before the push. Code adds up
 * points for what spam filters commonly look for, read from the email as
 * drawn (the HTML the push sends) with its subject and preview line:
 * shouting, spam words, a fake "RE:", an email that is nearly all
 * pictures, short links, links whose words name another site, links to a
 * bare number address, hidden words, and very many links or sites.
 *
 * Words that come from the store (its name, its products, its reviews,
 * its code: `store.text`) are left out of the word rules, as copy QA
 * leaves them out: nothing can rewrite them, so they never fail an email.
 * Its logo is not a picture against its words, and a link to its own site
 * may carry any words.
 *
 * Common filters add points rule by rule and mark an email as spam at 5.
 * These rules and points are ours, chosen like theirs: a score here is not
 * any real filter's score, and passing is no promise of the inbox. At
 * `spamLimit` or more the email fails its hard checks (DST-005): the
 * studio's email is drawn with its coded blocks, and a coded email is not
 * stored. Pure: the same email, the same score.
 */

export type SpamRule =
  | 'subject_capitals'
  | 'subject_exclaims'
  | 'subject_fake_reply'
  | 'subject_spam_words'
  | 'subject_money'
  | 'body_spam_words'
  | 'body_capitals'
  | 'body_exclaims'
  | 'mostly_pictures'
  | 'short_link'
  | 'address_link'
  | 'link_words_elsewhere'
  | 'hidden_words'
  | 'many_links'
  | 'many_sites'

export type SpamHit = { rule: SpamRule; points: number; problem: string }

export type SpamScore = { score: number; hits: SpamHit[] }

/** What the check knows of the store, so its own words never count. */
export type SpamStore = {
  /** The store's own words: its name, products, reviews, code, claims. */
  text?: readonly string[]
  /** Its name: a picture with it as its words is the logo. */
  name?: string
  /** Its hosts: a link to one may carry any words. */
  hosts?: readonly string[]
}

/** Filters commonly mark an email as spam from 5 points. */
export const spamLimit = 5

/** Link shorteners filters distrust (the store's own links never need one). */
const shorteners = [
  'bit.ly',
  'tinyurl.com',
  't.co',
  'goo.gl',
  'ow.ly',
  'is.gd',
  'buff.ly',
  'rebrand.ly',
  'cutt.ly',
  'shorturl.at',
  'rb.gy',
  'tiny.cc'
]

const hostOf = (href: string) => {
  try {
    const url = new URL(drawnText(href))
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.hostname.toLowerCase()
      : null
  } catch {
    return null
  }
}
const bare = (host: string) => host.replace(/^www\./, '')
const sameSite = (a: string, b: string) => {
  const x = bare(a)
  const y = bare(b)
  return x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`)
}

const escapeRegex = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * `text` without the store's own words (longest first), in any case, as
 * whole words only (a store word "Act" never hides "act now" in another).
 */
function masked(text: string, own: readonly string[]) {
  let out = text
  for (const words of [...own]
    .map((w) => drawnText(w))
    .filter((w) => w.length > 1)
    .sort((a, b) => b.length - a.length))
    out = out.replace(
      new RegExp(
        `(?<![\\p{L}\\p{N}])${escapeRegex(words)}(?![\\p{L}\\p{N}])`,
        'giu'
      ),
      ' '
    )
  return out
}

/** Words a reader reads, without Klaviyo's tags ({{ … }}, {% … %}). */
const wordCount = (text: string) =>
  text
    .replace(/\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g, ' ')
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length

/** Words of 2 or more letters, and those of 3 or more in capitals. */
function capitalWords(text: string) {
  const words = text.match(/\b[A-Za-z]{2,}\b/g) ?? []
  const loud = words.filter((w) => w.length >= 3 && w === w.toUpperCase())
  return { words: words.length, loud: loud.length }
}

/** A web address written as a link's words: "www.shop.com", "shop.com/x". */
const addressWords =
  /^(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})(?:[/?#]\S*)?$/i

/** A tag's attribute in double quotes, never one inside another's name. */
const attrOf = (tag: string, name: string) =>
  new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag)?.[1] ?? ''

/**
 * The body a reader is shown: no head, no comments or styles, and without
 * the hidden block that holds the preview line (which every email has and
 * filters expect), only that one.
 */
function bodyOf(html: string, preheader: string) {
  const noHead = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<head\b[\s\S]*?<\/head>/i, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  const line = drawnText(preheader)
  if (!line) return noHead
  const hidden =
    /<div\b[^>]*\sstyle\s*=\s*"[^"]*display\s*:\s*none[^"]*"[^>]*>([^<]*)<\/div>/gi
  for (const m of noHead.matchAll(hidden))
    if (drawnText(m[1]!).startsWith(line))
      return `${noHead.slice(0, m.index)} ${noHead.slice(m.index + m[0].length)}`
  return noHead
}

/** Hides the element and all inside it. */
const hiddenStyle =
  /display\s*:\s*none|visibility\s*:\s*hidden|(?:^|;)\s*opacity\s*:\s*0(?:\.0*)?\s*(?:;|$)/
/**
 * Too small to read: only the element's own words (a wrapper at size 0
 * around columns that set their own size is a common email layout).
 */
const tinyStyle = /(?:^|;)\s*font-size\s*:\s*[01](?:\.\d+)?(?:px)?\s*(?:;|$)/

/** Words put where no reader sees them: hidden, or too small to read. */
function hiddenWords(body: string) {
  let found = 0
  for (const m of body.matchAll(/<([a-z][a-z0-9]*)\b[^>]*>/gi)) {
    const style = attrOf(m[0], 'style').toLowerCase()
    const rest = body.slice(m.index + m[0].length)
    if (!hiddenStyle.test(style)) {
      if (
        tinyStyle.test(style) &&
        /[\p{L}\p{N}]/u.test(drawnText(rest.split('<')[0]!))
      )
        found++
      continue
    }
    // Its words up to its own end (inner tags too), as near as markup lets.
    const end = rest.search(new RegExp(`</${m[1]}\\s*>`, 'i'))
    const inside = end < 0 ? rest : rest.slice(0, end)
    if (/[\p{L}\p{N}]/u.test(drawnText(inside))) found++
  }
  return found
}

/** The subject's own rules (the lab's B is read by them too). */
export function subjectHits(
  subjectLine: string,
  own: readonly string[] = []
): SpamHit[] {
  const hits: SpamHit[] = []
  const add = (rule: SpamRule, points: number, problem: string) =>
    hits.push({ rule, points, problem })
  const raw = drawnText(subjectLine)
  const subject = masked(raw, own)
  const caps = capitalWords(subject)
  if (caps.words >= 2 && caps.loud / caps.words >= 0.5)
    add(
      'subject_capitals',
      2,
      'The subject is mostly in capitals: write it normally.'
    )
  if ((subject.match(/!/g) ?? []).length >= 2 || /[!?]{2,}/.test(subject))
    add(
      'subject_exclaims',
      1,
      'The subject has two or more exclamation marks, or "?!" and the like.'
    )
  if (/^\s*(re|fwd?|fw)\s*:/i.test(raw))
    add(
      'subject_fake_reply',
      2.5,
      'The subject starts like a reply or a forward ("RE:", "FW:") though it is neither.'
    )
  const spam = spamPhrases.filter((p) => phrase(subject, p))
  if (spam.length)
    add(
      'subject_spam_words',
      Math.min(3, 1.5 * spam.length),
      `The subject has ${spam.length === 1 ? 'a word' : `${spam.length} words`} that read${spam.length === 1 ? 's' : ''} as spam.`
    )
  if (/[$€£]{2,}|\bfree\b.*[$€£]|[$€£].*\bfree\b/i.test(subject))
    add(
      'subject_money',
      1.5,
      'The subject leans on money signs or "free" with a price.'
    )
  return hits
}

export function spamScore(
  email: { subject: string; preheader: string; html: string },
  store: SpamStore = {}
): SpamScore {
  const own = store.text ?? []
  const hits: SpamHit[] = subjectHits(email.subject, own)
  const add = (rule: SpamRule, points: number, problem: string) =>
    hits.push({ rule, points, problem })

  // The body as a reader sees it, with the preview line.
  const body = bodyOf(email.html, email.preheader)
  const text = masked(
    `${drawnText(email.preheader)} ${drawnText(body)}`.trim(),
    own
  )
  const spam = spamPhrases.filter((p) => phrase(text, p))
  if (spam.length)
    add(
      'body_spam_words',
      Math.min(2.4, 0.8 * spam.length),
      `The email has ${spam.length === 1 ? 'a word' : `${spam.length} words`} that read${spam.length === 1 ? 's' : ''} as spam.`
    )
  const loud = capitalWords(text)
  if (loud.words >= 20 && loud.loud / loud.words >= 0.3)
    add(
      'body_capitals',
      1.5,
      'Much of the email is in capitals: write it normally.'
    )
  const exclaims = (text.match(/!/g) ?? []).length
  if (exclaims >= 4)
    add(
      'body_exclaims',
      exclaims >= 8 ? 2 : 1,
      `The email has ${exclaims} exclamation marks.`
    )

  // Pictures against words: an email that is nearly all pictures (its
  // logo is no picture here).
  const name = drawnText(store.name ?? '').toLowerCase()
  const pictures = [...body.matchAll(/<img\b[^>]*>/gi)].filter(
    ([tag]) => !name || drawnText(attrOf(tag, 'alt')).toLowerCase() !== name
  ).length
  const words = wordCount(drawnText(body))
  if (pictures && words < 12)
    add(
      'mostly_pictures',
      2.5,
      'The email is nearly all pictures: filters trust an email with its words as text.'
    )
  else if (pictures >= 3 && words < 25)
    add(
      'mostly_pictures',
      1.5,
      'The email has few words outside its pictures: filters trust an email with its words as text.'
    )

  // Links.
  const links = [...body.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map(
    (m) => ({ href: attrOf(m[0], 'href'), words: drawnText(m[2]!).trim() })
  )
  const hosts = links.flatMap(({ href }) => {
    const host = hostOf(href)
    return host ? [host] : []
  })
  if (hosts.some((h) => shorteners.some((s) => sameSite(h, s))))
    add(
      'short_link',
      2.5,
      'A link goes through a link shortener: link to the page itself.'
    )
  if (hosts.some((h) => /^\d{1,3}(?:\.\d{1,3}){3}$|^\[[0-9a-f:]+\]$/i.test(h)))
    add(
      'address_link',
      3,
      'A link goes to a bare number address, not a site name.'
    )
  const storeHosts = (store.hosts ?? []).map((h) => h.toLowerCase())
  const elsewhere = links.filter(({ href, words }) => {
    const named = addressWords.exec(words)?.[1]?.toLowerCase()
    const host = hostOf(href)
    return (
      !!named &&
      !!host &&
      !sameSite(named, host) &&
      !storeHosts.some((h) => sameSite(h, host)) &&
      words.toLowerCase() !== name
    )
  }).length
  if (elsewhere)
    add(
      'link_words_elsewhere',
      2.5,
      `${elsewhere === 1 ? 'A link’s words name' : `${elsewhere} links’ words name`} one site but ${elsewhere === 1 ? 'it goes' : 'they go'} to another.`
    )
  const hidden = hiddenWords(body)
  if (hidden)
    add(
      'hidden_words',
      2,
      `${hidden === 1 ? 'Some words are' : `Words in ${hidden} places are`} hidden or too small to read.`
    )
  if (links.length > 40)
    add('many_links', 1, `The email has ${links.length} links.`)
  const sites = new Set(hosts.map(bare)).size
  if (sites > 6)
    add('many_sites', 1, `The email links to ${sites} different sites.`)

  return { score: total(hits), hits }
}

const total = (hits: readonly SpamHit[]) =>
  Math.round(hits.reduce((s, h) => s + h.points, 0) * 10) / 10

/**
 * Whether a second subject (the lab's B, PIC-26) keeps the email under the
 * limit: the email's score with B's subject rules in place of its own.
 */
export function subjectBPasses(
  result: SpamScore,
  subjectB: string,
  own: readonly string[] = []
) {
  const body = result.hits.filter((h) => !h.rule.startsWith('subject_'))
  return total([...body, ...subjectHits(subjectB, own)]) < spamLimit
}

/**
 * The hard check's sentence for a score at the limit or more, else null:
 * the score and the rules that cost most, in fixed words (never the
 * email's own).
 */
export function spamProblem(result: SpamScore): string | null {
  if (result.score < spamLimit) return null
  const worst = [...result.hits]
    .sort((a, b) => b.points - a.points)
    .slice(0, 3)
    .map((h) => h.problem)
  return `The email scores ${result.score} on the spam check (${spamLimit} fails): ${worst.join(' ')}`
}
