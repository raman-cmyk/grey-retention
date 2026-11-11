import type { OfferSource } from '@/features/offers/source'
import { keyPart } from '@/features/fallback/entry'
import { gmailClipBytes } from '@/features/release-qa/checks'
import { lockedDraft, type PlannedEmail } from './build'
import {
  designA,
  designB,
  designedPictureOk,
  heroIndex,
  look,
  type Approach,
  type HeroImagePort,
  type Look,
  type ScreenshotPort
} from './design'
import { phrase, spamPhrases } from './inspect'
import type { Store } from './ports'

/**
 * EML-005 part 1 (D21): the A-vs-B test harness. For one brand, up to 10
 * planned emails are each built once (the same locked content, from
 * `lockedDraft`) and drawn twice: with coded blocks (A) and with a designed
 * hero picture made from the real product photo (B). Only the drawing
 * differs.
 *
 * Fair and bounded: each approach gets one drawing and one look on the same
 * terms (B gets one picture, not the best of the production retries); an
 * email without a product hero is not drawn with B at all; and an inspector
 * that gives up is not asked again for the rest of the run.
 *
 * Scores per drawing: looks (the Visual inspector's 1 to 10, plus the
 * owner's optional 1 to 5 stars), deliverability (code checks) and, once
 * sent, clicks (lane B's results per variation).
 *
 * Sending (supervisor, 11 Nov, option a): each planned email goes into
 * Klaviyo as one draft with A and B as two variations of the same content,
 * day and audience, split 50/50 with no automatic winner; the owner still
 * schedules it (D17). Only a made B is ever a variation B. No run waits on
 * the owner (D16): the stars are optional.
 *
 * This part has no database and no screen; the comparison page and the
 * owner's saved default come in part 2, as a leased job with a spending cap.
 */

/** How many planned emails one test draws (D21: 10 with A, 10 with B). */
export const abTestSize = 10

/** Klaviyo's tracking links add bytes after us: keep this much under Gmail's limit. */
export const clipMarginBytes = 10 * 1024
/** A designed picture heavier than this is slow to open on a phone. */
export const heavyPictureBytes = 1024 * 1024
/** Fewer words than this per picture reads as an image-heavy email. */
export const minWordsPerImage = 40

export type Deliverability = {
  /** The HTML's size in bytes. */
  bytes: number
  /** At or near Gmail's clipping limit (with `clipMarginBytes` to spare). */
  clipped: boolean
  images: number
  /** Words a reader sees: no tags, styles, hidden preheader or Klaviyo tags. */
  words: number
  /** Words per picture, or null without pictures. */
  wordsPerImage: number | null
  /** Spam phrases found as whole words. */
  spam: string[]
  /** The designed picture's size (B), or null when unknown or none. */
  pictureBytes: number | null
  /** 0 to 100 from the checks above (see `deliverability`). */
  score: number
}

const entities: Record<string, string> = {
  amp: '&',
  quot: '"',
  apos: "'",
  '#39': "'",
  rsquo: "'",
  lsquo: "'",
  nbsp: ' ',
  middot: ' '
}

/** The text a reader sees. */
function visibleText(html: string) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(style|script|head|title)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<div[^>]*display\s*:\s*none[^>]*>[\s\S]*?<\/div>/gi, ' ')
    .replace(/\{%[\s\S]*?%\}|\{\{[\s\S]*?\}\}/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&([a-z]+|#\d+);/gi, (_, name: string) =>
      name.toLowerCase() in entities ? entities[name.toLowerCase()] : ''
    )
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Deliverability by code: the size against Gmail's clipping limit, the
 * balance of words and pictures, spam phrases and, for B, the designed
 * picture's weight. 100 is clean; clipping costs 40, an email with no words
 * 50, too few words per picture 20, each spam phrase 10 (at most 30) and a
 * heavy picture 20.
 */
export function deliverability(
  html: string,
  pictureBytes: number | null = null
): Deliverability {
  const bytes = new TextEncoder().encode(html).length
  const clipped = bytes >= gmailClipBytes - clipMarginBytes
  const images = (html.match(/<img\b/gi) ?? []).length
  const text = visibleText(html)
  const words = text.split(' ').filter((w) => /[\p{L}\p{N}]/u.test(w)).length
  const wordsPerImage = images ? Math.round(words / images) : null
  const spam = spamPhrases.filter((p) => phrase(text, p))
  let score = 100
  if (clipped) score -= 40
  if (words === 0) score -= 50
  else if (wordsPerImage !== null && wordsPerImage < minWordsPerImage)
    score -= 20
  score -= Math.min(spam.length * 10, 30)
  if (pictureBytes !== null && pictureBytes > heavyPictureBytes) score -= 20
  return {
    bytes,
    clipped,
    images,
    words,
    wordsPerImage,
    spam,
    pictureBytes,
    score: Math.max(0, score)
  }
}

export type Drawing = {
  approach: Approach
  html: string
  /** False when code found a problem first or the inspector gave up (e.g. no AI). */
  inspected: boolean
  /** The Visual inspector's 1 to 10; null when not inspected or no valid score. */
  looks: number | null
  /** Problems the screenshot checks or the inspector found. */
  findings: number
  deliverability: Deliverability
}

/** B for one email: drawn, not drawn (no product hero), or its picture failed. */
export type BStatus = 'made' | 'no_hero' | 'picture_failed'

export type AbPair = {
  /** The planned email's place in its plan (stable: stars and results use it). */
  slot: number
  date: string
  emailType: PlannedEmail['emailType']
  a: Drawing
  /** Only a made B: never A's drawing under B's name. */
  b: Drawing | null
  bStatus: BStatus
}

type Ctx = Parameters<typeof look>[5]

const drawing = (
  approach: Approach,
  html: string,
  seen: Look,
  pictureBytes: number | null
): Drawing => ({
  approach,
  html,
  inspected: seen.inspected,
  looks: seen.score,
  findings: seen.findings.length,
  deliverability: deliverability(html, pictureBytes)
})

/**
 * Draws up to `abTestSize` planned emails both ways. A planned email whose
 * content cannot be built is skipped with its code; a B picture that cannot
 * be made is logged once for that email. Never throws for an agent or
 * adapter problem. At most one inspector look per drawing and one picture
 * per email.
 */
export async function runAbTest(
  input: {
    emails: readonly { slot: number; planned: PlannedEmail }[]
    store: Store
    offers: OfferSource
  },
  ports: { shots: ScreenshotPort; heroImages: HeroImagePort },
  ctx: Ctx
): Promise<{ pairs: AbPair[]; skipped: { slot: number; code: string }[] }> {
  const pairs: AbPair[] = []
  const skipped: { slot: number; code: string }[] = []
  // One memory of a give-up for the whole run: a broken inspector costs once.
  const gaveUp = new Set<string>()
  // Short enough that the slot and approach survive `keyPart`'s limit.
  const base = ctx.callerKey.slice(0, 80)
  const brand = input.store.brand
  for (const { slot, planned } of input.emails.slice(0, abTestSize)) {
    const key = `${base}:${slot}`
    const made = await lockedDraft(
      { planned, store: input.store, offers: input.offers },
      { ...ctx, callerKey: key }
    )
    if (!made.ok) {
      skipped.push({ slot, code: made.code })
      continue
    }
    const pair = (b: Drawing | null, bStatus: BStatus) =>
      pairs.push({
        slot,
        date: planned.date,
        emailType: planned.emailType,
        a,
        b,
        bStatus
      })
    const aDesign = designA(made.draft, brand)
    const a = drawing(
      'A',
      aDesign.html,
      await look(
        'A',
        aDesign,
        brand,
        null,
        ports.shots,
        { ...ctx, callerKey: `${key}:A` },
        gaveUp
      ),
      null
    )
    const at = heroIndex(made.draft)
    if (at < 0) {
      pair(null, 'no_hero')
      continue
    }
    const hero = made.draft.blocks[at].content as {
      image: string
      alt?: string
      headline?: string
    }
    const picture = await ports.heroImages
      .design({
        tenantId: ctx.tenantId,
        callerKey: `${key}:B`,
        photoUrl: hero.image,
        productTitle: hero.alt || hero.headline || '',
        colors: {
          accent: brand.accent,
          background: brand.background,
          ink: brand.ink
        },
        problems: []
      })
      .catch(() => ({ ok: false as const, code: 'image_error' }))
    if (!picture.ok || !designedPictureOk(picture.url)) {
      await ctx.fallbacks.record({
        tenantId: ctx.tenantId,
        campaignId: ctx.campaignId ?? null,
        agent: 'ab-test',
        reasonCode: 'b_picture_failed',
        reason:
          'The designed hero picture could not be made for the A-vs-B test.',
        fallback:
          'This email is left out of the comparison; A was drawn alone.',
        attempts: 1,
        detail: { code: picture.ok ? 'image_not_https' : picture.code },
        dedupeKey: `ab-test:${keyPart(key)}`
      })
      pair(null, 'picture_failed')
      continue
    }
    const bDesign = designB(made.draft, brand, picture.url)
    pair(
      drawing(
        'B',
        bDesign.html,
        await look(
          'B',
          bDesign,
          brand,
          { section: at + 1, source: picture.source },
          ports.shots,
          { ...ctx, callerKey: `${key}:B` },
          gaveUp
        ),
        picture.bytes ?? null
      ),
      'made'
    )
  }
  return { pairs, skipped }
}

/** One side's results, over the same emails as the other side. */
export type AbSide = {
  /** The Visual inspector's average 1 to 10. */
  looks: number | null
  /** The owner's average 1 to 5 stars (optional). */
  stars: number | null
  /** The average deliverability score, 0 to 100. */
  deliverability: number | null
  /** Clicks per delivered email once sent. */
  clickRate: number | null
}

const average = (values: readonly number[]) =>
  values.length
    ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10
    : null

const validStars = (s: number | undefined): s is number =>
  Number.isInteger(s) && s! >= 1 && s! <= 5

/**
 * Both sides side by side, paired: each score is averaged over the emails
 * where both A and B have it, so neither side is judged on easier emails.
 * `stars` (the owner's, keyed `slot:A` or `slot:B`) and `results` (lane B's
 * per variation) are optional; missing or invalid ones are left out.
 */
export function summarize(
  pairs: readonly AbPair[],
  extra: {
    stars?: Readonly<Record<string, number>>
    results?: Readonly<Record<string, { delivered: number; clicks: number }>>
  } = {}
) {
  const made = pairs.filter(
    (p): p is AbPair & { b: Drawing } => p.bStatus === 'made' && !!p.b
  )
  const judged = made.filter((p) => p.a.looks !== null && p.b.looks !== null)
  const starred = made.filter(
    (p) =>
      validStars(extra.stars?.[`${p.slot}:A`]) &&
      validStars(extra.stars?.[`${p.slot}:B`])
  )
  const result = (slot: number, approach: Approach) => {
    const r = extra.results?.[`${slot}:${approach}`]
    return r && r.delivered > 0 && r.clicks >= 0 ? r : null
  }
  const sent = made.filter((p) => result(p.slot, 'A') && result(p.slot, 'B'))
  const side = (approach: Approach): AbSide => {
    const of = (p: AbPair & { b: Drawing }) => (approach === 'A' ? p.a : p.b)
    const rows = sent.map((p) => result(p.slot, approach)!)
    const delivered = rows.reduce((n, r) => n + r.delivered, 0)
    return {
      looks: average(judged.map((p) => of(p).looks!)),
      stars: average(starred.map((p) => extra.stars![`${p.slot}:${approach}`])),
      deliverability: average(made.map((p) => of(p).deliverability.score)),
      clickRate: delivered
        ? Math.round(
            (rows.reduce((n, r) => n + r.clicks, 0) / delivered) * 10_000
          ) / 10_000
        : null
    }
  }
  return {
    /** Emails drawn; with B made; without a product hero; B picture failed. */
    emails: pairs.length,
    made: made.length,
    noHero: pairs.filter((p) => p.bStatus === 'no_hero').length,
    pictureFailed: pairs.filter((p) => p.bStatus === 'picture_failed').length,
    /** Pairs each score was averaged over. */
    counted: {
      looks: judged.length,
      stars: starred.length,
      clicks: sent.length
    },
    a: side('A'),
    b: side('B')
  }
}
