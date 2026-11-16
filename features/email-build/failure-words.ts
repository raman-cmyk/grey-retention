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
  send_time_passed:
    'Its send time had passed before it was made. Plan again for new emails.',
  slot_outside_plan: 'Its day is not one of its plan’s 15 days. Plan again.',
  offers_unreadable: 'Your saved offers could not be read. Try again.',
  copy_failed: 'Its words did not pass the checks.',
  subject_taken:
    'Every subject it could use is used by another email in this plan. Plan again for new emails.',
  render_failed: 'Its design could not be drawn.',
  offer_unsafe:
    'Its discount code was not one of your working codes within your max discount. Try again.',
  built_email_invalid: 'The finished email was not complete.',
  email_too_large: 'It came out too large to save.',
  hard_check_failed:
    'It did not pass the email checks (size, width, links, pictures’ words, footer or offer). Try again.',
  step_output_invalid: 'One of its steps could not be saved.',
  step_progress_invalid:
    'The app was updated while this email was being made. Try again.',
  step_unknown:
    'The app was updated while this email was being made. Try again.',
  store_changed:
    'Your store data changed while this email was being made. Try again.',
  plan_store_changed:
    'This plan was made from other store data. Plan next 15 days again.',
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

/**
 * REL-084c: why Klaviyo, or the last check before it, refused the draft,
 * by the pusher's own reason (`klaviyo_draft_pushes.reason`, PSH-001), in
 * place of the one word `klaviyo_rejected` gives a dozen refusals. Fixed
 * words: never Klaviyo's own message.
 */
export const pushRefusalWords = {
  // Before Klaviyo is called.
  sample_email:
    'It was made from the sample store, so it never goes to Klaviyo.',
  audience_not_in_klaviyo:
    'Its audience is not one of your Klaviyo lists or segments. Plan again.',
  no_push_lease:
    'The app could not hold this email while sending it to Klaviyo. Try again.',
  variations_invalid: 'Its two designs were not both complete. Try again.',
  content_not_checked:
    'Its last content checks had not run, so it was not sent to Klaviyo.',
  footer_missing:
    'Its footer was missing Klaviyo’s unsubscribe link or your address.',
  too_big_for_gmail: 'It was too large: Gmail would cut it off.',
  image_not_importable: 'One of its pictures could not be copied into Klaviyo.',
  too_many_pictures: 'It had more pictures than Klaviyo takes in one email.',
  // The draft already in Klaviyo.
  externally_modified:
    'Its draft was changed or deleted in Klaviyo, so it was left as it is.',
  not_a_draft:
    'Its campaign in Klaviyo is no longer a draft (it was scheduled or sent), so it was left alone.',
  campaign_ambiguous:
    'Its draft in Klaviyo has more than one message, so it was left alone.',
  audience_changed:
    'Its audience changed after its draft was made, so the draft was left as it is. Plan again.',
  // While it was being put into Klaviyo.
  image_refused: 'Klaviyo would not take one of its pictures.',
  final_checks:
    'The last check before Klaviyo found a problem (its size, footer or pictures). Try again.',
  designs_unknown:
    'Its two designs could not be told apart in Klaviyo. Try again later.',
  ab_test_unsafe: 'Its A/B test could not be set up safely in Klaviyo.'
} as const satisfies Record<string, string>

/** The words for a push refusal the pusher stored, or null for one it did not. */
export const pushReason = (reason: string | null | undefined) =>
  reason && Object.hasOwn(pushRefusalWords, reason)
    ? pushRefusalWords[reason as keyof typeof pushRefusalWords]
    : null
