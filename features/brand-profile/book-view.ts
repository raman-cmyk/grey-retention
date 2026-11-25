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
 */

export type BookRow = {
  version: number
  content: unknown
  written_by: string
  created_at: string
}

export type BookLines = { label: string; lines: string[] }

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
  facts: string[]
  /** The owner's approved words; null when he has not approved them. */
  owner: { label: string; text: string }[] | null
  /** Topics the sources disagree on: no claim is made about them. */
  unclear: string[]
  /** What the readers saw, by topic (only topics with lines). */
  seen: BookLines[]
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

const lines = (label: string, value: unknown): BookLines[] => {
  const list = strings(value)
  return list.length ? [{ label, lines: list }] : []
}

/** The latest Brand book in the owner's words; null when there is none. */
export function brandBookView(row: BookRow | null): BrandBookView | null {
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
    facts: factWords(record(book.facts), currency),
    owner: owner ? ownerLines : null,
    unclear: Array.isArray(book.unclear)
      ? book.unclear.flatMap((item) => {
          const topic = text(record(item).topic)
          return topic ? [topicWords[topic] ?? topic.replaceAll('_', ' ')] : []
        })
      : [],
    seen: [
      ...lines('What you sell', observed.offering),
      ...lines('Who your customers are', customers.who),
      ...lines('What customers love', customers.love),
      ...lines('What customers worry about', customers.worries),
      ...lines('How you sound', observed.voice),
      ...lines('What works in your marketing', observed.marketing)
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
