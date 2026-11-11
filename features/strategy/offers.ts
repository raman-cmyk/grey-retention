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

/** The plan's offers: the owner's, or the sample's from the plan's first day. */
export const planOfferSource = (
  saved: SavedOffers,
  start: string
): OfferSource => ownerOrSampleOffers(saved, sampleOffersFrom(start))

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
 * The last store-local day a code works all day: the plan's inclusive
 * `until`. A code ending at 2 pm on the 20th works all day only until the
 * 19th, so no planned send on the 20th can miss it. Null: no end.
 */
export function lastFullDay(expiresAt: string | null, timezone: string) {
  if (expiresAt === null) return null
  return addDays(localDateTime(expiresAt, timezone).slice(0, 10), -1)
}

/** The pulse's code rows: each code that works for at least one whole planned day. */
export function pulseCodes(
  offers: PlanOffers,
  start: string,
  timezone: string
) {
  return offers.codes.flatMap((c) => {
    const expiresOn = lastFullDay(c.expiresAt, timezone)
    return expiresOn !== null && expiresOn < start
      ? []
      : [{ code: c.code, percent: c.percent, expiresOn }]
  })
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
    pulseCodes(offers, start, timezone).map((c) => [key(c.code), c])
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
