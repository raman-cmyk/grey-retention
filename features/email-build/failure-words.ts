/**
 * REL-084 (owner pick 84): never fail silently. Every code a "Create
 * email" build can stop with, and its plain words for the owner. The job
 * may store only these codes (`BuildFailureCode`), so a new code cannot
 * ship without words; anything unexpected is stored as `step_error`. The
 * words never repeat an error's own message.
 */
export const buildFailureWords = {
  // The build steps (EML-004 part 2, REL-081).
  planned_email_invalid: 'This planned email cannot be built. Plan again.',
  slot_time_invalid: 'Its send time does not exist in your time zone.',
  offers_unreadable: 'Your saved offers could not be read. Try again.',
  copy_failed: 'Its words did not pass the checks.',
  subject_taken:
    'Every subject it could use is used by another email in this plan. Plan again for new emails.',
  render_failed: 'Its design could not be drawn.',
  offer_unsafe:
    'Its discount code was not one of your working codes within your max discount. Try again.',
  built_email_invalid: 'The finished email was not complete.',
  email_too_large: 'It came out too large to save.',
  step_output_invalid: 'One of its steps could not be saved.',
  step_progress_invalid:
    'The app was updated while this email was being made. Try again.',
  step_unknown:
    'The app was updated while this email was being made. Try again.',
  store_changed:
    'Your store data changed while this email was being made. Try again.',
  store_data_invalid: 'Your store data could not be read. Try again.',
  // The job queue (claim_email_build).
  day_passed: 'Its day passed before it was ready.',
  step_timed_out: 'One of its steps kept stopping before it finished.',
  step_error: 'Something went wrong while it was being made. Try again.',
  // The push into Klaviyo (DraftPusher).
  klaviyo_auth:
    'Klaviyo did not accept the connection. Check it on the Connections page.',
  klaviyo_rejected: 'Klaviyo, or the last check before Klaviyo, refused it.',
  klaviyo_rate_limited: 'Klaviyo was busy for too long. Try again later.',
  klaviyo_unavailable: 'Klaviyo could not be reached. Try again later.'
} as const satisfies Record<string, string>

export type BuildFailureCode = keyof typeof buildFailureWords

/** A code the build may store: its own, or `step_error`. */
export const buildCode = (code: string): BuildFailureCode =>
  Object.hasOwn(buildFailureWords, code)
    ? (code as BuildFailureCode)
    : 'step_error'

/** Plain words for a failed build: its own, or the plain fallback. */
export const buildReason = (code: string | null) =>
  buildFailureWords[buildCode(code ?? '')]
