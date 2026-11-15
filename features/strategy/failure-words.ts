/**
 * REL-084 (owner pick 84): never fail silently. Every code a "Create
 * email" build or a "Plan next 15 days" run can stop with has plain words
 * the owner can read, and a code without its own words still gets a plain
 * sentence, never nothing. The words never repeat an error's own message.
 */

/** Why a "Create email" build stopped, by its `email_builds.error_code`. */
export const buildFailureWords: Record<string, string> = {
  // The build steps (EML-004 part 2, REL-081).
  planned_email_invalid: 'This planned email cannot be built. Plan again.',
  slot_time_invalid: 'Its send time does not exist in your time zone.',
  copy_failed: 'Its words did not pass the checks.',
  render_failed: 'Its design could not be drawn.',
  built_email_invalid: 'The finished email was not complete.',
  email_too_large: 'It came out too large to save.',
  step_output_invalid: 'It came out too large to save.',
  step_progress_invalid:
    'The app was updated while this email was being made. Try again.',
  step_unknown:
    'The app was updated while this email was being made. Try again.',
  store_changed:
    'Your store data changed while this email was being made. Try again.',
  store_data_invalid: 'Your store data could not be read.',
  // The job queue (claim_email_build).
  day_passed: 'Its day passed before it was ready.',
  step_timed_out: 'One of its steps kept stopping before it finished.',
  step_error: 'Something went wrong while it was being made.',
  // The push into Klaviyo (DraftPusher).
  klaviyo_auth: 'Klaviyo did not accept the connection.',
  klaviyo_rejected: 'Klaviyo or the launch check refused it.',
  klaviyo_rate_limited: 'Klaviyo was busy for too long.',
  klaviyo_unavailable: 'Klaviyo could not be reached.'
}

/** Why a "Plan next 15 days" run stopped, by its `strategy_runs.error_code`. */
export const planFailureWords: Record<string, string> = {
  out_of_date: 'Its 15 days began before the plan was ready.',
  step_timed_out: 'A step kept stopping before it finished.',
  step_error: 'Something went wrong while planning.',
  store_data_invalid: 'Your store data could not be read.',
  store_wrong_days: 'Your store data was for other days.',
  stored_pulse_invalid: 'The listed offers could not be read back.',
  stored_pick_invalid: 'Your offer choice could not be read back.',
  pick_not_in_pulse: 'An offer you picked was not in the list.',
  plan_offer_unusable: 'A planned offer would not work on its day.',
  offers_unreadable: 'Your saved offers could not be read.'
}

const buildFallback = 'Something went wrong while it was being made.'
const planFallback = 'Something went wrong while planning.'

/** Plain words for a failed build: its own, or a plain sentence. */
export const buildReason = (code: string | null) =>
  (code && Object.hasOwn(buildFailureWords, code)
    ? buildFailureWords[code]
    : null) ?? buildFallback

/** Plain words for a failed plan run: its own, or a plain sentence. */
export const planReason = (code: string | null) =>
  (code && Object.hasOwn(planFailureWords, code)
    ? planFailureWords[code]
    : null) ?? planFallback
