import { createHash } from 'node:crypto'
import {
  emailChecklist,
  emailLabels,
  maxEmailPictureBytes,
  type EmailPicture,
  type EmailVerdict,
  type EmailViews
} from './email-critic'
import { studioWaits } from './limits'
import type { BuildView } from './waits'

/**
 * DST-006d part 2b: the whole-email check on an email the design studio
 * drew pictures for, once it passes the hard checks (DST-005). Its three
 * views are asked for (DST-005b) and waited for as the studio's pictures
 * are: within their own window (`emailViewsMs`, from when they are first
 * asked for) and the design step's waits, one of which the rounds keep
 * for them. Then the Design critic judges the whole email (part 1).
 * Desktop and phone are needed; dark is judged when it came in time.
 * Anything short of a pass, the caller draws the email with its coded
 * blocks (D16), with the reason in the owner's words: the studio's
 * pictures are then not used, as a section's picture the critic did not
 * pass is not.
 */

/**
 * The key of one version of the email: its views are asked for, and found
 * again, under it.
 */
export const viewKey = (html: string) =>
  `e-${createHash('sha256').update(html).digest('hex').slice(0, 24)}`

/**
 * The views' own window, from when they are first asked for: the browser
 * outside the app runs every 10 minutes (and a scheduled run can be
 * late), so two of its runs fit.
 */
export const emailViewsMs = 25 * 60_000

export type DrawnView = Extract<BuildView, { state: 'drawn' }>

/** The ports the whole-email check uses (DST-006d), under the build's lease. */
export type EmailViewPorts = {
  /**
   * Asks for the email's three views under `key` (`requestEmailRender`):
   * the same again is the same views. Throws `EmailNotDrawable` for an
   * email that cannot be drawn and the database's refusals as they come.
   */
  ask: (key: string, html: string) => Promise<void>
  /** The build's views under `key`, in its own workspace (`buildViews`). */
  views: (key: string) => Promise<BuildView[]>
  /** A view's stored picture, only while its tag, size and bytes are the ones recorded; else null. */
  picture: (view: DrawnView) => Promise<EmailPicture | null>
  /** The Design critic on the whole email (`critiqueEmail`); null when it cannot answer. */
  judge: (views: EmailViews) => Promise<EmailVerdict | null>
}

export const emailCheckReasons = {
  not_drawable: 'The email could not be drawn in the inbox views.',
  too_many: 'The email was drawn in the inbox views too often.',
  no_time_left: 'The design studio had no time left to check the whole email.',
  no_time: 'The inbox views did not come in time.',
  view_failed: 'The inbox views could not be drawn.',
  view_unusable: 'An inbox view could not be read back.',
  no_verdict: 'The Design critic could not judge the whole email.',
  not_passed: 'The whole email did not pass the Design critic.'
} as const
export type EmailCheckReason = keyof typeof emailCheckReasons

export type EmailCheckOutcome =
  /** Views were asked for or are drawing: wait (`wait_email_round`, one of the design step's waits). */
  | { wait: { seconds: number } }
  /** No time for the critic in this claim: wait as for a picture, the views kept. */
  | { paused: { seconds: number } }
  | { pass: true; verdict: EmailVerdict }
  | {
      pass: false
      reason: EmailCheckReason
      /** Code's own words on what failed (never the critic's), when it judged. */
      problem?: string
    }

export type EmailCheckPorts = EmailViewPorts & {
  /** Whether `calls` more agent calls (default 1) fit in this claim. */
  fits: (calls?: number) => boolean
  now: () => number
}

/** The critic's tries in one claim (`critiqueEmail` asks again after a wrong shape). */
const criticCalls = 3

/** Waits until the window closes, as the rounds do (the claim comes back early once nothing is queued). */
const secondsLeft = (until: number, now: number) =>
  Math.min(
    studioWaits.maxSeconds,
    Math.max(studioWaits.minSeconds, Math.ceil((until - now) / 1000))
  )

/** A database refusal read as a reason (as the rounds read theirs), else null. */
function refusal(error: unknown): EmailCheckReason | null {
  // `EmailNotDrawable` (preview-jobs, a server-only module), by its name.
  if ((error as { name?: unknown })?.name === 'EmailNotDrawable')
    return 'not_drawable'
  const e = error as { code?: string; details?: string; message?: string }
  // Its fixed answers about the email: the views' limit, or a key, page or
  // origin it refuses (a retry never passes).
  if (e?.code === '22023')
    return e.details === 'too_many_previews' ? 'too_many' : 'not_drawable'
  // The same key with another page (the brand's name changed between
  // claims): this version cannot be drawn under its key.
  if (e?.code === 'PT409' && e.message === "This key is another email's")
    return 'not_drawable'
  return null
}

/**
 * What failed, in code's own words for the owner's log: a view wider than
 * its screen, else the lowest score. Built from the verdict's numbers and
 * the views' measures, never from the critic's sentences (they may read
 * the email's words, a code among them).
 */
function problemOf(verdict: EmailVerdict, views: EmailViews) {
  for (const v of ['desktop', 'phone', 'dark'] as const) {
    const p = views[v]
    if (p?.wide)
      return `Something in the email is wider than ${p.width} px (${v}): it must fit the screen.`
  }
  const low = [...emailChecklist]
    .filter((k) => Number.isInteger(verdict.scores[k]))
    .sort((a, b) => verdict.scores[a] - verdict.scores[b])[0]
  return low && verdict.scores[low] < 8
    ? `${emailLabels[low]} scored ${verdict.scores[low]} of 10.`
    : undefined
}

/**
 * One claim of the whole-email check. `key` names this version of the
 * email (`viewKey`); `until` closes the views' window; `waits` are the
 * design step's so far (6 at most).
 */
export async function checkWholeEmail(
  input: {
    html: string
    key: string
    until: number
    waits: number
  },
  ports: EmailCheckPorts
): Promise<EmailCheckOutcome> {
  const now = ports.now()
  const noWait = input.waits >= studioWaits.perStep
  const timeUp = now >= input.until || noWait
  const latest = new Map<string, BuildView>()
  const found = await ports.views(input.key)
  for (const v of found) latest.set(v.view, v)
  const needed = ['desktop', 'phone'] as const
  // Dark is asked for and waited for only while there is time.
  const missing = needed.some((v) => !latest.has(v))
  if (missing || (!latest.has('dark') && !timeUp)) {
    if (timeUp)
      return {
        pass: false,
        reason: found.length ? 'no_time' : 'no_time_left'
      }
    try {
      await ports.ask(input.key, input.html)
    } catch (error) {
      const reason = refusal(error)
      // The lease lost, the database or the network down: the step is
      // tried again.
      if (!reason) throw error
      return { pass: false, reason }
    }
    return { wait: { seconds: secondsLeft(input.until, now) } }
  }
  const drawing = (v: string) => latest.get(v)?.state === 'queued'
  if (needed.some(drawing) || (drawing('dark') && !timeUp)) {
    if (timeUp) return { pass: false, reason: 'no_time' }
    return { wait: { seconds: secondsLeft(input.until, now) } }
  }
  if (needed.some((v) => latest.get(v)?.state !== 'drawn'))
    return { pass: false, reason: 'view_failed' }
  /** A drawn view's picture, only one the critic can take. */
  const read = async (v: string) => {
    const view = latest.get(v)
    if (view?.state !== 'drawn') return null
    const picture = await ports.picture(view as DrawnView)
    return picture && picture.bytes.byteLength <= maxEmailPictureBytes
      ? picture
      : null
  }
  const desktop = await read('desktop')
  const phone = await read('phone')
  if (!desktop || !phone) return { pass: false, reason: 'view_unusable' }
  const dark: EmailPicture | null = await read('dark')
  if (!ports.fits(criticCalls)) {
    // The views are in: the next claim judges them, while a wait is left.
    if (noWait) return { pass: false, reason: 'no_time' }
    return {
      paused: {
        seconds: secondsLeft(Math.max(input.until, now), now)
      }
    }
  }
  const views: EmailViews = { desktop, phone, ...(dark ? { dark } : {}) }
  const verdict = await ports.judge(views)
  if (!verdict) return { pass: false, reason: 'no_verdict' }
  if (!verdict.pass) {
    const problem = problemOf(verdict, views)
    return {
      pass: false,
      reason: 'not_passed',
      ...(problem ? { problem } : {})
    }
  }
  return { pass: true, verdict }
}
