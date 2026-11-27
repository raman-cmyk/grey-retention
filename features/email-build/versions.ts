import { storeTime } from '@/features/results/klaviyo-state'
import { builtEmail } from './build'
import { buildReason } from './failure-words'
import { maxEmailBytes } from './step-names'

/**
 * PICK-106 (owner pick #106): an email's version history, as its page
 * shows it. Every email GROS made or made again for a planned email is a
 * version (`email_versions`, written with the build's finish), and the
 * owner can bring an older one back ("Use this version"), which is kept as
 * a new version: history is never rewritten. Pure.
 */

/** How a version was made, as `email_versions.how` stores it. */
export const versionHows = [
  'scratch',
  'library_copy',
  'upload_copy',
  'remix',
  'try_again',
  'restore'
] as const
export type VersionHow = (typeof versionHows)[number]

/** Versions kept per planned email (`private.email_versions_kept()`). */
export const versionsKept = 20

/** A version as the list reads it (its email is read only when shown). */
export type VersionRow = {
  number: number
  how: string
  restoredFrom: number | null
  /** A restore's push: pending, applied or failed (null: made by GROS). */
  outcome?: string | null
  /** A failed restore's code (`buildReason` words). */
  failure?: string | null
  subject: string
  createdAt: string
}

/** One line of the list: "Version 3 · Today 10:40 · Made again with Try again". */
export type VersionLine = {
  number: number
  label: string
  subject: string
  /** What the email is now: the newest not pending or failed restore. */
  current: boolean
  /** The one whose preview is shown. */
  shown: boolean
  /** A restore still being put on the draft, or one that did not get there (and why). */
  state: 'pending' | 'failed' | null
  /** Why a failed restore did not get there, in the owner's words. */
  failure: string | null
}

export type VersionsView = {
  lines: VersionLine[]
  /** The newest version's number: the page sends it with "Use this version". */
  newest: number
  /** The current version's number (null: none, all pending or failed). */
  current: number | null
  /** True when as many are kept as the limit: older ones were let go. */
  full: boolean
}

const howWords: Record<VersionHow, string> = {
  scratch: 'Made from scratch',
  library_copy: 'Copied from an email you chose',
  upload_copy: 'Copied from your own email',
  remix: 'Remixed from an email you chose',
  try_again: 'Made again with Try again',
  restore: 'Brought back'
}

/**
 * How it was made, in the owner's words. `kept`: the numbers still kept
 * (a restore whose source was let go says so).
 */
export function howText(
  how: string,
  restoredFrom: number | null,
  kept?: ReadonlySet<number>
) {
  if (how === 'restore')
    return restoredFrom
      ? `Version ${restoredFrom}${kept && !kept.has(restoredFrom) ? ' (no longer kept)' : ''} brought back`
      : 'Brought back'
  return (versionHows as readonly string[]).includes(how)
    ? howWords[how as VersionHow]
    : 'Made by GROS'
}

const day = (at: number, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone
  }).format(new Date(at))

/** "Today 10:40", "Yesterday 10:40", else "26 Nov, 10:40" (store time). */
export function versionTime(
  iso: string,
  timeZone: string,
  now: number = Date.now()
) {
  const t = Date.parse(iso)
  const full = storeTime(iso, timeZone, now)
  if (!Number.isFinite(t) || !full) return null
  const clock = full.slice(full.lastIndexOf(', ') + 2)
  try {
    const on = day(t, timeZone)
    if (on === day(now, timeZone)) return `Today ${clock}`
    if (on === day(now - 86_400_000, timeZone)) return `Yesterday ${clock}`
  } catch {
    return full
  }
  return full
}

/**
 * The list, newest first. `shown`: the version whose preview the page
 * shows (the newest when none or an unknown one is asked for).
 */
export function versionsView(
  rows: readonly VersionRow[],
  options: { timezone: string; shown?: number | null; now?: number }
): VersionsView | null {
  if (!rows.length) return null
  const sorted = [...rows].sort((a, b) => b.number - a.number)
  const newest = sorted[0]!.number
  const current =
    sorted.find((r) => r.outcome !== 'pending' && r.outcome !== 'failed')
      ?.number ?? null
  const kept = new Set(sorted.map((r) => r.number))
  const shown = kept.has(options.shown ?? -1)
    ? options.shown!
    : (current ?? newest)
  return {
    newest,
    current,
    full: sorted.length >= versionsKept,
    lines: sorted.map((r) => {
      const state =
        r.outcome === 'pending' || r.outcome === 'failed' ? r.outcome : null
      return {
        number: r.number,
        label: [
          `Version ${r.number}`,
          versionTime(r.createdAt, options.timezone, options.now),
          howText(r.how, r.restoredFrom, kept),
          r.number === current
            ? 'Current'
            : state === 'pending'
              ? 'Being put on your draft'
              : state === 'failed'
                ? 'Not used'
                : null
        ]
          .filter(Boolean)
          .join(' · '),
        subject: r.subject,
        current: r.number === current,
        shown: r.number === shown,
        state,
        failure: state === 'failed' ? buildReason(r.failure ?? null) : null
      }
    })
  }
}

/**
 * A stored version the app can still put back: it reads as a built email
 * of today's shape and fits the stored email's size (`maxEmailBytes`).
 * Null otherwise (one stored the way an older app stored it).
 */
export function usableVersion(email: unknown) {
  const parsed = builtEmail.safeParse(email)
  if (!parsed.success) return null
  if (Buffer.byteLength(JSON.stringify(parsed.data)) > maxEmailBytes)
    return null
  return parsed.data
}

/** The restore's refusals, by the command's stable hints, in plain words. */
export const restoreWords: Record<string, string> = {
  version_busy:
    'This email is being made or put in Klaviyo right now. Wait until it is done, then try again.',
  version_not_drafted:
    'This email is not a draft, so there is nothing to change. Create it again from the plan.',
  version_stale:
    'This email changed since you opened the page. Reload the page to see its versions.',
  version_unknown:
    'This version is no longer kept. Reload the page to see the versions there are.',
  version_current: 'This is already the version your email has.',
  version_sent:
    'This email was already sent from Klaviyo, so it cannot be changed.',
  version_scheduled:
    'This email is scheduled in Klaviyo, so GROS will not change it. Unschedule it in Klaviyo first.',
  version_gone:
    'This draft was deleted or cancelled in Klaviyo, so there is nothing to change.',
  version_edited:
    'You changed this draft in Klaviyo, so GROS leaves it as it is.',
  version_day_passed:
    'This email’s day has passed, so its draft is not changed any more.',
  version_plan_replaced:
    'This email’s plan has been replaced by a newer one, so it is not changed any more.',
  version_no_email: 'This email is not one of yours.'
}

/**
 * PICK-106: where "Use this version" would put the email, exactly as the
 * push would (`pushRoute`, the live pusher's write lock included):
 * - `sample`: a sample draft stays one (the fake pusher, no Klaviyo call);
 * - `replace`: GROS's draft in Klaviyo is updated;
 * - `new_draft`: a sample draft of the store's own email becomes a real
 *   draft in Klaviyo (the push switch was turned on since);
 * - `off`: Klaviyo holds the draft and cannot be written now (the switch
 *   off or the write lock on): nothing happens.
 */
export type RestoreRoute = 'sample' | 'replace' | 'new_draft' | 'off'

export function restoreRoute(input: {
  /** `pushRoute` for the version's email. */
  route: 'fake' | 'live' | 'locked'
  /** The build is a sample draft (it never reached Klaviyo). */
  sampleDraft: boolean
  /** The live pusher wrote a push row for this planned email's key. */
  pushRow: boolean
}): RestoreRoute {
  const inKlaviyo = !input.sampleDraft || input.pushRow
  if (input.route === 'locked') return 'off'
  if (input.route === 'fake') return inKlaviyo ? 'off' : 'sample'
  return inKlaviyo ? 'replace' : 'new_draft'
}

/** What happens on "Use this version", in the owner's words. */
export const restoreRouteWords: Record<RestoreRoute, string> = {
  sample:
    'It becomes the current version of your sample draft. Nothing goes to Klaviyo.',
  replace:
    'It becomes the current version and replaces GROS’s draft in Klaviyo. Nothing is scheduled or sent.',
  new_draft:
    'It becomes the current version and goes into Klaviyo as a draft. Nothing is scheduled or sent.',
  off: 'Putting emails into Klaviyo is switched off right now, so your draft in Klaviyo cannot be changed.'
}
