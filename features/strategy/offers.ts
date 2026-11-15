import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import type { DiscountCode, OfferSource } from '@/features/offers/source'
import {
  offersAt,
  ownerOrSampleOffers,
  sampleOffersFrom,
  type SavedOffers
} from '@/features/email-build/ports'
import { validTimezone } from '@/lib/brand-time'
import { localDateTime, localTimeCandidates } from '@/lib/local-time'
import { addDays } from './pulse'
import { sendHours, type PlannedSlot } from './plan'
import { keyPart } from '@/features/fallback/entry'
import type { StoredPulse } from './stored'

/**
 * STR-003 follow-up (#379): "Plan next 15 days" reads offers by the same
 * rule as "Create email" (`ownerOrSampleOffers`, supervisor 11 Nov). What
 * the owner saved in Settings wins, even while the store is the sample
 * store; the sample offers only when nothing is saved; a failed read means
 * no offers, never the sample. So the plan only picks a code the email will
 * be allowed to use, within the owner's max, on a day it still works.
 */
export type PlanOffers = { maxDiscountPercent: number; codes: DiscountCode[] }

/** Nothing saved: no discount and no codes. */
const noOffers: OfferSource = {
  offers: async () => ({ maxDiscountPercent: null, codes: [] })
}

/**
 * The plan's offers: the owner's; when nothing is saved, the sample's from
 * the plan's first day for the sample store, and none for the workspace's
 * own store (ONB-057b: its emails never offer the sample's codes).
 */
export const planOfferSource = (
  saved: SavedOffers,
  start: string,
  { sample }: { sample: boolean }
): OfferSource =>
  ownerOrSampleOffers(saved, sample ? sampleOffersFrom(start) : noOffers)

/** The first moment of a store-local day (01:00 when midnight is skipped). */
function dayStart(date: string, timezone: string) {
  for (const time of ['00:00', '01:00']) {
    const at = localTimeCandidates(`${date}T${time}`, timezone)[0]
    if (at) return at
  }
  return `${date}T00:00:00.000Z`
}

/**
 * The offers when the plan's first day begins: no max saved means 0%, and
 * codes that end before then are left out (`offersAt`, as the email build).
 * A read that fails throws `offers_unreadable`, so the step is tried again:
 * a plan covers 15 days, so it never falls back to the sample and never
 * plans them all without offers because of one failed read.
 */
export async function readPlanOffers(
  source: OfferSource,
  tenantId: string,
  start: string,
  timezone: string
): Promise<PlanOffers> {
  const at = dayStart(start, timezone)
  const read = await source.offers(tenantId, at).catch(() => null)
  if (!read)
    throw Object.assign(new Error('offers_unreadable'), {
      code: 'offers_unreadable'
    })
  return offersAt({ offers: async () => read }, tenantId, at)
}

/**
 * The last store-local day an email can send with a code: the plan's
 * inclusive `until`, the code's real last day. It is the day the code ends
 * when it still works at the latest send time (Settings ends a code at
 * 23:59:59 store time, so the 20th stays the 20th); a code ending earlier
 * in the day (2 pm on the 20th) last works for a whole day of sends on the
 * 19th, so no planned send can miss it. Null: no end.
 */
export function lastSendDay(expiresAt: string | null, timezone: string) {
  if (expiresAt === null) return null
  const local = localDateTime(expiresAt, timezone)
  const day = local.slice(0, 10)
  return local.slice(11) > sendHours.to ? day : addDays(day, -1)
}

/**
 * The pulse's code rows: each code an email can still send with during the
 * 15 days. One that ends before that is left out with its reason, so the
 * owner sees why a saved code is missing.
 */
export function pulseCodes(
  offers: PlanOffers,
  start: string,
  timezone: string
) {
  const codes: { code: string; percent: number; expiresOn: string | null }[] =
    []
  const leftOut: { code: string; why: string }[] = []
  for (const c of offers.codes) {
    const expiresOn = lastSendDay(c.expiresAt, timezone)
    if (expiresOn !== null && expiresOn < start)
      leftOut.push({
        code: c.code,
        // Its last day: the store date of its last working second.
        why: `Its last day is ${localDateTime(new Date(Date.parse(c.expiresAt!) - 1000), timezone).slice(0, 10)}, too early for an email in these 15 days.`
      })
    else codes.push({ code: c.code, percent: c.percent, expiresOn })
  }
  return { codes, leftOut }
}

type Offer = StoredPulse['offers'][number]
const key = (code: string) => code.trim().toUpperCase()

/**
 * The picked offers that still work when the plan is made, with their
 * current percent and last full day. The owner can change Settings between
 * the offer step and the plan step: a removed code, or one now above the
 * max, is left out, and the owner is told.
 */
export function stillUsable(
  picked: readonly Offer[],
  offers: PlanOffers,
  start: string,
  timezone: string
): { usable: Offer[]; leftOut: string[] } {
  const now = new Map(
    pulseCodes(offers, start, timezone).codes.map((c) => [key(c.code), c])
  )
  const usable: Offer[] = []
  const leftOut: string[] = []
  for (const o of picked) {
    const c = now.get(key(o.code))
    if (!c || c.percent > offers.maxDiscountPercent) leftOut.push(o.code)
    else
      usable.push({
        ...o,
        code: c.code,
        percent: c.percent,
        until: c.expiresOn
      })
  }
  return { usable, leftOut }
}

/**
 * A planned email's offer works at its own send time (store time), checked
 * exactly as the email build checks it: the code exists, is within the
 * max, and has not ended when the email sends.
 */
export function offerWorksAt(
  slot: {
    date: string
    time: string
    offer: { code: string; percent: number } | null
  },
  offers: PlanOffers,
  timezone: string
) {
  if (!slot.offer) return true
  const sendAt = localTimeCandidates(`${slot.date}T${slot.time}`, timezone)[0]
  if (!sendAt) return false
  const code = offers.codes.find((c) => key(c.code) === key(slot.offer!.code))
  return (
    !!code &&
    code.percent >= 1 &&
    code.percent <= Math.min(100, offers.maxDiscountPercent) &&
    (code.expiresAt === null || Date.parse(code.expiresAt) > Date.parse(sendAt))
  )
}

/** The planned offer emails whose offer would not work when they send (a guard). */
export function offerEmailsThatFail<
  S extends Parameters<typeof offerWorksAt>[0]
>(slots: readonly S[], offers: PlanOffers, timezone: string): S[] {
  return slots.filter((s) => !offerWorksAt(s, offers, timezone))
}

/** The plain story a planned email becomes when it loses its offer. */
export const noOfferStory = {
  angle: 'From the store, in its own words',
  why: 'A note from the store. Its planned offer would not work on this day, so it goes out without a discount.'
}

/**
 * REL-OFF: the safe fallback for an offer that would not work when its
 * email sends (above the max, not one of the working codes, or ended):
 * that email keeps its day, products and audience as a plain story
 * without the offer (the plan's rules let only an "offer" email carry
 * one), with no evidence about the offer. `dropped` are the emails as
 * planned. A send time the store's clock skips is not an offer problem:
 * such an email is left as it is. A guard: the plan's last send days
 * normally ensure every offer works.
 */
export function withoutUnusableOffers(
  slots: readonly PlannedSlot[],
  offers: PlanOffers,
  timezone: string
): { slots: PlannedSlot[]; dropped: PlannedSlot[] } {
  const dropped = offerEmailsThatFail(slots, offers, timezone).filter(
    (s) => localTimeCandidates(`${s.date}T${s.time}`, timezone).length > 0
  )
  return {
    slots: slots.map((s) =>
      dropped.includes(s)
        ? {
            ...s,
            emailType: 'story' as const,
            offer: null,
            ...noOfferStory,
            evidence: s.evidence.filter((e) => !e.id.startsWith('offer:'))
          }
        : s
    ),
    dropped
  }
}

const shortDay = (date: string) =>
  new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC'
  }).format(new Date(`${date}T00:00:00Z`))

/** The plan's note for offers left out of their emails, or null. */
export function droppedOffersNote(dropped: readonly PlannedSlot[]) {
  const all = dropped.flatMap((s) =>
    s.offer ? [`${s.offer.code} on ${shortDay(s.date)}`] : []
  )
  if (!all.length) return null
  const one = dropped.length === 1
  const words = (named: string[]) => {
    const more =
      all.length > named.length ? ` and ${all.length - named.length} more` : ''
    return `Left out of ${one ? 'its email' : 'their emails'} because ${one ? 'it' : 'they'} would not work on that day (above your max, not one of your codes, or ended): ${named.join(', ')}${more}. ${one ? 'That email goes' : 'Those emails go'} out without a discount.`
  }
  // At most ten named, and fewer until the note fits a stored note's 600
  // characters (whole names, a whole sentence).
  for (let n = Math.min(all.length, 10); n > 0; n--) {
    const note = words(all.slice(0, n))
    if (note.length <= 600) return note
  }
  return words([])
}

/**
 * The fallback log's entry for offers left out of a plan: counts and days
 * only, never the codes (the log holds no client codes; the owner's plan
 * note names them).
 */
export function droppedOffersEntry(input: {
  tenantId: string
  runId: string
  dropped: readonly PlannedSlot[]
}) {
  const n = input.dropped.length
  return {
    tenantId: input.tenantId,
    campaignId: null,
    agent: 'plan-offers',
    reasonCode: 'offer_unusable',
    reason: `${n} planned ${n === 1 ? 'offer' : 'offers'} would not work on the day of ${n === 1 ? 'its email' : 'their emails'}.`,
    fallback: `${n === 1 ? 'That email keeps its day' : 'Those emails keep their day'} as a plain story without a discount.`,
    attempts: 1,
    detail: {
      count: n,
      days: input.dropped.map((s) => s.date).slice(0, 10)
    },
    dedupeKey: `plan-offers:${keyPart(input.runId)}:unusable`
  }
}

/**
 * One plain note for the picked offers that no longer work with Settings
 * (at most ten codes named, so the note stays short), or null.
 */
export function leftOutNote(codes: readonly string[]) {
  if (!codes.length) return null
  const named = codes.slice(0, 10).join(', ')
  const more = codes.length > 10 ? ` and ${codes.length - 10} more` : ''
  return `Left out because your offers in Settings changed after they were listed: ${named}${more}.`
}

/** The workspace's one brand timezone ("store time" on every screen). */
export async function workspaceTimezone(
  db: SupabaseClient<Database>,
  tenantId: string
) {
  const { data, error } = await db
    .from('tenants')
    .select('timezone')
    .eq('id', tenantId)
    .maybeSingle()
  if (error) throw error
  return validTimezone(data?.timezone ?? 'UTC')
}
