import type { RequestContext } from '@/features/auth/domain/types'
import { can } from '@/features/workflow/domain/policy'

/**
 * The weekly approval (APR-001, VISION Step 5). One approval covers the
 * week's batch: the owner sees each campaign's phone screenshot, date,
 * offer and segment, then taps Approve all, or writes a Change for one
 * email. A Change is redone by the AI at most twice; a third ask goes to a
 * person (VISION hard rule 13). Only emails that passed QA are in the
 * batch, and only the workspace's owner approves (owner approval is
 * sacred; the check is the shared `can(context, 'approve', tenantId)`).
 *
 * An approval is bound to the exact version the owner was shown: every
 * item carries its copy/design `revision`, and Approve all only approves
 * the `{ campaignId, revision }` pairs the screen (or the email) showed.
 * The store re-checks the revisions in the same transaction and raises
 * PT409 when one moved.
 *
 * Pure rules: the job and the screen call these and store the result.
 *
 * Hidden by decision D17 (RET-002): there is no weekly approval. Nothing
 * routes to, schedules or imports this code; it is kept for reference.
 */
export type ItemState =
  'pending_approval' | 'change_requested' | 'needs_human' | 'approved'

export type BatchItem = {
  campaignId: string
  /** The copy/design revision; it goes up with every redo. */
  revision: number
  /** ISO send time; shown in the store timezone. */
  sendAt: string
  subject: string
  /** e.g. "15% off with WELCOME15", or null for a non-discount email. */
  offer: string | null
  /** The audience by name; defaults to the engaged segment (VISION rule 3). */
  segment: string
  state: ItemState
  /** AI redo rounds used so far, 0 to 2. */
  changeRounds: number
  /** True once the owner asked for any change on this email. */
  edited: boolean
  /** QA warnings to show, e.g. "this picture may contain claims". */
  warnings: string[]
}

/** What the owner was shown: one pair per email. */
export type ShownItem = { campaignId: string; revision: number }

export const maxChangeRounds = 2

/**
 * An approval this close to the send time could not be scheduled in
 * Klaviyo in time (the job sweep runs every 30 minutes), so it is refused.
 */
export const minimumLeadMinutes = 60

export class ApprovalRefused extends Error {}

export type SkipReason =
  | 'changed_since_shown'
  | 'not_shown'
  | 'being_changed'
  | 'with_a_person'
  | 'too_close_to_send'
  | 'send_time_passed'

/** What the owner reads for each email Approve all left out. */
export const skipWords: Record<SkipReason, string> = {
  changed_since_shown:
    'This email changed since you looked. Check the new version, then approve it.',
  not_shown: 'You have not seen this email yet. Check it, then approve it.',
  being_changed: 'Your change is being made. Approve it when it is back.',
  with_a_person:
    'A person is finishing this email. Approve it when it is back.',
  too_close_to_send:
    'It sends in less than an hour, too soon to schedule it. It will not be sent.',
  send_time_passed: 'Its send time has passed. It will not be sent.'
}

const assertOwner = (context: RequestContext, tenantId: string) => {
  if (!can(context, 'approve', tenantId))
    throw new ApprovalRefused(
      "Only this workspace's owner approves its emails."
    )
}

const sendTime = (item: BatchItem) => {
  const at = Date.parse(item.sendAt)
  return Number.isFinite(at) ? at : null
}

const timing = (
  item: BatchItem,
  now: Date
): 'send_time_passed' | 'too_close_to_send' | null => {
  const at = sendTime(item)
  if (at === null || at <= now.getTime()) return 'send_time_passed'
  if (at - now.getTime() < minimumLeadMinutes * 60_000)
    return 'too_close_to_send'
  return null
}

/** The emails still waiting for the owner, soonest first. */
export function waiting(items: readonly BatchItem[]) {
  return items
    .filter((i) => i.state === 'pending_approval')
    .sort((a, b) => (sendTime(a) ?? 0) - (sendTime(b) ?? 0))
}

/**
 * Approve all: every waiting email the owner was shown, at the revision
 * shown, whose send time is far enough ahead. Everything else is left as
 * it is, and the result says why.
 */
export function approveAll(
  items: readonly BatchItem[],
  shown: readonly ShownItem[],
  context: RequestContext,
  tenantId: string,
  now: Date
): {
  items: BatchItem[]
  approved: ShownItem[]
  skipped: { campaignId: string; reason: SkipReason }[]
  approvedBy: string
  approvedAt: string
} {
  assertOwner(context, tenantId)
  const seen = new Map(shown.map((s) => [s.campaignId, s.revision]))
  const approved: ShownItem[] = []
  const skipped: { campaignId: string; reason: SkipReason }[] = []
  const skip = (item: BatchItem, reason: SkipReason) => {
    skipped.push({ campaignId: item.campaignId, reason })
    return item
  }
  const next = items.map((item) => {
    if (item.state === 'approved') return item
    if (item.state === 'change_requested') return skip(item, 'being_changed')
    if (item.state === 'needs_human') return skip(item, 'with_a_person')
    if (!seen.has(item.campaignId)) return skip(item, 'not_shown')
    if (seen.get(item.campaignId) !== item.revision)
      return skip(item, 'changed_since_shown')
    const late = timing(item, now)
    if (late) return skip(item, late)
    approved.push({ campaignId: item.campaignId, revision: item.revision })
    return { ...item, state: 'approved' as const }
  })
  return {
    items: next,
    approved,
    skipped,
    approvedBy: context.userId,
    approvedAt: now.toISOString()
  }
}

/** Keeps the owner's line breaks; trims spaces and long blank runs. */
const tidy = (text: string) =>
  text
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

/**
 * A Change for one email, at the revision the owner was looking at. The
 * text goes to the AI for a redo, at most twice; the third time it goes to
 * a person instead.
 */
export function requestChange(
  item: BatchItem,
  shownRevision: number,
  text: string,
  context: RequestContext,
  tenantId: string,
  now: Date
): { item: BatchItem; next: 'ai_redo' | 'person'; text: string } {
  assertOwner(context, tenantId)
  const ask = tidy(text)
  if (ask.length < 3) throw new ApprovalRefused('Say what you want changed.')
  if (ask.length > 1000)
    throw new ApprovalRefused('Keep the change under 1,000 characters.')
  if (item.state !== 'pending_approval')
    throw new ApprovalRefused('This email is not waiting for your approval.')
  if (item.revision !== shownRevision)
    throw new ApprovalRefused(skipWords.changed_since_shown)
  if (timing(item, now) === 'send_time_passed')
    throw new ApprovalRefused(skipWords.send_time_passed)
  if (item.changeRounds >= maxChangeRounds)
    return {
      item: { ...item, state: 'needs_human', edited: true },
      next: 'person',
      text: ask
    }
  return {
    item: {
      ...item,
      state: 'change_requested',
      changeRounds: item.changeRounds + 1,
      edited: true
    },
    next: 'ai_redo',
    text: ask
  }
}

/**
 * The AI's redo, or the person's finished version, came back and passed
 * QA: it waits for the owner again, as a new revision.
 */
export function backForApproval(item: BatchItem): BatchItem {
  if (item.state !== 'change_requested' && item.state !== 'needs_human')
    return item
  return { ...item, state: 'pending_approval', revision: item.revision + 1 }
}

/**
 * The one number VISION tracks from the first client: the share of
 * approved emails the owner approved without asking for any change.
 */
export function approvedWithoutEdits(items: readonly BatchItem[]) {
  const approved = items.filter((i) => i.state === 'approved')
  const clean = approved.filter((i) => !i.edited).length
  return {
    approved: approved.length,
    withoutEdits: clean,
    share: approved.length ? clean / approved.length : null
  }
}
