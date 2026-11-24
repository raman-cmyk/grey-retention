import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/features/campaigns/actions', () => ({
  approveCalendar: vi.fn(async () => ({})),
  addNote: vi.fn(async () => ({})),
  saveCampaign: vi.fn(async () => ({}))
}))
vi.mock('@/features/campaigns/workflow-actions', () => ({
  workflowAction: vi.fn(async () => ({}))
}))

import DraftPageError from '@/app/(gros)/plan/draft/[campaignId]/error'
import DraftLoading from '@/app/(gros)/plan/draft/[campaignId]/loading'
import type { Database } from '@/lib/supabase/database.types'
import { DraftError, DraftScreen } from './draft-screen'
import { draftStatus, draftView, startedFrom } from './draft-view'

afterEach(cleanup)

type Campaign = Database['public']['Tables']['campaigns']['Row']
type Content = Database['public']['Tables']['campaign_content']['Row']

const now = new Date('2026-11-24T12:00:00Z')
const campaign = (over: Partial<Campaign> = {}): Campaign => ({
  audience_id: 'a1',
  calendar_revision: 2,
  calendar_state: 'proposed',
  channel: 'email_design',
  copy_revision: 1,
  copy_state: 'draft',
  created_at: '2026-11-20T09:00:00Z',
  created_by: 'u1',
  delivery_revision: 1,
  delivery_state: 'not_ready',
  design_revision: 1,
  design_state: 'unassigned',
  goal: 'Bring back last winter’s buyers',
  id: 'c1',
  lineage: {
    structureSource: 'reference_structure',
    structure: ['Hero', 'Products']
  },
  offer_id: null,
  planned_at: '2026-12-01T10:00:00Z',
  product_id: null,
  reference_notes: '',
  sequence_id: null,
  sequence_position: null,
  superseded_by_plan: null,
  synthetic: false,
  tenant_id: 't1',
  timezone: 'Europe/London',
  title: 'Cedar Lane · winter',
  updated_at: '2026-11-20T09:00:00Z',
  ...over
})
const content = (over: Partial<Content> = {}): Content => ({
  body: 'Hello from Cedar Lane',
  campaign_id: 'c1',
  created_at: '2026-11-21T09:00:00Z',
  created_by: 'u1',
  cta: 'Shop now',
  id: 'k1',
  input_revisions: {},
  preheader: 'Warm socks inside',
  primary_url: 'https://cedarlane.example/shop',
  revision: 1,
  subject: 'Winter is here',
  subject_options: ['Winter is here', 'Cold days, warm socks'],
  tenant_id: 't1',
  validation_errors: [],
  validation_state: 'passed',
  verified_claims: {},
  ...over
})
const view = (
  c: Partial<Campaign> = {},
  k: Content | null = null,
  owner = true
) =>
  draftView({
    campaign: campaign(c),
    content: k,
    comments: [{ id: 'n1', body: 'Use the red socks' }],
    audiences: [{ id: 'a1', label: 'Past buyers' }],
    owner,
    now
  })

describe('a draft in words', () => {
  it('says where it started', () => {
    expect(startedFrom({ structureSource: 'imported_reference' })).toBe(
      'An email you added'
    )
    expect(
      startedFrom({ structureSource: 'reference_structure', structure: ['A'] })
    ).toBe('An Inspiration email (A)')
    expect(startedFrom({})).toBe('Scratch')
    expect(startedFrom('junk')).toBe('Scratch')
  })

  it('maps the old statuses on the four GROS ones', () => {
    expect(draftStatus(campaign(), now)).toBe('needs_you')
    expect(draftStatus(campaign({ calendar_state: 'approved' }), now)).toBe(
      'planned'
    )
    expect(draftStatus(campaign({ delivery_state: 'sent' }), now)).toBe(
      'in_klaviyo'
    )
    expect(draftStatus(campaign({ superseded_by_plan: 'p1' }), now)).toBeNull()
  })

  it('lets only the owner act, and never on a replaced draft', () => {
    expect(view().approveDate).toBe(2)
    expect(view({}, null, false).approveDate).toBeNull()
    expect(view({ superseded_by_plan: 'p1' }).approveDate).toBeNull()
    expect(view({ calendar_state: 'approved' }).copy).toEqual({
      kind: 'none',
      write: 1
    })
    expect(view({ calendar_state: 'approved' }, null, false).copy).toEqual({
      kind: 'none',
      write: null
    })
  })
})

describe('the draft screen', () => {
  it('waits for the date before the copy', () => {
    render(<DraftScreen view={view()} />)
    expect(
      screen.getByRole('heading', { level: 1, name: 'Your draft' })
    ).toBeInTheDocument()
    expect(screen.getByText('Cedar Lane · winter')).toBeInTheDocument()
    expect(screen.getByText('Needs you')).toBeInTheDocument()
    const about = screen.getByRole('region', { name: 'The draft' })
    expect(within(about).getByText('Past buyers')).toBeInTheDocument()
    expect(
      within(screen.getByRole('region', { name: 'Details' })).getByLabelText(
        'Audience'
      )
    ).toHaveValue('a1')
    expect(screen.getByLabelText('Send time (Europe/London)')).toHaveValue(
      '2026-12-01T10:00'
    )
    expect(
      screen.getByText('An Inspiration email (Hero, Products)')
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Approve date' })
    ).toBeInTheDocument()
    expect(
      screen.getByText('Approve the date first. Then the copy is written.')
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Write copy' })).toBeNull()
    expect(screen.getByText('Use the red socks')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Save note' })
    ).toBeInTheDocument()
  })

  it('writes, saves and approves the copy with one main button', () => {
    const { unmount } = render(
      <DraftScreen view={view({ calendar_state: 'approved' })} />
    )
    const write = screen.getByRole('button', { name: 'Write copy' })
    expect(
      write
        .closest('form')!
        .querySelector('input[name="kind"]')!
        .getAttribute('value')
    ).toBe('generate_copy')
    unmount()
    render(
      <DraftScreen
        view={view(
          { calendar_state: 'approved', copy_state: 'pending_approval' },
          content({ validation_errors: ['Discount above your limit'] })
        )}
      />
    )
    const copy = screen.getByRole('region', { name: 'Copy' })
    expect(within(copy).getByLabelText('Subject')).toHaveValue('Winter is here')
    expect(within(copy).getByLabelText('Words')).toHaveValue(
      'Hello from Cedar Lane'
    )
    expect(
      within(copy).getByText('Discount above your limit')
    ).toBeInTheDocument()
    const approve = within(copy).getByRole('button', { name: 'Approve copy' })
    expect(approve.className).toContain('bg-[var(--forest)]')
    expect(
      within(copy).getByRole('button', { name: 'Save copy' }).className
    ).not.toContain('bg-[var(--forest)]')
  })

  it('shows approved copy read-only to staff', () => {
    render(
      <DraftScreen
        view={view(
          { calendar_state: 'approved', copy_state: 'approved' },
          content(),
          false
        )}
      />
    )
    const copy = screen.getByRole('region', { name: 'Copy' })
    expect(within(copy).getByText('Hello from Cedar Lane')).toBeInTheDocument()
    expect(within(copy).queryByRole('button')).toBeNull()
    expect(
      within(copy).getByText('The owner approved this copy.')
    ).toBeInTheDocument()
  })

  it('has its error, loading and error-page states', () => {
    const { unmount } = render(<DraftError />)
    expect(screen.getByRole('alert')).toHaveTextContent(
      'This draft did not open'
    )
    unmount()
    const loading = render(<DraftLoading />)
    expect(screen.getByText('Opening your draft')).toBeInTheDocument()
    loading.unmount()
    render(<DraftPageError retry={() => {}} />)
    expect(
      screen.getByRole('button', { name: 'Try again' })
    ).toBeInTheDocument()
  })
})
