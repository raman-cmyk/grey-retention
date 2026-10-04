import { describe, expect, it } from 'vitest'
import {
  campaignNextStep,
  campaignReview,
  overviewModel,
  type OverviewCampaign
} from './overview-model'

const campaign = {
  calendar_state: 'approved',
  copy_state: 'approved',
  design_state: 'submitted',
  delivery_state: 'not_ready',
  superseded_by_plan: null
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
    ).toBe('Prepare delivery')
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
