/**
 * REL-084 (owner pick 84): never fail silently. Every code a "Plan next 15
 * days" run can stop with, and its plain words for the owner. The job may
 * store only these codes (`PlanFailureCode`); anything unexpected is
 * stored as `step_error`. The words never repeat an error's own message.
 */
export const planFailureWords = {
  out_of_date: 'Its 15 days began before the plan was ready.',
  step_timed_out: 'A step kept stopping before it finished.',
  step_error: 'Something went wrong while planning. Try again.',
  store_data_invalid: 'Your store data could not be read. Try again.',
  store_wrong_days: 'Your store data did not match these 15 days.',
  stored_pulse_invalid: 'The offers listed for this plan could not be read.',
  stored_pick_invalid: 'Your offer choice could not be read.',
  pick_not_in_pulse: 'An offer you picked was not in the list.',
  plan_offer_unusable: 'A planned offer would not work on its day.',
  offers_unreadable: 'Your saved offers could not be read. Try again.'
} as const satisfies Record<string, string>

export type PlanFailureCode = keyof typeof planFailureWords

/** A code the plan job may store: its own, or `step_error`. */
export const planCode = (code: string): PlanFailureCode =>
  Object.hasOwn(planFailureWords, code)
    ? (code as PlanFailureCode)
    : 'step_error'

/** Plain words for a failed plan run: its own, or the plain fallback. */
export const planReason = (code: string | null) =>
  planFailureWords[planCode(code ?? '')]
