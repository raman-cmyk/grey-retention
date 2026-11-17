import { hiddenChars, oneLine } from '@/features/assembly/assemble'
import type {
  AssemblyInput,
  ConfirmedPhoto,
  ConfirmedReview
} from '@/features/assembly/inputs'
import { hostOf } from '@/features/brand-profile/mismatch'
import { checkCopy, type BrandFacts } from '@/features/copy-qa/check'
import {
  phrase,
  spamPhrases,
  strayPrices,
  typedLink
} from '@/features/email-build/inspect'
import { onDomain } from '@/lib/providers/ad-library'
import { bodyWords, namesSomeone, resultWords } from './customer-words'
import type { Finding } from './findings'
import { firstPerson } from './site/founder'
import { emailPhotoUrl, photoKey } from './site/photos'
import { claims } from './words'

/**
 * REL-ONB2 part a: the store's own reviews for the review strip of
 * "Create email", only from what its Reviews reader kept. Never written by
 * AI, never the sample's for a real store (a live workspace never counts a
 * sample-rules finding), never from another website than the store's own
 * (or one of its subdomains):
 *
 * - The reviews an email may quote, chosen by code (`quotable_review`,
 *   ONB-105), with their own stars, their exact words (at most `maxQuote`
 *   characters, never cut) and the reviewer's first name and last initial
 *   (`reviewerName`), best rated and newest first, at most 3.
 * - With or without a verified review source (REL-ONB2 part b, the
 *   owner's rule of 16 November: from the store's own sources only,
 *   nothing invented): each review is the store's own words with its own
 *   stars, so the strip may show them. Copy QA's `reviewsVerified` still
 *   guards ratings and counts anywhere else ("4.9 from 2,000 reviews"),
 *   and the Brand inspector lets only the strip's own stars through.
 * - Never a quote naming someone (another customer, a member of staff, the
 *   reviewer themself: `namesIn`), never spam words, and every word judged
 *   by copy QA at least as strictly as the Brand inspector will judge the
 *   email (`safe`), so the inspector never meets a review it cannot fix.
 *   The name check reads English-style capitals: it drops honest reviews
 *   too, and still misses a first name that starts a sentence before a
 *   verb it cannot tell ("Emily gave it to me.").
 *
 * - A lifestyle photo (`hero_image`, part c): the first lifestyle photo
 *   the Site reader kept from the store's current website (ONB-059b, page
 *   order) that an email can show (`emailPhotoUrl`) and that is no catalog
 *   picture (`photoKey`: any size of one), described by its own words when
 *   they pass as the store's, else by the brand's name. Never for a sample
 *   workspace (no live read kept it), never made up.
 *
 * - The founder's own note (`founder_note`, part d2): the newest note the
 *   Site reader kept from the store's About page as whole sentences of the
 *   page in its own letters (`whole`, part d1), in the first person, with
 *   the founder's plain name and the role the page writes; its words judged
 *   as the reviews' are (`safe`), with no offer word or price, naming no
 *   one but the founder. Never for a sample workspace, never made up.
 *
 * Not here: customer photos (`ugc_grid`; no reader keeps customers' own
 * photos, and a brand photo is never one). A block whose material is
 * absent stays disallowed (`allowedBlockTypes`).
 */

/** The longest review quoted, in characters (a longer one is left out). */
export const maxQuote = 200
/** Findings at least this sure are used, as the facts' own (`brand-facts.ts`). */
const minConfidence = 0.6

export type Material = NonNullable<AssemblyInput['confirmed']>

export type MaterialParts = {
  brandName: string
  /** The store's website, lower case, without `www.`. */
  host: string
  /** True for a workspace read live: a sample-rules finding never counts. */
  live: boolean
  findings: readonly Finding[]
  facts: BrandFacts
  /** The catalog's titles: capitalised words a quote may use (never a name). */
  productNames: readonly string[]
  /** The catalog's pictures: never a lifestyle photo (part c). */
  catalogImages?: readonly string[]
  /** The Site reader's photos of this same website, in page order. */
  photos?: readonly SitePhotoRow[]
}

/** A photo the Site reader kept (`brand_photos`). */
export type SitePhotoRow = {
  url: string
  kind: string
  alt: string | null
  /** Where on the page: `schema`, `share` (a social card) or `page`. */
  source?: string
}

/** The longest photo description kept (the hero block's own limit). */
const maxAlt = 160

/**
 * Words that say a price, a discount or an offer: a photo described so
 * most likely has them drawn into it, where copy QA cannot read them, so
 * it never heads an email (VISION rule 6; the block catalog: pictures carry
 * no text).
 */
const offerWords =
  /[$€£¥₹%]|\b\d+\s*(?:percent|per\s*cent)\b|\b(?:sale|sales|discount\w*|off|deal|deals|offer\w*|promo\w*|coupon\w*|code|free|clearance|bogo|black\s+friday|cyber\s+monday|save|savings)\b/i

/** A description that is a file's or a widget's name, not words. */
const notWords = (text: string) =>
  /\.(?:jpe?g|png|webp|gif|avif|svg)$/i.test(text) ||
  /[_/\\]/.test(text) ||
  /^(?:img|dsc|image|photo|banner|slide|hero)[\s-]*\d*$/i.test(text) ||
  text.split(/\s+/).length < 2

/** Store words as they are: one line, no markup, link, price or hidden character. */
const clean = (text: string) =>
  text.length > 0 &&
  text === oneLine(text, 2_000) &&
  !hiddenChars.test(text) &&
  !/[{}<>[\]\\]/.test(text) &&
  !typedLink.test(text) &&
  strayPrices(text, new Set()).length === 0

/** Each sentence on its own: its first word is capitalised as any sentence's. */
const sentences = (text: string) =>
  text.split(/(?<=[.!?…])\s+/).filter((s) => s.trim())

/**
 * Ordinary first words of a review's sentence: never a name, even before
 * a comma, a place word or a verb ("Lovely, soft knit.", "Quality feels
 * great.", "Warm in the wind."). Words ending in -ing or -ed (5 letters
 * or more) count too ("Ordered", "Amazing").
 */
const starters = new Set(
  (
    "a an the this that these those it its it’s it's they them their there here my our your his her she he we you me " +
    'so very really just such too also and but or then now well yes no oh wow ok okay overall honestly ' +
    'absolutely definitely seriously totally truly highly only simply sadly unfortunately finally initially usually ' +
    'actually literally personally lovely great perfect gorgeous beautiful stunning brilliant excellent fantastic ' +
    'awesome amazing super nice good fine cute pretty soft warm cosy cozy comfy comfortable light heavy thick thin ' +
    'quick fast slow small big large long short true happy pleased glad delighted impressed love loved best better ' +
    'first second next last again bought made wore wear worn fits fit got took came arrived ' +
    'colour color quality fabric material wool cotton knit yarn size sizing delivery shipping postage packaging ' +
    'package parcel order item product price design style stitching seams sleeves length everything nothing mine ' +
    'one both all each every some most many'
  ).split(' ')
)
const ordinary = (word: string) =>
  starters.has(word.toLowerCase()) ||
  (Array.from(word).length >= 5 && /(?:ing|ed)$/i.test(word))

/**
 * Someone named in a sentence of a review: customer words' own check
 * (`namesSomeone`: a capitalised word after the first, thanks, a first
 * word doing something), and a capitalised first word that is no ordinary
 * one, "I" or a name the store allows, when a comma, a place word or a verb
 * follows it ("Priya, my neighbour…", "Tom at the stall…", "Linda adores…").
 */
function namesIn(sentence: string, names: readonly string[]) {
  const s = sentence.trim()
  const lead = /^(["“‘']?)([\p{L}\p{M}'’-]+)(.*)$/su.exec(s)
  const own = names.some((n) => n.trim().length > 1 && s.startsWith(n.trim()))
  if (!lead || own || !/^\p{Lu}/u.test(lead[2]!)) return namesSomeone(s, names)
  const [, mark = '', first = '', rest = ''] = lead
  // An ordinary first word is lowered, so only the words after it count.
  if (/^I(?:'|’|$)/.test(first) || ordinary(first))
    return namesSomeone(`${mark}${first.toLowerCase()}${rest}`, names)
  return (
    /^\s*,/.test(rest) ||
    /^\s+(?:at|from|in|of|with)\b/i.test(rest) ||
    /^\s+\p{Ll}+(?:s|ed)\b/u.test(rest) ||
    namesSomeone(s, names)
  )
}

/**
 * Words an email may show as the store's: clean, no claim, result, effect
 * on the body (what customers' words never say either, ONB-061), spam
 * word or anyone's name (the brand's and its products' aside), and passed
 * by copy QA with the store's facts. Copy QA masks nothing here (no
 * product title, no brand name): the Brand inspector masks only the
 * products an email places, so this is at least as strict as it is.
 * Over-blocking is the safer mistake.
 */
const safe = (
  text: string,
  parts: MaterialParts,
  judged = text,
  /** More names the words may use (the founder's own, in their note). */
  own: readonly string[] = []
) =>
  clean(text) &&
  !claims.test(text) &&
  !resultWords.test(text) &&
  !bodyWords.test(text) &&
  !spamPhrases.some((s) => phrase(text, s)) &&
  !sentences(text).some((s) =>
    namesIn(own.length ? ungreeted(s) : s, [
      parts.brandName,
      ...parts.productNames,
      ...own
    ])
  ) &&
  checkCopy({
    draft: {
      subject: '',
      preview: '',
      blocks: [{ id: 'material', text: judged }]
    },
    facts: parts.facts,
    // No offer: a percent in a review is never the email's.
    maxDiscountPercent: null,
    codes: [],
    productNames: [],
    sendAt: '2026-01-01T00:00:00.000Z'
  }).pass

type Quoted = Finding & {
  evidence: Extract<Finding['evidence'], { quote: string }>
}
/** A finding this store may use: sure, of its kind of read, quoting its own website. */
const counts = (f: Finding, parts: MaterialParts): f is Quoted =>
  f.confidence >= minConfidence &&
  !(parts.live && f.pass === 'sample') &&
  'quote' in f.evidence &&
  onDomain(hostOf(f.evidence.url), parts.host)

const nameWord = /^\p{L}[\p{L}\p{M}'’-]*\.?$/u
const title = /^(?:dr|mr|mrs|ms|miss|mx|prof|sir|dame)\.?$/i
/**
 * Words that are no name: a placeholder, a place or a pair ("from Leeds",
 * "Kate and Sam") or a suffix ("Jr.", "III", "PhD", "MD"): its letter is no
 * initial.
 */
const noOne =
  /(?<![\p{L}\p{M}])(?:verified|anonymous|anon|customer|buyer|reviewer|shopper|user|guest|team|admin|store|shop|from|in|and|of|at|with|by|for|the|jr|sr|ii|iii|iv|vi|phd|md|dds|dmd|dvm|rn|cpa|esq|mba|jd)(?![\p{L}\p{M}])/iu
/** A last "V" after a surname is a fifth, not an initial ("John Smith V"). */
const fifth = /^v\.?$/i

/**
 * A reviewer as an email names them: the first name and the initial of
 * the last ("Jordan Smith" is "Jordan S.", "Dr. Jane Smith" is "Jane S."),
 * a one-word name as it is. Null when it reads as no one's, names a place
 * or two people, carries a suffix or holds more than letters: the review
 * is then left out, since an email never makes a name up.
 */
export function reviewerName(author: string): string | null {
  const all = author.trim().split(/\s+/)
  // A title is no first name.
  const words = all.length > 1 && title.test(all[0]!) ? all.slice(1) : all
  if (
    title.test(words[0]!) ||
    words.length > 4 ||
    noOne.test(author) ||
    (words.length >= 3 && fifth.test(words.at(-1)!)) ||
    !words.every((w) => nameWord.test(w)) ||
    Array.from(words[0]!).length > 30
  )
    return null
  if (words.length === 1) return words[0]!
  const initial = Array.from(words.at(-1)!)[0]!.toLocaleUpperCase()
  return `${words[0]} ${initial}.`
}

/** The reviewer's own name in their words ("Jordan here, …"). */
const signs = (quote: string, author: string) =>
  author
    .split(/\s+/)
    .map((w) => w.replace(/\.$/, ''))
    .filter((w) => Array.from(w).length >= 2 && !title.test(w))
    .some((w) => phrase(quote, w))

function reviews(parts: MaterialParts): ConfirmedReview[] {
  const seen = new Set<string>()
  return parts.findings
    .flatMap((f) => {
      if (f.topic !== 'quotable_review' || f.source !== 'reviews') return []
      if (!counts(f, parts)) return []
      const value = f.value as {
        author: string
        rating?: number
        date?: string
      }
      const quote = f.evidence.quote
      const author = reviewerName(value.author)
      // The strip shows stars: a review without its own is never given some.
      if (!author || value.rating === undefined) return []
      if (Array.from(quote).length > maxQuote || signs(quote, value.author))
        return []
      // Judged as the Brand inspector will (`copyDraftOf`: the name too).
      // The strip's own stars are the review's, never a claim (they pass
      // the inspector; `brandCopyDraft`), so they are not judged here.
      const shown = `${quote}\n${author}`
      if (!safe(quote, parts, shown) || claims.test(author)) return []
      const review = { quote, author, rating: value.rating }
      return [{ review, date: value.date ?? '' }]
    })
    .sort(
      (a, b) =>
        b.review.rating - a.review.rating ||
        b.date.localeCompare(a.date) ||
        a.review.quote.localeCompare(b.review.quote)
    )
    .filter(({ review }) => {
      const key = review.quote.toLowerCase()
      return !seen.has(key) && !!seen.add(key)
    })
    .slice(0, 3)
    .map(({ review }) => review)
}

/**
 * A note's sentence without its greeting ("Hi, I'm Maya…" is read as
 * "I'm Maya…"), so a greeting is never taken for a name; a name after it
 * still is ("Hi Tom, …" leaves "Tom, …").
 */
const ungreeted = (sentence: string) =>
  sentence.replace(/^(["“‘']?)(?:hi|hello|hey)(?:[,!.]\s*|\s+(?=I\b))/iu, '$1')

/**
 * A founder as an email signs them: one person's plain name, as the page
 * writes it (no digit, @, link or sign; at most 4 words; never the brand,
 * a product, a team or a pair), else null.
 */
function founderName(name: string, parts: MaterialParts): string | null {
  const n = name.trim()
  const words = n.split(/\s+/)
  const store = [parts.brandName, ...parts.productNames].map((t) =>
    t.trim().toLowerCase()
  )
  return clean(n) &&
    Array.from(n).length <= 60 &&
    !/[\p{N}@]/u.test(n) &&
    words.length <= 4 &&
    words.every((w) => nameWord.test(w)) &&
    !title.test(words.at(-1)!) &&
    !noOne.test(n) &&
    !claims.test(n) &&
    !store.includes(n.toLowerCase())
    ? n
    : null
}

/**
 * The founder's own note (part d2): the newest the Site reader kept as
 * whole sentences of the store's About page (`whole: true`, part d1), sure
 * as a fact, of a live read. Its words are the founder's, so they are
 * judged and never changed: refused when they say an offer or a price
 * (`offerWords`, `strayPrices`), name anyone but the founder (`namesIn`,
 * the founder's own name words allowed) or fail what the reviews must pass
 * (`safe`, judged with the name and role as the block shows them). A role
 * that would not pass is left out; a name that is no plain name leaves the
 * note out.
 */
function founder(parts: MaterialParts): Material['founder'] {
  if (!parts.live) return undefined
  const notes = parts.findings
    .filter(
      (f): f is Quoted =>
        f.topic === 'founder' &&
        f.source === 'site' &&
        f.pass !== 'sample' &&
        counts(f, parts) &&
        f.evidence.whole === true &&
        f.evidence.page === 'about'
    )
    // Newest first (`listFindings`' order kept between notes of one read).
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
  for (const f of notes) {
    const value = f.value as { name: string; role?: string }
    const name = founderName(value.name, parts)
    const note = f.evidence.quote.trim()
    if (
      !name ||
      !note ||
      Array.from(note).length > 600 ||
      !firstPerson(note, name) ||
      offerWords.test(note) ||
      strayPrices(note, new Set()).length > 0
    )
      continue
    const own = [
      name,
      ...name.split(/\s+/).filter((w) => Array.from(w).length >= 2)
    ]
    const r = (value.role ?? '').trim()
    const role =
      r &&
      Array.from(r).length <= 60 &&
      !offerWords.test(r) &&
      safe(r, parts, r, own)
        ? r
        : undefined
    const shown = [note, name, ...(role ? [role] : [])].join('\n')
    if (!safe(note, parts, shown, own)) continue
    return { name, ...(role ? { role } : {}), note: [note] }
  }
  return undefined
}

/** Any size of the same picture is one picture; a bad address is its own. */
const keyOf = (url: string) => {
  try {
    return photoKey(url)
  } catch {
    return url
  }
}

/**
 * The first lifestyle photo of the store's own pages an email may show:
 * never a social card (`share`: often a logo or text graphic), a catalog
 * picture or a picture on another website's host than the store's own or
 * its catalog's, and never one described with a price, a discount or an
 * offer (`offerWords`, or what copy QA's own facts refuse). Its own words
 * describe it when they pass as the store's; the brand's name when they
 * are empty, too long, a file's name or a person's name.
 */
function lifestylePhoto(parts: MaterialParts): ConfirmedPhoto | undefined {
  if (!parts.live) return undefined
  const catalogImages = parts.catalogImages ?? []
  const catalog = new Set(catalogImages.map(keyOf))
  // The store's own hosts, and those its catalog pictures already use.
  const catalogHosts = new Set(catalogImages.map(hostOf).filter(Boolean))
  const ownHost = (url: string) => {
    const host = hostOf(url)
    return !!host && (onDomain(host, parts.host) || catalogHosts.has(host))
  }
  const name = parts.brandName.trim()
  const brandAlt =
    name && Array.from(name).length <= maxAlt && safe(name, parts) ? name : ''
  for (const p of parts.photos ?? []) {
    if (p.kind !== 'lifestyle' || p.source === 'share') continue
    if (!emailPhotoUrl(p.url) || !ownHost(p.url)) continue
    if (catalog.has(keyOf(p.url))) continue
    const own = (p.alt ?? '').trim()
    // A price or an offer in its words: one drawn in it, never a hero.
    if (offerWords.test(own) || strayPrices(own, new Set()).length > 0) continue
    const alt =
      own &&
      Array.from(own).length <= maxAlt &&
      !notWords(own) &&
      safe(own, parts)
        ? own
        : brandAlt
    if (alt) return { image: p.url, alt }
  }
  return undefined
}

/** The store's material, or undefined when it has none. Pure. */
export function storeMaterial(parts: MaterialParts): Material | undefined {
  const quoted = reviews(parts)
  const photo = lifestylePhoto(parts)
  const note = founder(parts)
  const material: Material = {
    ...(quoted.length ? { reviews: quoted } : {}),
    ...(photo ? { lifestylePhoto: photo } : {}),
    ...(note ? { founder: note } : {})
  }
  return Object.keys(material).length ? material : undefined
}
