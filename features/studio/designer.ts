import { parseFragment } from 'parse5'
import type { DefaultTreeAdapterTypes as T } from 'parse5'
import { z } from 'zod'
import { hiddenChars } from '@/features/assembly/assemble'
import type { BlockBrand } from '@/features/blocks/brand'
import type { BuildMode } from '@/features/email-build/sections'
import type { EmailType } from '@/features/strategy/plan'
import { readCss } from './css'
import { sectionProblems, sectionUrls, type DesignedSection } from './section'
import { designable, type StoryboardSection, type Tone } from './storyboard'

/**
 * DST-003 (D25, AGENT_MAP §4 layer 3, step 2): the Section designer draws
 * each designed section of the storyboard (DST-002) freely in HTML and
 * CSS, like a Figma designer: the brand's colours and fonts, overlaps,
 * gradients, the real photo placed and cropped. It designs the picture
 * only; the hero's button stays live HTML beside it.
 *
 * All words come from layer 2 (the copy): the picture may draw the
 * section's eyebrow, headline and short line, the product's name and the
 * brand's name, each whole, and nothing else (no price, code, percent,
 * button or made-up word, and never words through CSS). The headline is
 * always drawn, and the picture's alt text is the words it draws, so the
 * email still reads with pictures off. It places only the photo it is
 * given (never another picture, never an invented product) and loads
 * only the brand's web fonts.
 *
 * Code checks every answer (`designProblems`: the section format's own
 * checks first, DST-001a, and its styles read as a browser reads them,
 * DST-003a), sends its problems back, three tries; a section that still
 * fails is drawn as its coded block (logged, D16). Reading the markup
 * cannot see what is drawn: text hidden, clipped, covered or tiny, and
 * letters drawn as shapes, are for the critic, who reads the drawn
 * picture (DST-004).
 */

export type SectionBrief = {
  mode: BuildMode
  slot: { emailType: EmailType; angle: string }
  /** The storyboard's section; only a `designed` one is designed. */
  board: StoryboardSection
  family: (typeof designable)[number]
  /** Layer 2's words for it: the only words the picture may draw. */
  words: { eyebrow?: string; headline: string; sub?: string }
  /** The one photo it places (https): the product's, or the store's own. */
  image: { url: string; alt?: string }
  /** The product it shows (a product hero). */
  product?: { title: string }
  brand: Pick<
    BlockBrand,
    'name' | 'font' | 'ink' | 'background' | 'accent' | 'dark' | 'radius'
  >
  /** Web fonts it may load (the brand's real fonts, pick #3); none yet. */
  fonts: { family: string; url: string; weight?: number; italic?: boolean }[]
  /** Copy mode: the reference section's tone and height. */
  reference?: { tone: Tone; height: number }
}

const maxHtml = 16_000
const maxCss = 8_000

/** The Section designer's answer (checked by zod). */
export const designAnswer = z.strictObject({
  html: z.string().min(1).max(maxHtml),
  css: z.string().max(maxCss)
})
export type DesignAnswer = z.infer<typeof designAnswer>

/** At most `n` UTF-16 units, never half a character (the database refuses one). */
const cut = (text: string, n: number) =>
  text.slice(0, n).replace(/[\uD800-\uDBFF]$/, '')

/** Inline elements: no word break between them and their neighbours. */
const inline = new Set('span strong em b i u s small sup sub tspan'.split(' '))
/** SVG attributes that place text; more than one number places it letter by letter. */
const placing = new Set(['x', 'y', 'dx', 'dy', 'rotate'])
const lists = new Set(['ol', 'ul', 'li'])
const svgNs = 'http://www.w3.org/2000/svg'

/**
 * What a section's markup draws and holds: its text in document order,
 * read two ways (inline elements joining their neighbours' words, and
 * every element apart), the alt texts of its pictures (drawn when one
 * fails to load), its inline styles, the photos it places (`<img>`, SVG
 * `<image>`), the font families SVG names, and what draws text the
 * checks cannot read: a numbered list or list type, an SVG title or
 * description holding elements (a `<use>` can draw them), and SVG text
 * placed letter by letter.
 */
export function readMarkup(html: string) {
  const glued: string[] = []
  const apart: string[] = []
  const alts: string[] = []
  const styles: string[] = []
  const placed: string[] = []
  const families: string[] = []
  let numbered = false
  let hidden = false
  let lettered = false
  const walk = (node: T.ParentNode) => {
    for (const child of node.childNodes) {
      if (child.nodeName === '#text') {
        glued.push((child as T.TextNode).value)
        apart.push((child as T.TextNode).value)
        continue
      }
      if (!('tagName' in child)) continue
      const el = child as T.Element
      const tag = el.tagName.toLowerCase()
      const svg = el.namespaceURI === svgNs
      let line = false
      for (const a of el.attrs) {
        const name = a.name.toLowerCase()
        if (name === 'style') styles.push(a.value)
        if (name === 'alt' && tag === 'img') alts.push(a.value)
        if (name === 'src' && tag === 'img') placed.push(a.value.trim())
        if (name === 'href' && svg && tag === 'image')
          placed.push(a.value.trim())
        if (name === 'type' && !svg && lists.has(tag)) numbered = true
        if (name === 'font-family' && svg) families.push(a.value)
        if (svg && placing.has(name)) {
          if (a.value.trim().split(/[\s,]+/).length > 1) lettered = true
          if (tag === 'tspan' && name !== 'dx' && name !== 'rotate') line = true
        }
      }
      if (tag === 'ol') numbered = true
      if (svg && (tag === 'title' || tag === 'desc')) {
        // Not drawn, unless it holds elements a `<use>` can draw.
        if (el.childNodes.some((c) => 'tagName' in c)) hidden = true
        continue
      }
      const gap = inline.has(tag) && !line ? '' : ' '
      glued.push(gap)
      apart.push(' ')
      walk(el)
      glued.push(gap)
      apart.push(' ')
    }
  }
  walk(parseFragment(html))
  const raw = glued.join('')
  const flat = (s: string) => s.replace(/\s+/g, ' ').trim()
  return {
    raw,
    text: flat(raw),
    apart: flat(apart.join('')),
    alts,
    styles,
    placed,
    families,
    numbered,
    hidden,
    lettered
  }
}

/** Marks at a word's edges that change no meaning (and lone dashes, dots and bars). */
const edges =
  /^[\s.,!?:;…"'“”‘’()[\]–—\-•·|/]+|[\s.,!?:;…"'“”‘’()[\]–—\-•·|/]+$/g
export const tokens = (text: string) =>
  text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[‐‑]/g, '-')
    .split(/\s+/)
    .map((w) => w.replace(edges, ''))
    .filter(Boolean)

type Role = 'eyebrow' | 'headline' | 'sub' | 'product' | 'brand'
type Phrase = { role: Role; text: string }

/** The words a section may draw, each phrase whole, in the copy's order. */
export function allowedPhrases(brief: SectionBrief): Phrase[] {
  const all: [Role, string | undefined][] = [
    ['eyebrow', brief.words.eyebrow],
    ['headline', brief.words.headline],
    ['sub', brief.words.sub],
    ['product', brief.product?.title],
    ['brand', brief.brand.name]
  ]
  return all.flatMap(([role, text]) =>
    text && tokens(text).length ? [{ role, text }] : []
  )
}

type Reading = { found: Phrase[]; headline: boolean } | { stray: string }

/**
 * Reads the drawn words as a run of whole phrases, trying every way to
 * split them, and one with the headline first: the phrases found, in
 * order, or the first words no split can read.
 */
function readPhrases(drawn: string[], phrases: Phrase[]): Reading {
  const options = phrases.map((p) => ({ p, t: tokens(p.text) }))
  type Step = { p: Phrase; from: number; had: number } | 'start'
  // `back[j][h]`: how the first j words are read, h = 1 with the headline.
  const back: (Step | null)[][] = Array.from(
    { length: drawn.length + 1 },
    () => [null, null]
  )
  back[0][0] = 'start'
  for (let i = 0; i < drawn.length; i++)
    for (const h of [0, 1])
      if (back[i][h])
        for (const o of options) {
          const j = i + o.t.length
          const next = h || o.p.role === 'headline' ? 1 : 0
          if (
            j <= drawn.length &&
            !back[j][next] &&
            o.t.every((w, k) => drawn[i + k] === w)
          )
            back[j][next] = { p: o.p, from: i, had: h }
        }
  const end = back[drawn.length][1] ? 1 : back[drawn.length][0] ? 0 : null
  if (end === null) {
    let m = drawn.length
    while (!back[m][0] && !back[m][1]) m--
    return { stray: drawn.slice(m, m + 6).join(' ') }
  }
  const found: Phrase[] = []
  for (let j = drawn.length, h = end; j > 0;) {
    const step = back[j][h] as Exclude<Step, 'start'>
    found.unshift(step.p)
    j = step.from
    h = step.had
  }
  return { found, headline: end === 1 }
}

/** The best reading of a section's words: inline elements joined, or every element apart. */
function readWords(answer: DesignAnswer, brief: SectionBrief): Reading {
  const markup = readMarkup(answer.html)
  const phrases = allowedPhrases(brief)
  const joined = readPhrases(tokens(markup.text), phrases)
  if ('headline' in joined && joined.headline) return joined
  const apart = readPhrases(tokens(markup.apart), phrases)
  if ('headline' in apart && (apart.headline || !('headline' in joined)))
    return apart
  return joined
}

/** Hostnames the section may load from: its photo's and its fonts'. */
export function briefHosts(brief: SectionBrief) {
  const host = (url: string) => {
    try {
      return [new URL(url).hostname.toLowerCase()]
    } catch {
      return []
    }
  }
  return [
    ...new Set([
      ...host(brief.image.url),
      ...brief.fonts.flatMap((f) => host(f.url))
    ])
  ]
}

/** A font family list, each name unquoted, lowercased, its spaces single. */
const familyList = (list: string) =>
  list
    .split(',')
    .map((f) =>
      f
        .trim()
        .replace(/^["']|["']$/g, '')
        .replace(/\s+/g, ' ')
        .toLowerCase()
    )
    .filter(Boolean)
/** The family list at the end of a `font` shorthand, after its size. */
const shorthand =
  /^(?:.*\s)?(?:[\d.]+(?:px|em|rem|%|pt|pc|vw|vh|vmin|vmax|ch|ex|cm|mm|in|q)|xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|smaller|larger)(?:\s*\/\s*[^\s,]+)?\s+(.+)$/i

const stylesOf = (answer: DesignAnswer) => [
  readCss(answer.css),
  ...readMarkup(answer.html).styles.map((s) => readCss(s, true))
]

/** Every font family the section's styles and SVG name. */
function namedFamilies(answer: DesignAnswer) {
  const names = new Set<string>()
  for (const css of stylesOf(answer))
    for (const d of css.declarations) {
      const list =
        d.property === 'font-family'
          ? d.value
          : d.property === 'font'
            ? (shorthand.exec(d.value)?.[1] ?? '')
            : ''
      for (const f of familyList(list)) names.add(f)
    }
  for (const list of readMarkup(answer.html).families)
    for (const f of familyList(list)) names.add(f)
  return names
}

/**
 * The section as the renderer takes it: its id and height are the
 * storyboard's, and it loads the brief's web fonts its styles name.
 */
export function designedFrom(
  answer: DesignAnswer,
  brief: SectionBrief
): DesignedSection {
  const named = namedFamilies(answer)
  return {
    id: brief.board.id,
    height: brief.board.height,
    html: answer.html,
    css: answer.css,
    fonts: brief.fonts.filter((f) => named.has(familyList(f.family)[0] ?? ''))
  }
}

/** The photo is drawn: in an `<img>`, an SVG `<image>` or a background. */
function placesPhoto(answer: DesignAnswer, photo: string) {
  if (readMarkup(answer.html).placed.includes(photo)) return true
  return stylesOf(answer).some(
    (css) =>
      css.urls.includes(photo) &&
      css.declarations.some(
        (d) =>
          (d.property === 'background' || d.property === 'background-image') &&
          /url\(/i.test(d.value)
      )
  )
}

/** Code's check of one answer, in plain words; empty means it passed. */
export function designProblems(
  answer: DesignAnswer,
  brief: SectionBrief
): string[] {
  const section = designedFrom(answer, brief)
  const hosts = briefHosts(brief)
  // The section format first, its styles read by DST-003a.
  const problems = sectionProblems(section, hosts)
  if (problems.some((p) => p.endsWith('too long.'))) return problems
  const markup = readMarkup(answer.html)
  if (markup.numbered)
    problems.push(
      'A numbered list or a list type draws numbers the copy does not have.'
    )
  if (markup.hidden)
    problems.push('An SVG title or description holds plain text only.')
  if (markup.lettered)
    problems.push(
      'Place SVG text as whole lines: one x, y, dx, dy or rotate each, never letter by letter.'
    )
  const urls = sectionUrls(section, hosts)
  const fonts = new Set(section.fonts?.map((f) => f.url))
  if (urls.some((u) => u !== brief.image.url && !fonts.has(u)))
    problems.push('Place only the photo given: no other picture.')
  if (!placesPhoto(answer, brief.image.url))
    problems.push(
      brief.family === 'hero_product'
        ? 'Show the product: place the photo given (an <img> or a background).'
        : 'Show the store’s photo: place the photo given (an <img> or a background).'
    )
  if (markup.alts.some((a) => a.trim()))
    problems.push(
      'Give each <img> an empty alt (alt=""): the email gives the picture its alt text.'
    )
  if (hiddenChars.test(markup.raw.replace(/[\t\n\r ]/g, '')))
    problems.push('The words have hidden characters in them.')
  const read = readWords(answer, brief)
  if ('stray' in read)
    problems.push(
      `The picture draws “${cut(read.stray, 80)}”: draw only the words given, each whole (eyebrow, headline, short line, product name, brand name).`
    )
  else if (!read.headline) problems.push('Draw the headline, whole.')
  return [...new Set(problems)]
}

/**
 * The picture's alt text: the copy's words it draws, in the copy's order,
 * each once (the brand's name is the logo's, not the picture's).
 */
export function sectionAlt(answer: DesignAnswer, brief: SectionBrief) {
  const read = readWords(answer, brief)
  const roles = new Set(
    'found' in read ? read.found.map((p) => p.role) : ['headline']
  )
  roles.add('headline')
  const seen = new Set<string>()
  return allowedPhrases(brief)
    .filter((p) => p.role !== 'brand' && roles.has(p.role))
    .filter((p) => {
      const key = tokens(p.text).join(' ')
      return !seen.has(key) && !!seen.add(key)
    })
    .map((p) => p.text)
    .join('. ')
    .replace(/([.!?…])\./g, '$1')
}
