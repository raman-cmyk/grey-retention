/**
 * The Brand book review (UI-BRAND): what the agents read about the brand
 * (ONB-106b..d, `features/onboarding/brand-book.ts`), put in the owner's
 * words, with the three kinds kept apart as the agents are told
 * (`brandBookHeader`, `features/agents/memory.ts`):
 *
 * - **confirmed**: the facts true under every source, and the owner's own
 *   approved words;
 * - **seen**: what the readers saw on the brand's pages, emails and
 *   reviews (never a fact), and what is not clear (no claim is made);
 * - **reading**: the Brand strategist's reading of the book, an
 *   interpretation, never a fact and never above the confirmed parts.
 *
 * The stored JSON is read defensively: an older or partial book shows what
 * it has, and nothing is invented for what it lacks.
 *
 * UI-BRAND-2: the owner's corrections (ONB-058) are his own word. A line or
 * fact the book holds in his words is marked `own`; his live corrections
 * are listed in words (`corrections`), with the ones this version does not
 * hold yet (`pending`: made after it was written).
 */
import type { Correction } from '@/features/onboarding/brand-book-corrections'
import { factValue } from '@/features/onboarding/brand-book-corrections'
import { factKeys, factLabels, factText, type FactKey } from './book-facts'

export type BookRow = {
  version: number
  content: unknown
  written_by: string
  created_at: string
}

export type BookLines = { label: string; lines: string[] }

/** The parts of what the readers saw that the owner can correct. */
export const lineSections = [
  'offering',
  'customers.who',
  'customers.love',
  'customers.worries',
  'voice',
  'marketing'
] as const
export type LineSection = (typeof lineSections)[number]

/** A line of the book; `own` when it is in the owner's own words. */
export type OwnLine = { text: string; own: boolean }
export type SeenGroup = {
  label: string
  section: LineSection
  lines: OwnLine[]
}

/** One of the owner's live corrections, in words. */
export type CorrectionLine = {
  id: string
  /** The part of the book: Returns, What customers love. */
  label: string
  text: string
  /** Made after this version was written: not in it yet. */
  pending: boolean
}

export type BrandBookView = {
  version: number
  writtenAt: string
  /** Written by the Brand strategist (its version carries a reading). */
  byStrategist: boolean
  /** Rests on sample data (a sample store only). */
  sample: boolean
  brandName: string | null
  site: string | null
  /** Confirmed facts, in words; empty when none is confirmed. */
  facts: OwnLine[]
  /** Each correctable fact as the words the owner edits ('' unknown). */
  factTexts: Record<FactKey, string>
  /** The owner's approved words; null when he has not approved them. */
  owner: { label: string; text: string }[] | null
  /** Topics the sources disagree on: no claim is made about them. */
  unclear: string[]
  /**
   * What the readers saw, by part of the book: every part for the owner
   * (`allParts`, so he can add a line to an empty one), otherwise only
   * the parts with lines.
   */
  seen: SeenGroup[]
  /** How the brand sends today, from a full Klaviyo read. */
  sending: string | null
  products: {
    count: number | null
    bestsellers: string[]
    newArrivals: string[]
  }
  /** Why some claims are off limits for this kind of brand. */
  avoid: string[]
  /** Where the lines come from, in words. */
  sources: string[]
  /** The sections the owner corrected, in words. */
  corrected: string[]
  /** The owner's live corrections, oldest first. */
  corrections: CorrectionLine[]
  /** The strategist's reading; null until it has read this version. */
  reading: {
    positioning: string | null
    parts: BookLines[]
    voice: BookLines[]
    style: string | null
  } | null
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null
const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.flatMap((item) => {
        const t = text(item)
        return t ? [t] : []
      })
    : []
const count = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null
const days = (n: number) => (n === 1 ? '1 day' : `${n} days`)

const sourceWords: Record<string, string> = {
  site: 'Your website',
  catalog: 'Your Klaviyo catalog',
  klaviyo_history: 'Your past Klaviyo emails',
  ads: 'Your ads',
  reviews: 'Your reviews',
  social: 'Your social pages'
}

const topicWords: Record<string, string> = {
  free_shipping: 'Free shipping',
  returns: 'Returns',
  guarantee: 'Money-back guarantee',
  delivery_days: 'Delivery time'
}

const sectionWords: Record<string, string> = {
  offering: 'What you sell',
  'customers.who': 'Who your customers are',
  'customers.love': 'What customers love',
  'customers.worries': 'What customers worry about',
  voice: 'How you sound',
  marketing: 'What works in your marketing',
  // The database's section names (ONB-058), and the older topic names.
  'facts.freeShipping': 'Free shipping',
  'facts.returnDays': 'Returns',
  'facts.guaranteeDays': 'Money-back guarantee',
  'facts.deliveryDays': 'Delivery time',
  'facts.free_shipping': 'Free shipping',
  'facts.returns': 'Returns',
  'facts.guarantee': 'Money-back guarantee',
  'facts.delivery_days': 'Delivery time'
}

/** The confirmed facts in plain words (only those the book states). */
export function factWords(
  facts: Record<string, unknown>,
  currency: string | null
): string[] {
  const lines: string[] = []
  const shipping = facts.freeShipping
  if (shipping === 'always') lines.push('Free shipping on every order')
  else if (shipping === 'never') lines.push('No free shipping')
  else {
    const over = count(record(shipping).over)
    if (over !== null)
      lines.push(
        `Free shipping over ${over}${currency ? ` ${currency}` : ''}`.trim()
      )
  }
  const delivery = record(facts.deliveryDays)
  const min = count(delivery.min)
  const max = count(delivery.max)
  if (min !== null && max !== null)
    lines.push(
      min === max
        ? `Delivery in ${days(max)}`
        : `Delivery in ${min} to ${days(max)}`
    )
  const returns = count(facts.returnDays)
  if (returns !== null)
    lines.push(returns === 0 ? 'No returns' : `Returns within ${days(returns)}`)
  const guarantee = count(facts.guaranteeDays)
  if (guarantee !== null)
    lines.push(
      guarantee === 0
        ? 'No money-back guarantee'
        : `Money-back guarantee for ${days(guarantee)}`
    )
  if (facts.reviewsVerified === true)
    lines.push('Reviews come from a checked review source')
  return lines
}

/** The facts in the order the page lists them (as `factWords` does). */
const factOrder: readonly FactKey[] = [
  'freeShipping',
  'deliveryDays',
  'returnDays',
  'guaranteeDays'
]

/** The same line whatever its case and spacing (as the database keys it). */
const key = (line: string) => line.trim().replace(/\s+/g, ' ').toLowerCase()
const quote = (line: string | null) => `“${line ?? ''}”`

function correctionLine(
  c: Correction,
  currency: string | null,
  writtenAt: string
): CorrectionLine {
  const pending = Date.parse(c.createdAt) > Date.parse(writtenAt)
  if (c.section.startsWith('facts.')) {
    const fact = c.section.slice('facts.'.length) as FactKey
    const value =
      c.action === 'remove' ? null : factValue(fact, c.value ?? null)
    const words = value ? factWords({ [fact]: value }, currency)[0] : null
    return {
      id: c.id,
      label: factLabels[fact],
      text: words ?? 'Not known, so no email claims it',
      pending
    }
  }
  return {
    id: c.id,
    label: sectionWords[c.section] ?? c.section,
    text:
      c.action === 'add'
        ? `Added ${quote(c.value)}`
        : c.action === 'remove'
          ? `Removed ${quote(c.original)}`
          : `Changed ${quote(c.original)} to ${quote(c.value)}`,
    pending
  }
}

const lines = (label: string, value: unknown): BookLines[] => {
  const list = strings(value)
  return list.length ? [{ label, lines: list }] : []
}

/**
 * The latest Brand book in the owner's words; null when there is none.
 * `corrections` are the owner's live ones (oldest first); `allParts` shows
 * every correctable part of what was seen, empty ones too (the owner's
 * page).
 */
export function brandBookView(
  row: BookRow | null,
  corrections: readonly Correction[] = [],
  { allParts = false }: { allParts?: boolean } = {}
): BrandBookView | null {
  if (!row) return null
  const book = record(row.content)
  const brand = record(book.brand)
  const observed = record(book.observed)
  const customers = record(observed.customers)
  const products = record(book.products)
  // Only an object is the owner's approved words (null: not approved).
  const owner =
    book.owner && typeof book.owner === 'object' ? record(book.owner) : null
  const sending = observed.sending === null ? null : record(observed.sending)
  const strategy = book.strategy ? record(book.strategy) : null
  const voice = strategy?.voice ? record(strategy.voice) : null
  const currency = text(brand.currency)
  const perWeek = count(sending?.sendsPerWeek)
  const facts = record(book.facts)
  // A line is the owner's when a live correction of its part says it.
  const ownWords = new Map<string, Set<string>>()
  for (const c of corrections)
    if (c.action !== 'remove' && c.value) {
      const words = ownWords.get(c.section) ?? new Set<string>()
      words.add(c.section.startsWith('facts.') ? c.value : key(c.value))
      ownWords.set(c.section, words)
    }
  const ownFact = (fact: FactKey) =>
    [...(ownWords.get(`facts.${fact}`) ?? [])].some(
      (value) =>
        JSON.stringify(factValue(fact, value)) === JSON.stringify(facts[fact])
    )
  const seenGroup = (
    label: string,
    section: LineSection,
    value: unknown
  ): SeenGroup[] => {
    const list = strings(value)
    if (!list.length && !allParts) return []
    const own = ownWords.get(section)
    return [
      {
        label,
        section,
        lines: list.map((line) => ({
          text: line,
          own: own?.has(key(line)) ?? false
        }))
      }
    ]
  }
  const ownerLines = owner
    ? [
        { label: 'Positioning', text: text(owner.positioning) },
        { label: 'How your emails sound', text: text(owner.voice) },
        { label: 'What to avoid', text: text(owner.prohibitions) }
      ].flatMap((line) => (line.text ? [{ ...line, text: line.text }] : []))
    : null
  return {
    version: row.version,
    writtenAt: row.created_at,
    byStrategist: row.written_by.startsWith('brand-strategist'),
    sample: book.sample === true,
    brandName: text(brand.name),
    site: text(brand.site),
    facts: [
      ...factOrder.flatMap((fact) =>
        factWords({ [fact]: facts[fact] }, currency).map((line) => ({
          text: line,
          own: ownFact(fact)
        }))
      ),
      ...(facts.reviewsVerified === true
        ? [{ text: 'Reviews come from a checked review source', own: false }]
        : [])
    ],
    factTexts: Object.fromEntries(
      factKeys.map((fact) => [fact, factText(fact, facts[fact])])
    ) as Record<FactKey, string>,
    owner: owner ? ownerLines : null,
    unclear: Array.isArray(book.unclear)
      ? book.unclear.flatMap((item) => {
          const topic = text(record(item).topic)
          return topic ? [topicWords[topic] ?? topic.replaceAll('_', ' ')] : []
        })
      : [],
    seen: [
      ...seenGroup('What you sell', 'offering', observed.offering),
      ...seenGroup('Who your customers are', 'customers.who', customers.who),
      ...seenGroup('What customers love', 'customers.love', customers.love),
      ...seenGroup(
        'What customers worry about',
        'customers.worries',
        customers.worries
      ),
      ...seenGroup('How you sound', 'voice', observed.voice),
      ...seenGroup(
        'What works in your marketing',
        'marketing',
        observed.marketing
      )
    ],
    sending:
      perWeek === null
        ? null
        : [
            `About ${perWeek} ${perWeek === 1 ? 'email' : 'emails'} a week`,
            text(sending?.usualSendTime)
              ? `usually at ${text(sending?.usualSendTime)}`
              : null,
            strings(sending?.audiences).length
              ? `to ${strings(sending?.audiences).join(', ')}`
              : null
          ]
            .filter(Boolean)
            .join(', '),
    products: {
      count: count(products.count),
      bestsellers: strings(products.bestsellers),
      newArrivals: strings(products.newArrivals)
    },
    avoid: strings(book.avoid),
    sources: strings(book.sources).map((s) => sourceWords[s] ?? s),
    corrected: strings(book.corrected).map((s) => sectionWords[s] ?? s),
    corrections: corrections.map((c) =>
      correctionLine(c, currency, row.created_at)
    ),
    reading: strategy
      ? {
          positioning: text(strategy.positioning),
          parts: [
            ...lines('Who to write for', strategy.customers),
            ...lines('Products to lead with', strategy.heroProducts),
            ...lines('Reasons to buy to lead with', strategy.angles),
            ...lines('What to be careful about', strategy.care)
          ],
          voice: voice
            ? [
                ...lines('Tone', voice.tone),
                ...lines('Words to reuse', voice.use),
                ...lines('Words to avoid', voice.avoid)
              ]
            : [],
          style: voice ? text(voice.style) : null
        }
      : null
  }
}
