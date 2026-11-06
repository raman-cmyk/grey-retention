import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GettingStarted } from './start'

const {
  campaignWorkspace,
  referenceWorkspace,
  pastedReferences,
  latestEmailResult,
  refresh
} = vi.hoisted(() => ({
  campaignWorkspace: vi.fn(),
  referenceWorkspace: vi.fn(),
  pastedReferences: vi.fn(),
  latestEmailResult: vi.fn(),
  refresh: vi.fn()
}))
vi.mock('@/features/campaigns/data', () => ({ campaignWorkspace }))
vi.mock('@/features/references/data', () => ({ referenceWorkspace }))
vi.mock('@/features/references/pasted-data', () => ({ pastedReferences }))
vi.mock('@/features/email-generation/data', () => ({ latestEmailResult }))
vi.mock('@/features/brand/actions', () => ({ brandAction: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

const context = { tenantName: 'Wellness', tenantRole: 'owner' }
const brand = {
  revision: 3,
  brand_name: 'Wellness',
  domain: 'wellness.example',
  positioning: 'Saved facts',
  voice: 'Warm',
  prohibitions: 'No medical claims'
}
beforeEach(() => {
  refresh.mockReset()
  campaignWorkspace.mockResolvedValue({
    context,
    data: { brand: null, campaigns: [] },
    error: null
  })
  referenceWorkspace.mockResolvedValue({ data: { emails: [] }, error: null })
  pastedReferences.mockResolvedValue({ data: [], error: null })
  latestEmailResult.mockResolvedValue({ data: null, error: null })
})

describe('Getting started', () => {
  it('starts with one brand form and keeps optional details out of the way', async () => {
    render(await GettingStarted({}))
    expect(
      screen.getByRole('heading', { name: 'Which store is yours?' })
    ).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Brand name' })).toHaveValue(
      'Wellness'
    )
    expect(
      screen.getByText('Brand voice and rules · optional').closest('details')
    ).not.toHaveAttribute('open')
    expect(screen.getByRole('link', { name: 'Exit setup' })).toHaveAttribute(
      'href',
      '/dashboard'
    )
  })
  it('resumes from saved data and lets the owner revisit brand rules without losing them', async () => {
    campaignWorkspace.mockResolvedValue({
      context,
      data: { brand, campaigns: [] },
      error: null
    })
    const { unmount } = render(await GettingStarted({}))
    expect(
      screen.getByRole('heading', { name: 'Start with one email.' })
    ).toBeVisible()
    expect(
      screen.getByText(/Real competitor monitoring is still to be built/)
    ).toBeVisible()
    unmount()
    render(await GettingStarted({ step: 'brand' }))
    expect(
      screen.getByRole('textbox', {
        name: 'Anything we should avoid?',
        hidden: true
      })
    ).toHaveValue('No medical claims')
    expect(document.querySelector('input[name="revision"]')).toHaveValue('3')
  })
  it('offers pasting an email as the one primary reference action', async () => {
    campaignWorkspace.mockResolvedValue({
      context,
      data: { brand, campaigns: [] },
      error: null
    })
    render(await GettingStarted({ step: 'reference' }))
    expect(
      screen.getByRole('link', { name: 'Paste an email' })
    ).toHaveAttribute('href', '/import-reference')
    expect(
      screen.getByRole('link', { name: 'Add a sample competitor' })
    ).toBeVisible()
  })
  it('counts a pasted email as reference progress and offers to reuse it', async () => {
    const id = crypto.randomUUID()
    campaignWorkspace.mockResolvedValue({
      context,
      data: { brand, campaigns: [] },
      error: null
    })
    pastedReferences.mockResolvedValue({
      data: [{ id, subject: 'Spring note' }],
      error: null
    })
    render(await GettingStarted({ step: 'reference' }))
    expect(
      screen.getByRole('link', { name: /Add an email/ })
    ).toHaveTextContent('Complete:')
    expect(
      screen.getByRole('link', { name: /Use “Spring note”/ })
    ).toHaveAttribute('href', `/create-email/${id}`)
  })
  it('resumes at the saved email once one exists', async () => {
    const id = crypto.randomUUID()
    campaignWorkspace.mockResolvedValue({
      context,
      data: { brand, campaigns: [] },
      error: null
    })
    pastedReferences.mockResolvedValue({
      data: [{ id: crypto.randomUUID(), subject: 'Spring note' }],
      error: null
    })
    latestEmailResult.mockResolvedValue({
      data: { id, mode: 'copy' },
      error: null
    })
    render(await GettingStarted({}))
    expect(
      screen.getByRole('heading', { name: 'Your email is saved.' })
    ).toBeVisible()
    expect(screen.getByRole('link', { name: /Open my email/ })).toHaveAttribute(
      'href',
      `/emails/${id}`
    )
  })
  it('does not present owner mutation controls to members', async () => {
    campaignWorkspace.mockResolvedValue({
      context: { ...context, tenantRole: 'staff' },
      data: { brand: null, campaigns: [] },
      error: null
    })
    render(await GettingStarted({}))
    expect(
      screen.queryByRole('button', { name: 'Save brand details' })
    ).not.toBeInTheDocument()
    expect(
      screen.getByText('Ask your workspace owner to save the brand details.')
    ).toBeVisible()
  })
  it('does not mark unavailable records as empty or completed', async () => {
    referenceWorkspace.mockResolvedValue({
      data: null,
      error: 'Reference evidence unavailable.'
    })
    render(await GettingStarted({}))
    expect(screen.getByText('Reference evidence unavailable.')).toBeVisible()
    expect(
      screen.queryByRole('navigation', { name: 'Setup progress' })
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refresh).toHaveBeenCalledOnce()
  })
})

afterEach(cleanup)
