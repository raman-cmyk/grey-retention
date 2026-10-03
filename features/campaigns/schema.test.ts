import { expect, it } from 'vitest'
import { campaignInputSchema } from './schema'
it('validates campaign inputs rather than accepting arbitrary channel, tenant or date fields', () => {
  const input = {
    title: 'A quiet weekend',
    goal: 'Verified catalog context',
    channel: 'email_text',
    planned_at: '2026-11-01T10:00:00Z',
    audience_id: '',
    product_id: '',
    offer_id: '',
    reference_notes: ''
  }
  expect(campaignInputSchema.safeParse(input).success).toBe(true)
  expect(
    campaignInputSchema.safeParse({ ...input, channel: 'sms' }).success
  ).toBe(false)
  expect(
    campaignInputSchema.safeParse({ ...input, planned_at: 'tomorrow' }).success
  ).toBe(false)
  expect(
    campaignInputSchema.safeParse({ ...input, tenant_id: 'foreign' }).success
  ).toBe(false)
})
