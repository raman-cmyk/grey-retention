import {
  cleanup,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

const feedback = vi.hoisted(() => ({ sendFeatureRequest: vi.fn() }))
vi.mock('@/features/feedback/actions', () => feedback)
vi.mock('@/features/operations/actions', () => ({ operationAction: vi.fn() }))

import type { FeatureRequest } from '@/features/feedback/rules'
import type { SettingsView } from './page-model'
import { RequestsCard } from './requests-card'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const planned: FeatureRequest = {
  id: 'r1',
  subject: 'Duplicate an email',
  category: 'improvement',
  status: 'planned',
  revision: 1,
  createdAt: '2026-11-16T10:00:00Z',
  by: 'You',
  details: 'So I can reuse last week’s email.',
  replies: [
    {
      id: 'm2',
      author: 'Grey Retention team',
      fromTeam: true,
      body: 'On our list.',
      createdAt: '2026-11-16T12:00:00Z'
    }
  ]
}

/** The card as Settings draws it; it reads the requests and the timezone. */
const requestsCard = (requests: SettingsView['requests']) => (
  <RequestsCard
    view={
      {
        requests,
        timezone: { saved: 'Asia/Kathmandu' }
      } as unknown as SettingsView
    }
    unread={<p>Your feature requests could not be read just now.</p>}
  />
)
const card = () => screen.getByRole('region', { name: 'Feature requests' })
const fieldsOf = (button: HTMLElement) =>
  Object.fromEntries(
    new FormData(button.closest('form')!) as unknown as [string, string][]
  )

describe('Feature requests on Settings (UI-SETd)', () => {
  it('lists each request with its type, status, date and the team’s replies', () => {
    render(
      requestsCard({
        items: [
          planned,
          {
            ...planned,
            id: 'r2',
            category: null,
            status: 'done',
            subject: 'Old idea'
          }
        ]
      })
    )
    const items = within(card()).getAllByRole('heading', { level: 3 })
    expect(items.map((h) => h.textContent)).toEqual([
      'Duplicate an email',
      'Old idea'
    ])
    const first = items[0]!.closest('li')!
    expect(first).toHaveTextContent('Improve Existing · Planned · Nov 16, 2026')
    expect(first).toHaveTextContent(
      'You · Nov 16, 2026 · 3:45 PMSo I can reuse last week’s email.'
    )
    expect(first).toHaveTextContent(
      'Grey Retention team · Nov 16, 2026 · 5:45 PMOn our list.'
    )
    // A request without a type still says its status.
    expect(items[1]!.closest('li')).toHaveTextContent('Done · Nov 16, 2026')
  })

  it('sends a request with its type, subject and details', async () => {
    const user = userEvent.setup()
    feedback.sendFeatureRequest
      .mockResolvedValueOnce({ error: 'Subject: at least 2 characters.' })
      .mockResolvedValueOnce({ message: 'Thanks — your request was sent.' })
    render(requestsCard({ items: [] }))
    expect(card()).toHaveTextContent('No requests yet.')
    const send = within(card()).getByRole('button', { name: 'Send request' })
    expect(send.className).toContain('bg-[var(--forest)]')
    expect(fieldsOf(send)).toEqual({
      category: 'feature',
      subject: '',
      details: ''
    })
    expect(
      within(within(card()).getByLabelText('Type'))
        .getAllByRole('option')
        .map((o) => o.textContent)
    ).toEqual([
      'Feature Request: Something new you would like.',
      'Improve Existing: Make something better.',
      'Bug: Something is broken.',
      'General Feedback: Anything else.'
    ])
    await user.selectOptions(within(card()).getByLabelText('Type'), 'bug')
    await user.type(within(card()).getByLabelText('Subject'), 'P')
    await user.type(within(card()).getByLabelText('Details'), 'Blank preview')
    await user.click(send)
    await waitFor(() =>
      expect(card()).toHaveTextContent('Subject: at least 2 characters.')
    )
    // A refusal keeps what was typed to fix.
    expect(within(card()).getByLabelText('Subject')).toHaveValue('P')
    await user.type(within(card()).getByLabelText('Subject'), 'review')
    await user.click(send)
    await waitFor(() =>
      expect(card()).toHaveTextContent('Thanks — your request was sent.')
    )
    expect(
      Object.fromEntries(
        feedback.sendFeatureRequest.mock.calls[1]![1] as unknown as [
          string,
          string
        ][]
      )
    ).toEqual({
      category: 'bug',
      subject: 'Preview',
      details: 'Blank preview'
    })
    expect(within(card()).getByLabelText('Subject')).toHaveValue('')
  })

  it('shows only why when the requests could not be read (also the demo)', () => {
    render(requestsCard(null))
    expect(card()).toHaveTextContent(
      'Your feature requests could not be read just now.'
    )
    expect(within(card()).queryByRole('button')).toBeNull()
  })
})
