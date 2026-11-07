import { operatorStatuses, type StatusTone } from './status-vocabulary'

/**
 * The one CAMPAIGN status system (docs/OWNER_JOURNEYS.md §18.3, issue
 * UIR-015). It replaces the old app's overlapping pills, selects and filters
 * (WRITING, DRAFT, Ready, WORKFLOW, DRAFTS/READY/PUSHED). Each status is set
 * by a real event, never picked by hand; this file only fixes the words,
 * colour roles and plain-English meanings every campaign screen shows.
 *
 * There is no "With designer" status: decision D3 (docs/BUILD_BRIEF.md)
 * retired the human designer, and the design is made automatically.
 *
 * `lib/status-vocabulary.ts` stays the vocabulary for everything that is not
 * a campaign (sources, setup, jobs). Words both share ("Scheduled", "Sent")
 * use the same meaning; as pills, Sent is solid (UI_REBUILD_SPEC.md §0).
 */
export const campaignStatuses = {
  draft: {
    label: 'Draft',
    tone: 'warning',
    meaning:
      'The copy or the design is being made or changed. Open it to see the next step.'
  },
  needs_approval: {
    label: 'Needs your approval',
    tone: 'warning',
    meaning: 'Waiting for you: approve it, then schedule it.'
  },
  scheduled: {
    label: 'Scheduled',
    tone: 'info',
    meaning: operatorStatuses.scheduled.meaning
  },
  sent: {
    label: 'Sent',
    tone: 'solid',
    meaning: operatorStatuses.sent.meaning
  },
  cancelled: {
    label: 'Cancelled',
    tone: 'danger',
    meaning: 'It was stopped and will not send.'
  },
  missed: {
    label: 'Missed',
    tone: 'danger',
    meaning: 'Its send time passed before it was approved and scheduled.'
  },
  delivery_problem: {
    label: 'Delivery problem',
    tone: 'danger',
    meaning:
      'Sending failed, was blocked, or could not be confirmed. Open it to check.'
  }
} as const satisfies Record<
  string,
  { label: string; tone: PillTone; meaning: string }
>

export type CampaignStatus = keyof typeof campaignStatuses

/** Colour roles from docs/UI_REBUILD_SPEC.md §0 ("Pill/status colour roles"). */
export type PillTone = StatusTone | 'accent-2' | 'solid'

/**
 * The order a campaign moves through; Cancelled and Missed end it early,
 * and a Delivery problem needs a look.
 */
export const campaignStatusOrder: readonly CampaignStatus[] = [
  'draft',
  'needs_approval',
  'scheduled',
  'sent',
  'cancelled',
  'missed',
  'delivery_problem'
]

export function isCampaignStatus(value: unknown): value is CampaignStatus {
  return typeof value === 'string' && Object.hasOwn(campaignStatuses, value)
}
