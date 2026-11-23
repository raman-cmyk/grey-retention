import { z } from 'zod'

/**
 * Exposure (SEG-EXPOSURE-001, a PROPOSAL Raman can change in Settings):
 * how many marketing emails one profile gets, kept apart from campaign
 * volume (30 to 35 campaigns a month across segments can still mean a few
 * emails per person). The engine decides, for each planned slot, which
 * profiles may get it and which are held back, each with its reason. Its
 * rules, in this order:
 *
 * 1. Suppressed and unsubscribed profiles are left out before any segment
 *    is looked at (`suppressed`, then `unsubscribed`).
 * 2. Each profile is counted once across overlapping segments: it gets the
 *    slots of one segment only (`counted_under` for the others' slots).
 * 3. A segment in the policy's `priority` (highest first) wins an overlap.
 * 4. Then a fixed tie-break: the segment whose first slot is scheduled
 *    earliest, then the segment id.
 *
 * The cap: at most `maxMarketing` marketing emails per profile in any
 * rolling `windowDays` (an email sent exactly that long before no longer
 * counts). Transactional mail is its own class and never counts, nor is
 * it held by the cap. Past sends (`history`) count like planned ones; a
 * profile's slots are taken in schedule order, so the later ones are held.
 *
 * The defaults were chosen for this implementation; Raman has not
 * supplied numbers. Pure and provider-neutral: segments are ids with
 * their profile ids. Each workspace's policy is stored and read in
 * SEG-EXP-a2 (`exposurePolicy`).
 */

/** The bounds the database checks too (`save_exposure_policy`). */
export const exposureBounds = {
  windowDays: { min: 1, max: 30 },
  maxMarketing: { min: 1, max: 14 },
  segments: 50
} as const

/** A segment id as the provider gives it (a Klaviyo segment or list). */
export const segmentId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)

export const exposurePolicySchema = z.object({
  windowDays: z
    .number()
    .int()
    .min(exposureBounds.windowDays.min)
    .max(exposureBounds.windowDays.max),
  maxMarketing: z
    .number()
    .int()
    .min(exposureBounds.maxMarketing.min)
    .max(exposureBounds.maxMarketing.max),
  priority: z
    .array(segmentId)
    .max(exposureBounds.segments)
    .refine((ids) => new Set(ids).size === ids.length, 'Each segment once')
})
export type ExposurePolicy = z.infer<typeof exposurePolicySchema>

/** Chosen for this implementation; Raman has not supplied numbers. */
export const defaultExposurePolicy: ExposurePolicy = {
  windowDays: 7,
  maxMarketing: 3,
  priority: []
}

export type SendClass = 'marketing' | 'transactional'
/** A planned email: when it is scheduled (an instant) and to which segments. */
export type PlannedSlot = {
  id: string
  at: string
  segments: readonly string[]
  class: SendClass
}
/** An email a profile already got. */
export type PastSend = { profile: string; at: string; class: SendClass }

export type HoldReason =
  'suppressed' | 'unsubscribed' | 'over_cap' | 'counted_under'
export type Held = {
  profile: string
  reason: HoldReason
  /** For `counted_under`: the segment the profile is counted under. */
  segment?: string
}
export type SlotDecision = { slot: string; send: string[]; held: Held[] }

export type Enforcement = {
  /** Each slot, in schedule order: who gets it, who is held back and why. */
  slots: SlotDecision[]
  /** The one segment each profile is counted under. */
  countsUnder: Record<string, string>
  /** Planned marketing emails each profile gets, within the cap. */
  marketing: Record<string, number>
  /** Campaign volume (slots and the emails they send) against unique people. */
  campaigns: number
  emails: number
  reached: number
}

const instant = (at: string) => {
  const ms = Date.parse(at)
  if (!/^\d{4}-\d{2}-\d{2}T/.test(at) || Number.isNaN(ms))
    throw new Error(`Invalid time: ${at}`)
  return ms
}
const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Whether one more marketing email at `t` keeps every rolling window that
 * holds it within `cap`, given the times already counted.
 */
function fits(times: readonly number[], t: number, size: number, cap: number) {
  const near = times.filter((s) => s > t - size && s < t + size)
  const starts = [t, ...near.filter((s) => s <= t)]
  return starts.every(
    (start) => near.filter((s) => s >= start && s < start + size).length < cap
  )
}

/** Who may get each planned slot, and who is held back and why. Pure. */
export function enforceExposure(input: {
  policy: ExposurePolicy
  segments: Readonly<Record<string, readonly string[]>>
  slots: readonly PlannedSlot[]
  history?: readonly PastSend[]
  suppressed?: Iterable<string>
  unsubscribed?: Iterable<string>
}): Enforcement {
  const policy = exposurePolicySchema.parse(input.policy)
  const size = policy.windowDays * 86_400_000
  const suppressed = new Set(input.suppressed ?? [])
  const unsubscribed = new Set(input.unsubscribed ?? [])
  const members = new Map(
    Object.entries(input.segments).map(([id, m]) => [id, new Set(m)])
  )
  // Schedule order, the same whatever order the slots came in.
  const slots = input.slots
    .map((s) => ({
      ...s,
      ms: instant(s.at),
      segments: [...new Set(s.segments)].sort(byId)
    }))
    .sort((a, b) => a.ms - b.ms || byId(a.id, b.id))
  // Rules 3 and 4: a segment's rank, from its priority, its first slot and its id.
  const first = new Map<string, number>()
  for (const s of slots)
    for (const g of s.segments) if (!first.has(g)) first.set(g, s.ms)
  const priority = new Map(policy.priority.map((g, i) => [g, i]))
  const rank = (a: string, b: string) =>
    (priority.get(a) ?? Infinity) - (priority.get(b) ?? Infinity) ||
    first.get(a)! - first.get(b)! ||
    byId(a, b)
  // Rule 2: the one targeted segment each profile counts under.
  const countsUnder: Record<string, string> = {}
  for (const g of [...first.keys()].sort(rank))
    for (const p of members.get(g) ?? [])
      if (!suppressed.has(p) && !unsubscribed.has(p) && !(p in countsUnder))
        countsUnder[p] = g
  // Past marketing emails, and the planned ones allowed so far.
  const counted = new Map<string, number[]>()
  for (const h of input.history ?? [])
    if (h.class === 'marketing')
      counted.set(h.profile, [...(counted.get(h.profile) ?? []), instant(h.at)])
  const marketing: Record<string, number> = {}
  const reached = new Set<string>()
  let emails = 0
  const decisions = slots.map((slot): SlotDecision => {
    const audience = new Set(
      slot.segments.flatMap((g) => [...(members.get(g) ?? [])])
    )
    const send: string[] = []
    const held: Held[] = []
    for (const p of [...audience].sort(byId)) {
      // Rule 1, before any segment.
      if (suppressed.has(p)) held.push({ profile: p, reason: 'suppressed' })
      else if (unsubscribed.has(p))
        held.push({ profile: p, reason: 'unsubscribed' })
      else if (!slot.segments.includes(countsUnder[p]!))
        held.push({
          profile: p,
          reason: 'counted_under',
          segment: countsUnder[p]
        })
      else if (slot.class === 'transactional') send.push(p)
      else if (fits(counted.get(p) ?? [], slot.ms, size, policy.maxMarketing)) {
        counted.set(p, [...(counted.get(p) ?? []), slot.ms])
        marketing[p] = (marketing[p] ?? 0) + 1
        send.push(p)
      } else held.push({ profile: p, reason: 'over_cap' })
    }
    for (const p of send) reached.add(p)
    emails += send.length
    return { slot: slot.id, send, held }
  })
  return {
    slots: decisions,
    countsUnder,
    marketing,
    campaigns: slots.length,
    emails,
    reached: reached.size
  }
}
