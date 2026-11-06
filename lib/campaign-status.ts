import { operatorStatuses, type StatusTone } from './status-vocabulary'

/**
 * The one CAMPAIGN status system (docs/OWNER_JOURNEYS.md §18.3, issue
 * UIR-015). It replaces the old app's overlapping pills, selects and filters
 * (WRITING, DRAFT, Ready, WORKFLOW, DRAFTS/READY/PUSHED). Each status is set
 * by a real event, never picked by hand; this file only fixes the words,
 * colour roles and plain-English meanings every campaign screen shows.
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
      'Copy is being written or edited. Nothing has gone to a designer yet.'
  },
  with_designer: {
    label: 'With designer',
    tone: 'info',
    meaning:
      'A designer is making the design. Changing the copy now may waste their work.'
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
  }
} as const satisfies Record<
  string,
  { label: string; tone: PillTone; meaning: string }
>

export type CampaignStatus = keyof typeof campaignStatuses

/** Colour roles from docs/UI_REBUILD_SPEC.md §0 ("Pill/status colour roles"). */
export type PillTone = StatusTone | 'accent-2' | 'solid'

/** The order a campaign moves through; Cancelled and Missed end it early. */
export const campaignStatusOrder: readonly CampaignStatus[] = [
  'draft',
  'with_designer',
  'needs_approval',
  'scheduled',
  'sent',
  'cancelled',
  'missed'
]

export function isCampaignStatus(value: unknown): value is CampaignStatus {
  return typeof value === 'string' && Object.hasOwn(campaignStatuses, value)
}
