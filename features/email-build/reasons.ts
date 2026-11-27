import { z } from 'zod'
import {
  clock,
  timingWords,
  type SlotTiming
} from '@/features/strategy/send-times'
import type { LadderPlace } from '@/features/offers/ladder'
import type { BuiltEmail, PlannedEmail } from './build'

/**
 * PICK-104 (owner pick #104, "One-line design reasons"): the main choices
 * of an email, each with one plain sentence that says why, built when the
 * email is made (the design step) and stored with it (`BuiltEmail.reasons`).
 *
 * Facts only. Each reason is a fixed template filled from a fact GROS used
 * when it made the choice, and names that fact (`facts`): the plan's own
 * evidence for a product (STR-001's "sold 42 in the last 30 days"), the
 * offer ladder's place for the offer (#40), the send time's basis (PICK-97)
 * and the inspiration email the sections step followed, with the reason it
 * saved then (DST-002b). A choice with no recorded fact gets no reason:
 * never a guess, and no AI call. Every number in a reason is copied from
 * the stored fact it names. Builds made before it have none.
 */

export const reasonKinds = ['layout', 'product', 'offer', 'send_time'] as const
export type ReasonKind = (typeof reasonKinds)[number]

/** Where a reason's fact is kept: the plan's slot or a saved build step. */
export const factSources = ['plan', 'sections', 'content'] as const

export const designReason = z.object({
  kind: z.enum(reasonKinds),
  /** One plain sentence in the owner's words. */
  text: z.string().min(1).max(700),
  /** The stored facts it is built from, e.g. plan `evidence:bestseller:p1`. */
  facts: z
    .array(
      z.object({
        from: z.enum(factSources),
        key: z.string().min(1).max(200)
      })
    )
    .min(1)
    .max(4)
})
export type DesignReason = z.infer<typeof designReason>

/** About five reasons an email, the most visible choice first. */
export const maxReasons = 5

export const designReasons = z.array(designReason).max(maxReasons)

/** The slot's ladder place, as the plan keeps it (PICK-104). */
export const ladderPlace = z.object({
  step: z.int().min(1).max(15),
  steps: z.int().min(1).max(15),
  before: z.int().min(1).max(100).nullable(),
  lowest: z.boolean()
}) satisfies z.ZodType<LadderPlace>

// The pulse's own fact templates (features/strategy/pulse.ts,
// `gatherEvidence`), read back exactly: a fact in any other words gives no
// reason. reasons.test.ts checks them against the pulse.
const soldFact = /^(.+) sold (\d+) in the last 30 days\.$/
const launchesFact = /^(.+) launches on (\d{4}-\d{2}-\d{2})\.$/
const launchedFact = /^(.+) is new \(launched (\d{4}-\d{2}-\d{2})\)\.$/

const dayWords = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC'
})
/** "20 Nov" for "2026-11-20". */
const day = (date: string) => dayWords.format(new Date(`${date}T00:00:00Z`))

/** One line of stored text, short enough to read. */
const oneLine = (text: string, max: number) => {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line
}

const ordinal = ['first', 'second', 'third', 'fourth', 'fifth']
const nth = (n: number) => ordinal[n - 1] ?? `${n}th`

/** What a saved step holds that the reasons read; anything else is ignored. */
const savedSteps = z.looseObject({
  sections: z
    .looseObject({
      reference: z
        .looseObject({
          emailId: z.string().min(1).max(80),
          mode: z.enum(['copy', 'remix']),
          reason: z.string().min(1).max(600)
        })
        .optional()
        .catch(undefined)
    })
    .optional()
    .catch(undefined),
  content: z
    .looseObject({
      sections: z
        .array(
          z.looseObject({
            family: z.string(),
            products: z
              .array(z.looseObject({ id: z.string() }))
              .catch([])
              .optional()
          })
        )
        .max(40)
        .catch([])
    })
    .optional()
    .catch(undefined)
})

type Input = {
  planned: PlannedEmail
  /** The email as the design step made it. */
  email: Omit<BuiltEmail, 'reasons'>
  /** The build's saved steps (`email_builds.progress`). */
  progress: unknown
}

/** Why a featured product was chosen: the plan's own fact about it. */
function productReason(
  id: string,
  title: string,
  hero: boolean,
  evidence: ReadonlyMap<string, string>
): DesignReason | null {
  const lead = hero ? `The hero shows ${title}` : `${title} is in this email`
  const sold = evidence.get(`bestseller:${id}`)?.match(soldFact)
  if (sold)
    return {
      kind: 'product',
      text: `${lead} because it is one of your bestsellers: it sold ${sold[2]} in the last 30 days.`,
      facts: [{ from: 'plan', key: `evidence:bestseller:${id}` }]
    }
  const launch = evidence.get(`launch:${id}`)
  const soon = launch?.match(launchesFact)
  const fresh = launch?.match(launchedFact)
  if (soon || fresh)
    return {
      kind: 'product',
      text: soon
        ? `${lead} because it is new: it launches on ${day(soon[2]!)}.`
        : `${lead} because it is new: it launched on ${day(fresh![2]!)}.`,
      facts: [{ from: 'plan', key: `evidence:launch:${id}` }]
    }
  return null
}

/** Why the email has its offer: the ladder's place for it (#40). */
function offerReason(
  offer: { code: string; percent: number },
  ladder: LadderPlace
): DesignReason | null {
  const lead = `The offer is ${offer.percent}% off with ${offer.code}`
  const of =
    ladder.steps > 1
      ? `, the ${nth(ladder.step)} of ${ladder.steps} offer emails in this plan`
      : ''
  const text =
    ladder.before !== null && offer.percent > ladder.before
      ? `${lead}${of}: a sale steps up, so it goes up from ${ladder.before}% in the offer email before it.`
      : ladder.before !== null && offer.percent === ladder.before
        ? `${lead}${of}: a sale never steps down, so it stays at ${ladder.before}% like the offer email before it.`
        : ladder.before === null && ladder.lowest
          ? `${lead}${of}: a sale starts with your smallest discount code${offer.percent >= 10 ? ' of at least 10%' : ''} and steps up from there.`
          : null
  return text
    ? {
        kind: 'offer',
        text,
        facts: [
          { from: 'plan', key: 'offer' },
          { from: 'plan', key: 'ladder' }
        ]
      }
    : null
}

/** Why it has its suggested time: PICK-97's basis, for its audience. */
function timeReason(
  time: string,
  audience: string,
  timing: SlotTiming
): DesignReason {
  return {
    kind: 'send_time',
    text: `The suggested send time for “${oneLine(audience, 80)}” is ${clock(time)}: ${timingWords(timing)}.`,
    facts: [
      { from: 'plan', key: 'time' },
      { from: 'plan', key: 'audience' },
      { from: 'plan', key: 'timing' }
    ]
  }
}

/**
 * The email's reasons, the most visible choice first (its layout, its lead
 * product, its offer, its send time, then a second product), at most
 * `maxReasons`. Each choice is checked against the email as made: a
 * product the Content locker replaced, an offer it dropped or a code that
 * changed gives no reason.
 */
export function reasonsFor({
  planned,
  email,
  progress
}: Input): DesignReason[] {
  const saved = savedSteps.safeParse(progress ?? {})
  const steps = saved.success ? saved.data : {}
  const reasons: DesignReason[] = []
  const designed = email.format !== 'text'

  // The inspiration email the sections step followed, and why (DST-002b).
  const reference = designed ? steps.sections?.reference : undefined
  if (reference)
    reasons.push({
      kind: 'layout',
      text: oneLine(reference.reason, 600),
      facts: [{ from: 'sections', key: `reference:${reference.emailId}` }]
    })

  // The products it features, with the plan's fact for each.
  const evidence = new Map(
    (planned.evidence ?? []).map((e) => [e.id, e.fact] as const)
  )
  const titles = new Map(planned.products.map((p) => [p.id, p.title]))
  const heroIds = new Set(
    (steps.content?.sections ?? [])
      .filter((s) => s.family === 'hero_product')
      .flatMap((s) => (s.products ?? []).map((p) => p.id))
  )
  const products = [...new Set(email.productIds)].flatMap((id) => {
    const title = titles.get(id)
    if (!title) return []
    // A copied design's sections are another email's: no "hero" claim.
    const hero = designed && !email.library && heroIds.has(id)
    const reason = productReason(id, oneLine(title, 120), hero, evidence)
    return reason ? [reason] : []
  })
  if (products[0]) reasons.push(products[0])

  // The offer, when the email shows the very code the ladder chose.
  if (
    planned.offer &&
    planned.ladder &&
    email.code !== null &&
    email.code.toUpperCase() === planned.offer.code.toUpperCase() &&
    (email.offer === undefined ||
      email.offer === null ||
      email.offer.percent === planned.offer.percent)
  ) {
    const offer = offerReason(planned.offer, planned.ladder)
    if (offer) reasons.push(offer)
  }

  // The suggested send time, for the audience it goes to (PICK-97).
  if (planned.timing && email.audienceId === planned.audience.id)
    reasons.push(
      timeReason(planned.time, planned.audience.label, planned.timing)
    )

  if (products[1]) reasons.push(products[1])
  return reasons.slice(0, maxReasons)
}

/** The stored reasons as the page shows them: the sentences, at most five. */
export function reasonLines(reasons: readonly DesignReason[] | undefined) {
  return [...new Set((reasons ?? []).map((r) => r.text))].slice(0, maxReasons)
}
