import type { EmailSection } from './sections'

/**
 * What one competitor email says, in a fixed shape (INB-003 "micro"
 * facts): subject, preview, offer, angle, call to action, send time,
 * block sequence and text:design share. Worked out from the email itself,
 * without AI, so the same email always gives the same facts.
 */

export const factsVersion = 1

export const angles = [
  'restock',
  'seasonal',
  'launch',
  'sale',
  'bestseller',
  'social_proof',
  'story',
  'education',
  'bundle',
  'other'
] as const
export type Angle = (typeof angles)[number]

export type Offer = {
  kind: 'percent' | 'amount' | 'bogo' | 'gift' | 'free_shipping' | 'none'
  /** Percent or money off, when there is a number. */
  value: number | null
  code: string | null
}

export type EmailFacts = {
  version: typeof factsVersion
  subject: string
  preview: string | null
  offer: Offer
  angle: Angle
  cta: string | null
  /** When it arrived (UTC); shown in the reader's brand timezone. */
  sentAt: string
  blockSequence: string[]
  textRatio: number | null
  sections: number
}

/** Keyword rules, checked in this order (a restock beats a sale). */
const angleRules: [Angle, RegExp][] = [
  ['restock', /back in stock|restock|back again|is back\b/],
  [
    'seasonal',
    // A season on its own ("Summer linen") is seasonal; a "spring sale" is
    // a sale and "fall in love" is not about autumn.
    /black friday|cyber monday|\bbfcm\b|christmas|holiday|valentine|mother'?s day|father'?s day|halloween|easter|new year|labou?r day|memorial day|\b(spring|summer|autumn|winter)\b(?! sale)|\bthis fall\b|\bfall (collection|edit|lookbook|styles?|layers|essentials|wardrobe)\b/
  ],
  [
    'launch',
    /new arrivals?|just (dropped|landed|launched)|introducing|new collection|meet (the|our) (new|latest)|now available|\blaunch|new in\b|first look/
  ],
  [
    'sale',
    /\bsale\b|% off|\bsave\b|discount|\bdeal|clearance|last chance|ends (tonight|today|soon)|final hours/
  ],
  [
    'bestseller',
    /best ?sellers?|best-selling|most loved|fan favou?rites?|top rated|customer favou?rites?/
  ],
  ['social_proof', /reviews?\b|customers (say|love)|testimonial|★|rated \d/],
  [
    'story',
    /our story|founder|behind the scenes|why we|how we make|letter from|meet (our|the) (team|maker|makers|founders?)\b|meet our/
  ],
  [
    'education',
    /how to|\bguide\b|\btips\b|ways to|tutorial|\b101\b|step by step/
  ],
  [
    'bundle',
    /\bbundles?\b|\b(gift|starter|travel|matching|bundle) sets?\b|\bsets? of \d|\bkits?\b|pack of/
  ]
]

export function angleOf(words: string): Angle {
  const text = words.toLowerCase()
  return angleRules.find(([, rule]) => rule.test(text))?.[0] ?? 'other'
}

/** Capital words after "code" or "use" that are not a code. */
const notCodes = new Set([
  'ALL',
  'AND',
  'ANY',
  'AT',
  'BELOW',
  'CHECKOUT',
  'CODE',
  'FOR',
  'FREE',
  'HERE',
  'NOW',
  'OFF',
  'OUR',
  'THE',
  'THIS',
  'TODAY',
  'YOUR'
])

/** A discount code: in capitals, after "code" or "use" (any case). */
export function codeOf(words: string) {
  for (const m of words.matchAll(
    // The word after is read ahead, so "Use code X" also tries "code X".
    /\b(?:code|use)\b(?=\s*:?\s*["“'‘]?([A-Za-z][A-Za-z0-9]{2,19})\b)/gi
  )) {
    const code = m[1]!
    if (code === code.toUpperCase() && !notCodes.has(code)) return code
  }
  return null
}

/** The strongest offer in the words: percent, money off, BOGO, gift, shipping. */
export function offerOf(words: string): Offer {
  const percents = [
    ...words.matchAll(
      /(?<![\d.])(\d{1,2})\s?%\s?(?:off|discount)|save\s(?:up to\s)?(?<![\d.])(\d{1,2})\s?%/gi
    )
  ].map((m) => Number(m[1] ?? m[2]))
  const amounts = [
    ...words.matchAll(/[$£€]\s?(\d{1,4})\s?off|save\s[$£€]\s?(\d{1,4})/gi)
  ].map((m) => Number(m[1] ?? m[2]))
  const code = codeOf(words)
  if (percents.length)
    return { kind: 'percent', value: Math.max(...percents), code }
  if (amounts.length)
    return { kind: 'amount', value: Math.max(...amounts), code }
  if (/buy one,? get one|\bbogo\b|\bb1g1\b|2 for 1/i.test(words))
    return { kind: 'bogo', value: null, code }
  if (/free gift|gift with (any )?purchase|\bgwp\b/i.test(words))
    return { kind: 'gift', value: null, code }
  if (/free (shipping|delivery)/i.test(words))
    return { kind: 'free_shipping', value: null, code }
  return { kind: 'none', value: null, code }
}

const notCta =
  /unsubscribe|preferences|view (it )?in (your )?browser|privacy|terms|^$/i
const ctaWords =
  /\b(shop|buy|get|discover|explore|read|learn|see|order|claim|grab|start|book|try|browse|find|unlock|save)\b/i

/**
 * Sections that are the same on every email (the top bar, the logo and
 * its menu, the footer): their offer and links are not this email's.
 */
const standing = new Set(['announcement_bar', 'header_logo', 'footer'])

/**
 * The email's own sections. Without labels, a short first section is
 * taken as the standing bar ("Free shipping over $50").
 */
function ownSections(sections: EmailSection[], types: string[]) {
  return types.length === sections.length
    ? sections.filter((_, i) => !standing.has(types[i]!))
    : sections.filter((s, i) => !(i === 0 && s.words <= 15))
}

/** The main button: the first short action link outside the bar, menu and footer. */
export function ctaOf(sections: EmailSection[], types: string[] = []) {
  for (const s of ownSections(sections, types))
    for (const link of s.links) {
      const text = link.text.trim()
      const words = text.split(/\s+/).length
      if (!notCta.test(text) && words <= 5 && ctaWords.test(text)) return text
    }
  return null
}

export function emailFacts(input: {
  subject: string
  preview: string | null
  sections: EmailSection[]
  sentAt: string
  blockSequence: string[]
  textRatio: number | null
}): EmailFacts {
  const { subject, preview, sections, blockSequence } = input
  const body = ownSections(sections, blockSequence)
    .map((s) => s.text)
    .join(' ')
  const head = `${subject} ${preview ?? ''}`
  const fromHead = offerOf(head)
  const offer = fromHead.kind !== 'none' ? fromHead : offerOf(body)
  return {
    version: factsVersion,
    subject,
    preview,
    offer,
    angle: angleOf(`${head} ${body.slice(0, 600)}`),
    cta: ctaOf(sections, blockSequence),
    sentAt: input.sentAt,
    blockSequence: input.blockSequence,
    textRatio: input.textRatio,
    sections: sections.length
  }
}
