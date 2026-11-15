import { keyPart } from '@/features/fallback/entry'
import { addDays, pulseDays } from './pulse'
import type { PlannedSlot } from './plan'

/**
 * REL-DAT: a planned email's day is one of its plan's 15 days (from the
 * plan's first day). Dates compare as `YYYY-MM-DD` text.
 */
export function inPlanWindow(date: string, start: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    date >= start &&
    date <= addDays(start, pulseDays - 1)
  )
}

/**
 * REL-DAT: a last guard on a finished plan: an email outside its 15 days
 * (the calendar rules and the code calendar already keep every email
 * inside them) is left out, named in the plan's notes and logged.
 */
export function slotsInWindow(slots: readonly PlannedSlot[], start: string) {
  const kept = slots.filter((s) => inPlanWindow(s.date, start))
  return { slots: kept, dropped: slots.filter((s) => !kept.includes(s)) }
}

/** The plan's note for emails left out for their day, or null. */
export function outsideWindowNote(dropped: readonly PlannedSlot[]) {
  if (!dropped.length) return null
  return dropped.length === 1
    ? 'One email was left out: its day was not in these 15 days.'
    : `${dropped.length} emails were left out: their days were not in these 15 days.`
}

/** The fallback log's entry for them: counts only. */
export function outsideWindowEntry(input: {
  tenantId: string
  runId: string
  dropped: readonly PlannedSlot[]
}) {
  const n = input.dropped.length
  return {
    tenantId: input.tenantId,
    campaignId: null,
    agent: 'plan-dates',
    reasonCode: 'slot_outside_plan',
    reason: `${n} planned ${n === 1 ? 'email was' : 'emails were'} outside the plan's 15 days.`,
    fallback: `Left ${n === 1 ? 'it' : 'them'} out of the plan.`,
    attempts: 1,
    detail: { count: n },
    dedupeKey: `plan-dates:${keyPart(input.runId)}`
  }
}
