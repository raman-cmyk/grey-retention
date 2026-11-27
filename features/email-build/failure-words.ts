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
  format_changed:
    'This email was switched between designed and text while it was being made. Try again.',
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
  klaviyo_unavailable: 'Klaviyo could not be reached. Try again later.',
  // PICK-106: the draft is in Klaviyo, and putting emails there is off.
  push_switched_off:
    'Putting emails into Klaviyo is switched off right now, so its draft in Klaviyo was left as it is.',
  // PICK-106: a restored version no longer passes the checks of today.
  restore_unsafe:
    'This version no longer passes today’s checks (its code, offer, words or Klaviyo state), so its draft was left as it is.'
} as const satisfies Record<string, string>

/**
 * REL-084c: why the app's own checks, before or while the draft goes into
 * Klaviyo, refused it, by the pusher's reason (`Refused`, also kept on the
 * push row, PSH-001), in place of the one word `klaviyo_rejected` gives a
 * dozen refusals. The build stores it in its own code
 * (`klaviyo_refused_<reason>`), so the words are always this build's,
 * never an earlier try's. Fixed words: never Klaviyo's own message.
 */
export const pushRefusalWords = {
  // Before Klaviyo is called.
  testing_write_lock:
    'Writing to Klaviyo is switched off in the app for now, so no draft was made. Nothing was sent.',
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
    'Its footer was missing one of the parts Klaviyo needs: your brand name, your address, the unsubscribe link, the preferences link or the “view in browser” link.',
  too_big_for_gmail: 'It was too large: Gmail would cut it off.',
  image_not_importable:
    'One of its pictures cannot go into Klaviyo: it needs a JPG, PNG or GIF at a plain https address.',
  too_many_pictures:
    'It had more than 40 pictures, the most the app puts into one email.',
  // The draft already in Klaviyo (PICK-99: never overwrite the owner's work).
  externally_modified:
    'You changed or deleted this email’s draft in Klaviyo, so GROS will not replace it. Plan next 15 days to make a new email instead.',
  not_a_draft:
    'This email is no longer a draft in Klaviyo (it was scheduled, sent or cancelled there), so GROS will not replace it. Plan next 15 days to make a new email instead.',
  edited_in_klaviyo:
    'You changed this email in Klaviyo, so GROS will not replace it. Plan next 15 days to make a new email instead.',
  scheduled_in_klaviyo:
    'You scheduled this email in Klaviyo, so GROS will not replace it. Plan next 15 days to make a new email instead.',
  sent_in_klaviyo:
    'This email was sent from Klaviyo, so GROS will not replace it. Plan next 15 days to make a new email instead.',
  deleted_in_klaviyo:
    'You deleted this email’s draft in Klaviyo, so GROS will not put it back. Plan next 15 days to make a new email instead.',
  cancelled_in_klaviyo:
    'This email was cancelled in Klaviyo, so GROS will not replace it. Plan next 15 days to make a new email instead.',
  campaign_ambiguous:
    'The app could not tell for sure which draft in Klaviyo is this email’s, so it left the draft alone.',
  audience_changed:
    'Its audience changed after its draft was made, so the draft was left as it is. Plan again.',
  // While it was being put into Klaviyo.
  image_refused: 'Klaviyo would not take one of its pictures.',
  final_checks:
    'The last check before Klaviyo found a problem (its size, footer or pictures). Try again.',
  designs_unknown:
    'Its design could not be found in its draft in Klaviyo. Try again later.',
  ab_test_unsafe:
    'Its A/B test could not be set up safely in Klaviyo. Its draft may still have both designs: check it in Klaviyo before you schedule it.'
} as const satisfies Record<string, string>

export type PushRefusal = keyof typeof pushRefusalWords
const refusedPrefix = 'klaviyo_refused_'

export type BuildFailureCode =
  keyof typeof buildFailureWords | `klaviyo_refused_${PushRefusal}`

/** The code a build refused by the pusher stores: its reason, or the general `klaviyo_rejected`. */
export const refusedCode = (reason: string | null | undefined) =>
  reason && Object.hasOwn(pushRefusalWords, reason)
    ? (`${refusedPrefix}${reason}` as BuildFailureCode)
    : 'klaviyo_rejected'

/** The pusher's refusal a build code names, or null. */
const refusalOf = (code: string) =>
  code.startsWith(refusedPrefix) &&
  Object.hasOwn(pushRefusalWords, code.slice(refusedPrefix.length))
    ? (code.slice(refusedPrefix.length) as PushRefusal)
    : null

/** A code the build may store: its own, or `step_error`. */
export const buildCode = (code: string): BuildFailureCode =>
  Object.hasOwn(buildFailureWords, code) || refusalOf(code)
    ? (code as BuildFailureCode)
    : 'step_error'

/** Plain words for a failed build: its own, or the plain fallback. */
export const buildReason = (code: string | null) => {
  const refusal = refusalOf(code ?? '')
  return refusal
    ? pushRefusalWords[refusal]
    : buildFailureWords[buildCode(code ?? '') as keyof typeof buildFailureWords]
}
