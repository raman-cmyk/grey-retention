import { z } from 'zod'
import { developmentPolicy } from '@/features/workflow/domain/policy'
export const plannedEntrySchema = z.object({
  title: z.string().min(2).max(200),
  goal: z.string().max(5000),
  plannedAt: z.iso.datetime(),
  audienceId: z.uuid(),
  productId: z.uuid().nullable(),
  offerId: z.uuid().nullable(),
  channel: z.enum(['email_design', 'email_text']),
  sequenceKey: z.string().max(100).nullable(),
  sequencePosition: z.number().int().min(1).max(10).nullable(),
  holidayId: z.uuid().nullable().optional(),
  referenceNotes: z.string().max(5000)
})
export type PlannedEntry = z.infer<typeof plannedEntrySchema>
export type PlanGuardRow = {
  id: string
  audienceId: string
  plannedAt: string
  discounted: boolean
  sitewide: boolean
  offerId: string | null
}
export function localWeek(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date(value)),
    get = (type: string) => parts.find((p) => p.type === type)!.value
  const date = new Date(
    `${get('year')}-${get('month')}-${get('day')}T12:00:00Z`
  )
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
  return date.toISOString().slice(0, 10)
}
export function planningViolations(
  candidate: PlanGuardRow,
  others: PlanGuardRow[],
  timezone: string,
  policy = { weeklyCap: 5, discountCap: 40, sitewideGap: 7 }
) {
  const p = {
    weeklyCap: Math.min(policy.weeklyCap, developmentPolicy.weeklyAudienceCap),
    discountCap: Math.min(
      policy.discountCap,
      developmentPolicy.discountCapPercent
    ),
    sitewideGap: Math.max(
      policy.sitewideGap,
      developmentPolicy.sitewideSpacingDays
    )
  }
  const cohort = [
    ...others.filter(
      (r) =>
        r.id !== candidate.id &&
        r.audienceId === candidate.audienceId &&
        localWeek(r.plannedAt, timezone) ===
          localWeek(candidate.plannedAt, timezone)
    ),
    candidate
  ]
  const errors: string[] = []
  if (cohort.length > p.weeklyCap) errors.push('weekly_cadence')
  if (
    cohort.filter((r) => r.discounted).length * 100 >
    cohort.length * p.discountCap
  )
    errors.push('discount_share')
  if (
    candidate.sitewide &&
    others.some(
      (r) =>
        r.id !== candidate.id &&
        r.sitewide &&
        Math.abs(Date.parse(r.plannedAt) - Date.parse(candidate.plannedAt)) <
          p.sitewideGap * 86400000
    )
  )
    errors.push('sitewide_spacing')
  return errors
}
export function copyClaimErrors(input: {
  text: string
  allowedDiscount: number | null
  deadline: string | null
  forbiddenPhrases: string[]
}) {
  const errors: string[] = []
  for (const m of input.text.matchAll(/(\d+(?:\.\d+)?)\s*%/g))
    if (input.allowedDiscount === null || Number(m[1]) > input.allowedDiscount)
      errors.push('unverified_discount')
  for (const m of input.text.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g))
    if (input.deadline !== m[0]) errors.push('unverified_deadline')
  if (
    input.forbiddenPhrases.some(
      (p) => p && input.text.toLowerCase().includes(p.toLowerCase())
    )
  )
    errors.push('owner_prohibition')
  if (/\b(cure|guaranteed results|clinically proven)\b/i.test(input.text))
    errors.push('unsupported_claim')
  return [...new Set(errors)]
}
export function silenceDecision(input: {
  now: string
  createdAt: string
  seenRevision: number
  currentRevision: number
  conditionalPolicy: boolean
  eligible: boolean
  rejected: boolean
  designApproved: boolean
}) {
  const approveCopy =
    input.conditionalPolicy &&
    input.eligible &&
    !input.rejected &&
    input.seenRevision === input.currentRevision &&
    Date.parse(input.now) >=
      Date.parse(input.createdAt) + developmentPolicy.silenceHours * 3600000
  return {
    approveCopy,
    schedule: approveCopy && input.designApproved,
    productionEnabled: false as const
  }
}
