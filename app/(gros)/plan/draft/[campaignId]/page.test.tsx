import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { campaignDetail, notFound } = vi.hoisted(() => ({
  campaignDetail: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  })
}))
vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({ notFound }))
vi.mock('@/features/campaigns/data', () => ({ campaignDetail }))
vi.mock('@/features/campaigns/actions', () => ({
  approveCalendar: vi.fn(),
  addNote: vi.fn(),
  saveCampaign: vi.fn()
}))
vi.mock('@/features/campaigns/workflow-actions', () => ({
  workflowAction: vi.fn()
}))

import DraftPage from './page'

afterEach(cleanup)
beforeEach(() => vi.clearAllMocks())

const id = '6f1c1d1e-2a3b-4c5d-8e9f-001122334455'
const open = (campaignId = id) =>
  DraftPage({ params: Promise.resolve({ campaignId }) })
const campaign = {
  audience_id: null,
  calendar_revision: 1,
  calendar_state: 'proposed',
  channel: 'email_design',
  copy_revision: 1,
  copy_state: 'draft',
  delivery_state: 'not_ready',
  design_state: 'unassigned',
  goal: '',
  id,
  lineage: {},
  offer_id: null,
  planned_at: '2099-12-01T10:00:00Z',
  product_id: null,
  reference_notes: '',
  superseded_by_plan: null,
  timezone: 'Europe/London',
  title: 'Cedar Lane · winter'
}
const detail = (role: 'owner' | 'staff', over: object = {}) => ({
  context: { tenantRole: role },
  data: { audiences: [] },
  campaign,
  content: null,
  comments: [],
  error: null,
  ...over
})

describe('the draft page (UI-OLDc)', () => {
  it('answers Not found for an address that is not an id, without a read', async () => {
    await expect(open('not-an-id')).rejects.toThrow('NEXT_NOT_FOUND')
    expect(campaignDetail).not.toHaveBeenCalled()
  })

  it('answers Not found for a draft this workspace does not have', async () => {
    // Another workspace's draft reads as none (row rules keep it out).
    campaignDetail.mockResolvedValue(
      detail('owner', { campaign: null, error: null })
    )
    await expect(open()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(campaignDetail).toHaveBeenCalledWith(id)
  })

  it('says the draft did not open when the read failed', async () => {
    campaignDetail.mockResolvedValue(
      detail('owner', {
        campaign: null,
        error: 'Campaign data is unavailable.'
      })
    )
    render(await open())
    expect(screen.getByRole('alert')).toHaveTextContent(
      'This draft did not open'
    )
  })

  it('gives the owner the owner’s buttons, and staff none of them', async () => {
    campaignDetail.mockResolvedValue(detail('owner'))
    const owner = render(await open())
    expect(screen.getByRole('button', { name: 'Approve date' })).toBeVisible()
    owner.unmount()
    campaignDetail.mockResolvedValue(detail('staff'))
    render(await open())
    expect(screen.getByText('Cedar Lane · winter')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve date' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Write copy' })).toBeNull()
  })
})
