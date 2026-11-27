import type { PlanScreen } from '@/features/strategy/plan-screen'

/**
 * UI-USE: what "Use this design" shows (owner decision of 24 Nov). The
 * owner chose an Inspiration email; he picks which planned email of the
 * current 15-day plan to make with it, Copy or Remix, and clicks Create
 * email. Pure: the page reads the email and the plan, this file decides
 * every state, and the screen draws it.
 *
 * - `error`: the email or the plan could not be read;
 * - `missing`: the email is not one of this workspace's (unknown, of a
 *   brand it does not follow, or hid);
 * - `staff`: the email, and that only the owner creates emails;
 * - `no_plan`: no plan to use (none, failed or for days that began): Plan
 *   next 15 days;
 * - `not_ready`: a plan is being made, or every planned email already has
 *   its email: Open your plan;
 * - `pick`: the planned emails with no email yet, and Create email.
 */
export type ChosenEmail = {
  id: string
  subject: string
  /** The brand's name, as the workspace follows it. */
  from: string
  /** ISO time it arrived. */
  at: string
  /** The email's stored, sanitized markup. */
  html: string
  /**
   * The build cannot follow it (yet): the inbox is still reading it, or it
   * is over a year old. The email is then made from scratch.
   */
  unready: 'reading' | 'old' | null
  /**
   * DES-ENGINE-003b: one of the workspace's own uploaded emails (`id` is
   * the upload's): copied only, its look kept when it is the brand's own.
   */
  upload?: 'own' | 'other'
}

export type FreeEmail = {
  slot: number
  title: string
  /** "Fri 20 · 6:00 pm · Past buyers". */
  details: string[]
}

export type UseEmailView =
  | { kind: 'error' }
  | { kind: 'missing' }
  | { kind: 'staff'; email: ChosenEmail }
  | { kind: 'no_plan'; email: ChosenEmail; title: string }
  | { kind: 'not_ready'; email: ChosenEmail; title: string }
  | { kind: 'pick'; email: ChosenEmail; runId: string; emails: FreeEmail[] }

export type UseEmailInput =
  | { ok: false }
  | {
      ok: true
      owner: boolean
      /** Null: not this workspace's to use. */
      email: ChosenEmail | null
      /** The Plan screen's view of the latest plan, as the owner sees it. */
      plan: PlanScreen
    }

/** The view from the page's reads. */
export function inspirationUseView(input: UseEmailInput): UseEmailView {
  if (!input.ok) return { kind: 'error' }
  const { email, plan } = input
  if (!email) return { kind: 'missing' }
  if (!input.owner) return { kind: 'staff', email }
  switch (plan.kind) {
    case 'empty':
      return { kind: 'no_plan', email, title: 'No plan yet' }
    case 'failed':
    case 'restart':
      return { kind: 'no_plan', email, title: 'No plan to use' }
    case 'planning':
    case 'offers':
      return { kind: 'not_ready', email, title: 'Your plan is not ready' }
    case 'plan': {
      // A planned email still to create (or to try again), designed: a
      // text email is written, never copied or remixed.
      const free = plan.emails.filter(
        (e) => e.action?.kind === 'create' && e.format === 'designed'
      )
      if (!free.length)
        return { kind: 'not_ready', email, title: 'Nothing left to create' }
      return {
        kind: 'pick',
        email,
        runId: plan.runId,
        emails: free.map((e) => ({
          slot: e.slot,
          title: e.title,
          details: e.details
        }))
      }
    }
  }
}
