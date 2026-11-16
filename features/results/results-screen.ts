import type { Numbers, ResultLine } from './read-model'
import { minClicks, minRecipients } from './thresholds'

/**
 * UI-RES-a (the owner's request of 16 November: a basic working UI on
 * docs/design/BRAND.md): what the Results page shows, from its Results
 * lines (`resultsReadModel`): per email, sent, opened, clicked and sales,
 * and the A versus B result. Pure: the page draws it with the GROS
 * components, and every word and number format is decided here.
 */
export type ResultsScreen =
  /** The results could not be read: say so, and Reload. */
  | { kind: 'error' }
  /** No email was put into Klaviyo yet. */
  | { kind: 'empty' }
  | {
      kind: 'results'
      /** Every line is the sample store's: the page says they are examples. */
      sample: boolean
      /** "3 sent · 1 scheduled · 2 drafts", for the page's label; samples apart. */
      counts: {
        sent: number
        scheduled: number
        draft: number
        sample: number
        other: number
      }
      emails: ResultEmail[]
    }

export type ResultEmail = {
  buildId: string
  title: string
  /** "Tue 17" (its send day in store time, else its planned day), or null. */
  day: string | null
  /**
   * Sent (or sending); scheduled; a draft for the owner to schedule (D17);
   * a sample (the sample store's, never sent: its numbers are examples);
   * or other (cancelled, deleted, not sent).
   */
  state: 'sent' | 'scheduled' | 'draft' | 'sample' | 'other'
  statusText: string
  /** Its numbers, or null before Klaviyo has any. */
  numbers: NumberWords | null
  /** One line on how sure the numbers are, or null when they are final and whole. */
  note: string | null
  ab: AbWords | null
  /** "The products got the most clicks (42).", when known. */
  topSection: string | null
  sample: boolean
}

/** The numbers as the page shows them: "1,240", "38%", "$412". */
export type NumberWords = {
  sent: string
  opened: string | null
  clicked: string | null
  /** Sales from the email, or null when the store's orders were not read. */
  sales: string | null
  orders: string | null
}

export type AbWords = {
  a: NumberWords
  b: NumberWords
  /** Which version won, in words. */
  verdict: string
  winner: 'a' | 'b' | null
}

const count = new Intl.NumberFormat('en-US')

/** The Klaviyo account's currency (null: plain amounts) and the store's time zone. */
export type Place = {
  currency: string | null
  timezone: string
  /** Today in store time (YYYY-MM-DD): a draft past its day says so. */
  today?: string
}

/** "38%", or "2.1%" under 10%. */
export function percent(rate: number | null): string | null {
  if (rate === null || !Number.isFinite(rate)) return null
  const p = Math.max(0, rate * 100)
  return `${p < 10 ? (Math.round(p * 10) / 10).toString() : Math.round(p)}%`
}

/** "$412" in the account's currency (its own decimals); "412.00" when it is not known. */
export function money(amount: number | null, currency: string | null) {
  if (amount === null || !Number.isFinite(amount)) return null
  if (currency && /^[A-Z]{3}$/.test(currency))
    try {
      const digits =
        new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency
        }).resolvedOptions().maximumFractionDigits ?? 2
      const whole = Math.round(amount * 10 ** digits) % 10 ** digits === 0
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
        minimumFractionDigits: whole ? 0 : digits,
        maximumFractionDigits: whole ? 0 : digits
      }).format(amount)
    } catch {
      // An unknown code: the plain amount below.
    }
  return amount.toFixed(2)
}

function wordsOf(n: Numbers, currency: string | null): NumberWords {
  return {
    sent: count.format(n.recipients),
    opened: percent(n.openRate),
    clicked: percent(n.clickRate),
    sales: money(n.revenue, currency),
    orders: n.orders === null ? null : count.format(n.orders)
  }
}

/** Each email section by its block, in the owner's words. */
const blockWords: Record<string, string> = {
  announcement_bar: 'The top bar',
  header_logo: 'The logo',
  hero_product: 'The top product',
  hero_image: 'The top picture',
  offer_banner: 'The offer',
  text: 'The text',
  steps: 'The steps',
  product_feature: 'The products',
  category_tiles: 'The categories',
  image_text: 'The picture and text',
  founder_note: 'The founder’s note',
  review_strip: 'The reviews',
  ugc_grid: 'The customers’ photos',
  before_after: 'The before and after',
  faq: 'The questions',
  cta: 'The button',
  signoff: 'The sign-off',
  footer: 'The footer'
}

/** "Tue 17": a plan's day as it is, a send time in the store's time zone. */
function dayLabel(date: string | null, timeZone: string) {
  if (!date) return null
  const plain = date.length === 10
  const t = Date.parse(plain ? `${date}T12:00:00Z` : date)
  if (Number.isNaN(t)) return null
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      day: 'numeric',
      timeZone: plain ? 'UTC' : timeZone
    }).formatToParts(new Date(t))
  } catch {
    return null
  }
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? ''
  const day = parts.find((p) => p.type === 'day')?.value ?? ''
  return `${weekday} ${day}`.trim() || null
}

function abWords(line: ResultLine, currency: string | null): AbWords | null {
  if (!line.ab) return null
  const { a, b, verdict } = line.ab
  const words: Record<typeof verdict, string> = {
    a: `Version A got more clicks: ${percent(a.clickRate)} against ${percent(b.clickRate)}.`,
    b: `Version B got more clicks: ${percent(b.clickRate)} against ${percent(a.clickRate)}.`,
    even: 'Versions A and B got about the same clicks.',
    too_early: line.final
      ? `Too few people or clicks to pick a winner: it takes ${minRecipients} people on each version and ${minClicks} clicks.`
      : `Too early to pick a winner: it takes three days of results, ${minRecipients} people on each version and ${minClicks} clicks.`
  }
  return {
    a: wordsOf(a, currency),
    b: wordsOf(b, currency),
    verdict: words[verdict],
    winner: verdict === 'a' || verdict === 'b' ? verdict : null
  }
}

function noteOf(line: ResultLine): string | null {
  if (line.sample)
    return 'A sample: this email was never sent, and its numbers are examples.'
  if (line.status !== 'sent' && line.status !== 'sending') return null
  if (!line.totals) return 'Klaviyo has no numbers for it yet.'
  const missing = line.complete
    ? ''
    : ' Some numbers could not be read from Klaviyo.'
  if (line.status === 'sending')
    return `Still sending: the numbers will change.${missing}`
  if (!line.final)
    return `Numbers can still change: they are read for three days after the send.${missing}`
  return missing.trim() || null
}

/** One Results line as the page shows it. */
export function resultEmail(
  line: ResultLine,
  { currency, timezone, today }: Place
): ResultEmail {
  const state: ResultEmail['state'] = line.sample
    ? 'sample'
    : line.status === 'sent' || line.status === 'sending'
      ? 'sent'
      : line.status === 'scheduled'
        ? 'scheduled'
        : line.status === 'draft'
          ? 'draft'
          : 'other'
  const top =
    // A sample's clicks are examples: no "most clicks" fact.
    !line.sample &&
    line.topSection &&
    Object.hasOwn(blockWords, line.topSection.block)
      ? `${blockWords[line.topSection.block]} got the most clicks (${count.format(line.topSection.clicks)}).`
      : null
  return {
    buildId: line.buildId,
    title: line.subject ?? 'An email from your plan',
    day: dayLabel(line.sentAt, timezone) ?? dayLabel(line.plannedDay, timezone),
    state,
    statusText: line.sample
      ? 'Sample: not sent'
      : line.status === 'draft' && !line.statusText.includes('(')
        ? today && line.plannedDay && line.plannedDay < today
          ? 'Draft in Klaviyo: its planned day has passed'
          : 'Draft in Klaviyo: ready for you to schedule'
        : line.statusText,
    numbers: line.totals ? wordsOf(line.totals, currency) : null,
    note: noteOf(line),
    ab: abWords(line, currency),
    topSection: top,
    sample: line.sample
  }
}

/** The Results page from its lines (null: they could not be read). */
export function resultsScreen(
  lines: readonly ResultLine[] | null,
  place: Place
): ResultsScreen {
  if (!lines) return { kind: 'error' }
  if (!lines.length) return { kind: 'empty' }
  const emails = lines.map((l) => resultEmail(l, place))
  const n = (state: ResultEmail['state']) =>
    emails.filter((e) => e.state === state).length
  return {
    kind: 'results',
    sample: lines.every((l) => l.sample),
    counts: {
      sent: n('sent'),
      scheduled: n('scheduled'),
      draft: n('draft'),
      sample: n('sample'),
      other: n('other')
    },
    emails
  }
}
