import type { PlanEmail } from '@/features/strategy/plan-screen'

/**
 * PICK-102 (owner pick #102, "Create all 15 at once"): one click queues
 * "Create email" for every planned email that has no build yet, through
 * the same `create_email_build` command, the same job and the same fenced
 * saves as one click on a row. Pure: the server action reads the plan and
 * calls the command; this file decides which emails, in which order, and
 * the owner's words for what happened.
 *
 * Which emails: the ones the Plan screen offers "Create email" on (no
 * build, send time not passed), in the screen's order (earliest first), so
 * the first to send is made first. An email with a build is left alone:
 * being made or made already (the command would return that build), or
 * failed (its own Try again on its row, so a retry that may use the AI
 * allowance again is the owner's choice per email). An email whose send
 * time has passed is never made.
 */
export type CreateAllPick = {
  /** Slots to queue, earliest first. */
  create: number[]
  /** Being made, or made already (in Klaviyo or a sample draft). */
  made: number[]
  /** The latest build failed: Try again on its row. */
  failed: number[]
  /** Its send time passed before it was made. */
  passed: number[]
}

/** Which planned emails "Create all" queues, from the Plan screen's rows. */
export function pickSlots(emails: readonly PlanEmail[]): CreateAllPick {
  const pick: CreateAllPick = { create: [], made: [], failed: [], passed: [] }
  for (const e of emails) {
    if (e.stage === 'not_started') {
      // Only where the owner has the button (the screen's own rule).
      if (e.action?.kind === 'create') pick.create.push(e.slot)
    } else if (e.stage === 'failed') pick.failed.push(e.slot)
    else if (e.stage === 'too_late') pick.passed.push(e.slot)
    else pick.made.push(e.slot)
  }
  return pick
}

/** One `create_email_build` call, as the action reads its answer. */
export type QueueAnswer =
  | { ok: true; build: string }
  /** Refused for this email only: the owner's words. */
  | { ok: false; reason: string }
  /** Refused for the whole plan (replaced, not the owner's): stop at once. */
  | { ok: false; stop: string }

export type QueueResult = {
  queued: { slot: number; build: string }[]
  refused: { slot: number; reason: string }[]
  /** Set when the command refused the whole plan; nothing after it ran. */
  stopped: string | null
}

/**
 * Queues the emails one after another (the command takes the workspace's
 * lock each time, so a second click or tab waits and gets the same builds:
 * `email_builds_one_open` keeps one build per planned email). One email's
 * refusal never stops the others; a refusal of the whole plan stops the
 * rest. A call that throws is that email's refusal.
 */
export async function queueAll(
  slots: readonly number[],
  create: (slot: number) => Promise<QueueAnswer>
): Promise<QueueResult> {
  const result: QueueResult = { queued: [], refused: [], stopped: null }
  for (const slot of slots) {
    let answer: QueueAnswer
    try {
      answer = await create(slot)
    } catch {
      answer = { ok: false, reason: couldNot }
    }
    if (answer.ok) result.queued.push({ slot, build: answer.build })
    else if ('stop' in answer) {
      result.stopped = answer.stop
      break
    } else result.refused.push({ slot, reason: answer.reason })
  }
  return result
}

export const couldNot = 'We could not create the email. Try again.'

/** "Fri 20, “Offer: Cedar candle”" for a slot of the plan. */
export function emailLabel(emails: readonly PlanEmail[], slot: number) {
  const e = emails.find((x) => x.slot === slot)
  return e ? `${e.day}, “${e.title}”` : 'One email'
}

const emailsWord = (n: number) => (n === 1 ? 'email' : 'emails')

/**
 * What the click did, in the owner's words: how many it started, which
 * could not start and why (one line per reason, naming each email), and
 * what was left alone. Nothing is sent or scheduled (D17).
 */
export function createAllWords(
  emails: readonly PlanEmail[],
  pick: CreateAllPick,
  result: QueueResult,
  notes: { allowanceUsed?: boolean; agents?: boolean } = {}
): string {
  const lines: string[] = []
  const n = result.queued.length
  if (n)
    lines.push(
      `Creating ${n} ${emailsWord(n)}. Each lands in Klaviyo as a draft; nothing is sent or scheduled. You can leave this page.`
    )
  // One line per reason, naming the emails it stopped.
  const byReason = new Map<string, number[]>()
  for (const r of result.refused)
    byReason.set(r.reason, [...(byReason.get(r.reason) ?? []), r.slot])
  for (const [reason, slots] of byReason)
    lines.push(
      `Not started: ${slots.map((s) => emailLabel(emails, s)).join('; ')}. ${reason}`
    )
  if (result.stopped) lines.push(result.stopped)
  if (pick.failed.length)
    lines.push(
      `${pick.failed.length} ${emailsWord(pick.failed.length)} that failed before ${pick.failed.length === 1 ? 'keeps its' : 'keep their'} own Try again.`
    )
  if (n && notes.allowanceUsed)
    lines.push(
      'Your AI allowance is used up, so these emails are made by code only, without the AI.'
    )
  else if (n && notes.agents)
    lines.push(
      'The AI team makes them one at a time for about two minutes; any it does not reach are made by code only.'
    )
  if (!lines.length)
    return pick.made.length
      ? 'Every email in this plan is already made or being made.'
      : 'There is no email left to create in this plan.'
  return lines.join(' ')
}

/**
 * The plan's progress, as the Plan screen shows it while emails are being
 * made: "6 of 15 ready · 1 failed · 8 working".
 */
export type BuildProgress = {
  total: number
  /** In Klaviyo, or a sample draft. */
  ready: number
  working: number
  /** The latest build failed (the row says why). */
  failed: number
  /** No build yet. */
  notStarted: number
  /** Its send time passed before it was made. */
  tooLate: number
}

export function buildProgress(emails: readonly PlanEmail[]): BuildProgress {
  const p: BuildProgress = {
    total: emails.length,
    ready: 0,
    working: 0,
    failed: 0,
    notStarted: 0,
    tooLate: 0
  }
  for (const e of emails) {
    if (e.stage === 'ready') p.ready++
    else if (e.stage === 'working') p.working++
    else if (e.stage === 'failed') p.failed++
    else if (e.stage === 'not_started') p.notStarted++
    else p.tooLate++
  }
  return p
}

/** "6 of 15 ready · 1 failed · 8 working · 2 not started". */
export function progressWords(p: BuildProgress): string {
  return [
    `${p.ready} of ${p.total} ready`,
    ...(p.failed ? [`${p.failed} failed`] : []),
    ...(p.working ? [`${p.working} working`] : []),
    ...(p.notStarted ? [`${p.notStarted} not started`] : []),
    ...(p.tooLate ? [`${p.tooLate} too late to make`] : [])
  ].join(' · ')
}
