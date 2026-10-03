import {
  plannedEntrySchema,
  planningViolations,
  type PlannedEntry,
  type PlanGuardRow
} from './guards'
export function generateRollingFixture(input: {
  start: string
  timezone: string
  audienceId: string
  brandName: string
  existing: PlanGuardRow[]
  evergreenOffer: { id: string; startsAt: string; endsAt: string } | null
  policy: { weeklyCap: number; discountCap: number; sitewideGap: number }
}) {
  const entries: PlannedEntry[] = [],
    accepted = [...input.existing],
    start = new Date(input.start)
  for (let day = 0; day < 30; day++) {
    const date = new Date(start)
    date.setUTCDate(date.getUTCDate() + day)
    // Daily UTC slots are explicit; tenant-local week boundaries are independently guarded.
    const weekday = new Intl.DateTimeFormat('en', {
      timeZone: input.timezone,
      weekday: 'short'
    }).format(date)
    if (['Sat', 'Sun'].includes(weekday)) continue
    const offer =
      input.evergreenOffer &&
      date >= new Date(input.evergreenOffer.startsAt) &&
      date < new Date(input.evergreenOffer.endsAt)
        ? input.evergreenOffer.id
        : null
    const candidate = {
      id: `proposed-${day}`,
      audienceId: input.audienceId,
      plannedAt: date.toISOString(),
      discounted: false,
      sitewide: false,
      offerId: offer
    }
    if (
      planningViolations(candidate, accepted, input.timezone, input.policy)
        .length
    )
      continue
    const ordinal = entries.length + 1,
      sequencePosition = ordinal % 2 === 1 ? 1 : 2
    entries.push(
      plannedEntrySchema.parse({
        title:
          `${input.brandName}: ${sequencePosition === 1 ? 'a considered introduction' : 'a closer look'} · Synthetic ${ordinal}`.slice(
            0,
            200
          ),
        goal: 'Original fixture editorial; approved brand facts only. No invented offer, urgency, proof or stock claim.',
        plannedAt: date.toISOString(),
        audienceId: input.audienceId,
        productId: null,
        offerId: offer,
        channel: 'email_design',
        sequenceKey: `education-${Math.floor((ordinal - 1) / 2)}`,
        sequencePosition,
        referenceNotes:
          'Hero → focused explanation → one CTA → footer. Structural inspiration only; original brand copy required.'
      })
    )
    accepted.push(candidate)
  }
  return { synthetic: true as const, entries }
}
