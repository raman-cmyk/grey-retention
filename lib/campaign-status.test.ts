import { describe, expect, it } from 'vitest'
import {
  campaignStatusOrder,
  campaignStatuses,
  isCampaignStatus
} from './campaign-status'

describe('campaign status system', () => {
  it('uses the owner brief words, in order, once each', () => {
    expect(campaignStatusOrder.map((s) => campaignStatuses[s].label)).toEqual([
      'Draft',
      'With designer',
      'Needs your approval',
      'Scheduled',
      'Sent',
      'Cancelled',
      'Missed',
      'Delivery problem'
    ])
    expect(new Set(campaignStatusOrder).size).toBe(
      Object.keys(campaignStatuses).length
    )
  })

  it('maps statuses to the spec colour roles', () => {
    expect(campaignStatuses.draft.tone).toBe('warning')
    expect(campaignStatuses.scheduled.tone).toBe('info')
    expect(campaignStatuses.sent.tone).toBe('solid')
    expect(campaignStatuses.cancelled.tone).toBe('danger')
    expect(campaignStatuses.delivery_problem.tone).toBe('danger')
  })

  it('explains every status in plain words', () => {
    for (const status of campaignStatusOrder)
      expect(campaignStatuses[status].meaning.length).toBeGreaterThan(10)
  })

  it('accepts only known statuses', () => {
    expect(isCampaignStatus('sent')).toBe(true)
    expect(isCampaignStatus('ready')).toBe(false)
    expect(isCampaignStatus('toString')).toBe(false)
    expect(isCampaignStatus(undefined)).toBe(false)
  })
})
