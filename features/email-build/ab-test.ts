import type { OfferSource } from '@/features/offers/source'
import { gmailClipBytes } from '@/features/release-qa/checks'
import { lockedDraft, type PlannedEmail } from './build'
import {
  designEmail,
  type Approach,
  type HeroImagePort,
  type ScreenshotPort
} from './design'
import { spamPhrases } from './inspect'
import type { Store } from './ports'

/**
 * EML-005 part 1 (D21): the A-vs-B test harness. For one brand, up to 10
 * planned emails are each built once (the same locked content, from
 * `lockedDraft`) and drawn twice: with coded blocks (A) and with a designed
 * hero picture made from the real product photo (B). Only the drawing
 * differs. Each drawing is scored on looks (the Visual inspector's 1 to 10,
 * plus the owner's optional 1 to 5 stars), deliverability (code checks) and,
 * once sent, clicks (lane B's results per variation).
 *
 * Sending (supervisor, 11 Nov, option a): each planned email goes into
 * Klaviyo as one draft with A and B as two variations of the same content,
 * day and audience, split 50/50 with no automatic winner; the owner still
 * schedules it (D17). PSH-001 creates the variations and LRN-001 reads the
 * results per variation. No run waits on the owner (D16): the stars are
 * optional and the summary works without them.
 *
 * This part has no database and no screen; the comparison page and the
 * owner's saved default come in part 2.
 */

/** How many planned emails one test draws (D21: 10 with A, 10 with B). */
export const abTestSize = 10

export type Deliverability = {
  /** The HTML's size in bytes. */
  bytes: number
  /** Over Gmail's clipping limit: the end of the email (the footer) is hidden. */
  clipped: boolean
  images: number
  /** Words a reader sees (the text outside tags, styles and scripts). */
  words: number
  /** Words per picture, or null without pictures. */
  wordsPerImage: number | null
  /** Spam phrases found in the words, if any. */
  spam: string[]
  /** 0 to 100 from the checks above (see `deliverability`). */
  score: number
}

/** Fewer words than this per picture reads as an image-heavy email. */
export const minWordsPerImage = 40

/** The text a reader sees: tags, styles, scripts and comments removed. */
function visibleText(html: string) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(style|script|head)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Deliverability by code: the size against Gmail's clipping limit, the
 * balance of words and pictures, and spam phrases. 100 is clean; clipping
 * costs 40, an email with no words 50, too few words per picture 20, and
 * each spam phrase 10 (at most 30).
 */
export function deliverability(html: string): Deliverability {
  const bytes = new TextEncoder().encode(html).length
  const clipped = bytes > gmailClipBytes
  const images = (html.match(/<img\b/gi) ?? []).length
  const text = visibleText(html)
  const words = text ? text.split(' ').length : 0
  const wordsPerImage = images ? Math.round(words / images) : null
  const lower = ` ${text.toLowerCase()} `
  const spam = spamPhrases.filter((p) => lower.includes(p.toLowerCase()))
  let score = 100
  if (clipped) score -= 40
  if (words === 0) score -= 50
  else if (wordsPerImage !== null && wordsPerImage < minWordsPerImage)
    score -= 20
  score -= Math.min(spam.length * 10, 30)
  return {
    bytes,
    clipped,
    images,
    words,
    wordsPerImage,
    spam,
    score: Math.max(0, score)
  }
}

export type Drawing = {
  approach: Approach
  /** False for B when its picture could not be made or passed: it fell back to A. */
  made: boolean
  html: string
  /** The Visual inspector's 1 to 10; null when it did not judge it (no AI). */
  looks: number | null
  /** Problems the screenshot checks or the inspector found. */
  findings: number
  deliverability: Deliverability
}

export type AbPair = {
  /** The planned email's place in the plan. */
  slot: number
  date: string
  emailType: PlannedEmail['emailType']
  a: Drawing
  b: Drawing
}

type Ctx = Parameters<typeof designEmail>[1]

/**
 * Draws up to `abTestSize` planned emails both ways. A planned email whose
 * content cannot be built is skipped with its code (no pair to compare);
 * never throws for an agent or adapter problem.
 */
export async function runAbTest(
  input: {
    planned: readonly PlannedEmail[]
    store: Store
    offers: OfferSource
  },
  ports: { shots: ScreenshotPort; heroImages: HeroImagePort },
  ctx: Ctx
): Promise<{ pairs: AbPair[]; skipped: { slot: number; code: string }[] }> {
  const pairs: AbPair[] = []
  const skipped: { slot: number; code: string }[] = []
  for (const [slot, planned] of input.planned.slice(0, abTestSize).entries()) {
    const here = { ...ctx, callerKey: `${ctx.callerKey}:${slot}` }
    const made = await lockedDraft(
      { planned, store: input.store, offers: input.offers },
      here
    )
    if (!made.ok) {
      skipped.push({ slot, code: made.code })
      continue
    }
    const draw = async (prefer: Approach): Promise<Drawing> => {
      const d = await designEmail(
        { draft: made.draft, brand: input.store.brand, prefer, ...ports },
        { ...here, callerKey: `${here.callerKey}:${prefer}` }
      )
      return {
        approach: prefer,
        made: d.approach === prefer,
        html: d.html,
        looks: d.approach === prefer ? d.looks : null,
        findings: d.findings.length,
        deliverability: deliverability(d.html)
      }
    }
    pairs.push({
      slot,
      date: planned.date,
      emailType: planned.emailType,
      a: await draw('A'),
      b: await draw('B')
    })
  }
  return { pairs, skipped }
}

/** One side's results across the test. */
export type AbSide = {
  /** Emails drawn this way (for B: only those whose picture was made). */
  emails: number
  /** The Visual inspector's average 1 to 10, or null when none was judged. */
  looks: number | null
  /** The owner's average 1 to 5 stars, or null when he gave none (optional). */
  stars: number | null
  /** The average deliverability score, 0 to 100, or null with no emails. */
  deliverability: number | null
  /** Clicks per delivered email once sent, or null before any results. */
  clickRate: number | null
}

const average = (values: readonly number[]) =>
  values.length
    ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10
    : null

/**
 * Both sides side by side. Only pairs where B's picture was made count,
 * so A and B are compared on the same emails. `stars` (the owner's, keyed
 * `slot:A` or `slot:B`, 1 to 5) and `results` (lane B's per variation) are
 * optional; missing ones are left out, never guessed.
 */
export function summarize(
  pairs: readonly AbPair[],
  extra: {
    stars?: Readonly<Record<string, number>>
    results?: Readonly<Record<string, { delivered: number; clicks: number }>>
  } = {}
): { compared: number; a: AbSide; b: AbSide } {
  const compared = pairs.filter((p) => p.b.made)
  const side = (approach: Approach): AbSide => {
    const drawings = compared.map((p) => ({
      slot: p.slot,
      d: approach === 'A' ? p.a : p.b
    }))
    const stars = drawings
      .map(({ slot }) => extra.stars?.[`${slot}:${approach}`])
      .filter((s): s is number => Number.isInteger(s) && s! >= 1 && s! <= 5)
    const results = drawings
      .map(({ slot }) => extra.results?.[`${slot}:${approach}`])
      .filter(
        (r): r is { delivered: number; clicks: number } =>
          !!r && r.delivered > 0 && r.clicks >= 0
      )
    const delivered = results.reduce((n, r) => n + r.delivered, 0)
    return {
      emails: drawings.length,
      looks: average(
        drawings.map(({ d }) => d.looks).filter((l): l is number => l !== null)
      ),
      stars: average(stars),
      deliverability: average(drawings.map(({ d }) => d.deliverability.score)),
      clickRate: delivered
        ? Math.round(
            (results.reduce((n, r) => n + r.clicks, 0) / delivered) * 10_000
          ) / 10_000
        : null
    }
  }
  return { compared: compared.length, a: side('A'), b: side('B') }
}
