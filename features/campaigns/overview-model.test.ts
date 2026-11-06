import { describe, expect, it } from 'vitest'
import {
  campaignNextStep,
  campaignReview,
  overviewModel,
  type OverviewCampaign
} from './overview-model'

const now = new Date('2026-11-06T12:00:00Z')
const campaign = {
  channel: 'email_design',
  calendar_state: 'approved',
  copy_state: 'approved',
  design_state: 'submitted',
  delivery_state: 'not_ready',
  planned_at: '2026-11-20T09:00:00Z',
  superseded_by_plan: null
} as OverviewCampaign
const approved = {
  ...campaign,
  design_state: 'owner_approved'
} as OverviewCampaign

describe('campaign overview priorities', () => {
  it('excludes completed, scheduled and historical campaigns from review', () => {
    expect(campaignReview(campaign)).toBe('Design review')
    expect(
      campaignReview({
        ...campaign,
        design_state: 'unassigned',
        copy_state: 'pending_approval'
      })
    ).toBe('Copy review')
    for (const delivery_state of ['sent', 'scheduled', 'cancelled'] as const)
      expect(campaignReview({ ...campaign, delivery_state })).toBeNull()
    expect(
      campaignReview({ ...campaign, superseded_by_plan: 'old' })
    ).toBeNull()
  })
  it('keeps delivery failures actionable and identifies design revisions', () => {
    expect(
      campaignNextStep({ ...campaign, delivery_state: 'reconciling' })
    ).toBe('Check delivery')
    expect(
      campaignNextStep({ ...campaign, design_state: 'revisions_requested' })
    ).toBe('Revise design')
    expect(
      campaignNextStep({ ...campaign, design_state: 'owner_approved' })
    ).toBe('Approve and schedule')
  })
  it('requires revised calendar approval before retained downstream reviews', () => {
    for (const downstream of [
      { copy_state: 'pending_approval', design_state: 'unassigned' },
      { copy_state: 'approved', design_state: 'submitted' }
    ] as const) {
      const revised = {
        ...campaign,
        ...downstream,
        calendar_state: 'proposed'
      } as OverviewCampaign
      expect(campaignReview(revised)).toBe('Calendar review')
      expect(campaignNextStep(revised)).toBe('Calendar review')
    }
  })
  it('counts only current campaigns in operational buckets', () => {
    const model = overviewModel([
      campaign,
      { ...campaign, delivery_state: 'scheduled' },
      { ...campaign, delivery_state: 'sent' },
      { ...campaign, superseded_by_plan: 'old' }
    ])
    expect(model.current).toHaveLength(3)
    expect(model.active).toHaveLength(2)
    expect(model.scheduled).toHaveLength(1)
    expect(model.reviews).toHaveLength(1)
  })
})

describe('next step agrees with the status pill', () => {
  const next = (over: Partial<OverviewCampaign>) =>
    campaignNextStep({ ...approved, ...over } as OverviewCampaign, now)
  const review = (over: Partial<OverviewCampaign>) =>
    campaignReview({ ...approved, ...over } as OverviewCampaign, now)

  it('names the final approve-and-schedule step as a review', () => {
    expect(review({})).toBe('Approve and schedule')
    expect(review({ delivery_state: 'ready' })).toBe('Confirm the schedule')
    expect(next({ delivery_state: 'ready' })).toBe('Confirm the schedule')
  })

  it('says nothing more for confirmed or cancelled sends', () => {
    expect(next({ delivery_state: 'scheduled' })).toBeNull()
    expect(next({ delivery_state: 'cancelled' })).toBeNull()
    expect(next({ delivery_state: 'queued' })).toBe('Waiting for confirmation')
    expect(next({ delivery_state: 'sent' })).toBe('View results')
  })

  it('asks for a check or a new date when a send went wrong', () => {
    for (const delivery_state of ['failed', 'blocked', 'reconciling'])
      expect(next({ delivery_state })).toBe('Check delivery')
    expect(next({ planned_at: '2026-11-01T09:00:00Z' })).toBe('Pick a new date')
    // Approved and in delivery when its time passed: check delivery (the
    // date can't be edited while delivery is active).
    expect(
      next({ delivery_state: 'queued', planned_at: '2026-11-01T09:00:00Z' })
    ).toBe('Check delivery')
    // Missed campaigns are not in the approval queue.
    expect(review({ planned_at: '2026-11-01T09:00:00Z' })).toBeNull()
  })

  it('tells drafts what comes next', () => {
    expect(next({ copy_state: 'draft', design_state: 'unassigned' })).toBe(
      'Prepare copy'
    )
    expect(next({ design_state: 'unassigned' })).toBe('Prepare design')
    expect(next({ calendar_state: 'rejected' })).toBe('Revise calendar')
    expect(next({ design_state: 'assigned' })).toBe('Design in progress')
    expect(
      next({ channel: 'email_text', design_state: 'revisions_requested' })
    ).toBe('Revise design')
  })

  it('buckets campaigns by the same status', () => {
    const model = overviewModel(
      [
        { ...approved, id: 'final' },
        { ...approved, id: 'queued', delivery_state: 'queued' },
        { ...approved, id: 'late', planned_at: '2026-11-01T09:00:00Z' },
        { ...approved, id: 'failed', delivery_state: 'failed' },
        { ...approved, id: 'draft', design_state: 'unassigned' }
      ] as OverviewCampaign[],
      now
    )
    const ids = (list: OverviewCampaign[]) => list.map((c) => c.id)
    expect(ids(model.reviews)).toEqual(['final'])
    expect(ids(model.scheduled)).toEqual(['queued'])
    expect(ids(model.attention)).toEqual(['late', 'failed'])
    expect(ids(model.inProduction)).toEqual(['draft'])
  })
})
