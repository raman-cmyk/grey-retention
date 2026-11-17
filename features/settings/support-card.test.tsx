import {
  cleanup,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

const ops = vi.hoisted(() => ({ operationAction: vi.fn() }))
vi.mock('@/features/operations/actions', () => ops)

import type { FeatureRequest } from '@/features/feedback/rules'
import type { SettingsView } from './page-model'
import { SupportCard } from './support-card'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const tenant = '00000000-0000-4000-8000-000000000101'
const thread = (over: Partial<FeatureRequest>): FeatureRequest => ({
  id: '00000000-0000-4000-8000-0000000000b1',
  subject: 'Klaviyo drafts',
  category: null,
  status: 'open',
  revision: 2,
  createdAt: '2026-11-16T10:00:00Z',
  by: 'You',
  details: 'Where do my drafts go?',
  replies: [],
  ...over
})
const answered = thread({
  status: 'planned',
  replies: [
    {
      id: 'm2',
      author: 'Grey Retention team',
      fromTeam: true,
      body: 'In Klaviyo, as drafts.',
      createdAt: '2026-11-16T12:00:00Z'
    }
  ]
})
const closed = thread({
  id: '00000000-0000-4000-8000-0000000000b2',
  subject: 'Old question',
  status: 'done',
  revision: 5
})

/** The card as Settings draws it; it reads the threads and the timezone. */
const supportCard = (
  support: SettingsView['support'],
  timezone: string | null = 'Asia/Kathmandu'
) => (
  <SupportCard
    view={
      {
        support,
        timezone: timezone ? { saved: timezone } : null
      } as unknown as SettingsView
    }
    unread={<p>Your support questions could not be read just now.</p>}
  />
)
const card = () => screen.getByRole('region', { name: 'Support' })
const fieldsOf = (button: HTMLElement) =>
  Object.fromEntries(
    new FormData(button.closest('form')!) as unknown as [string, string][]
  )
const ready = (threads: FeatureRequest[], more = false) => ({
  threads,
  more,
  team: 'Grey Retention team',
  tenantId: tenant
})

describe('Support on Settings (UI-SETd)', () => {
  it('asks a new question with its subject and text', () => {
    render(supportCard(ready([])))
    expect(card()).toHaveTextContent('No questions yet.')
    expect(screen.getByRole('heading', { name: 'Support' })).toHaveAttribute(
      'id',
      'support'
    )
    const send = within(card()).getByRole('button', {
      name: 'Send to support'
    })
    expect(send.className).toContain('bg-[var(--forest)]')
    expect(fieldsOf(send)).toEqual({
      surface: 'client',
      kind: 'open_ticket',
      ticketKind: 'support',
      subject: '',
      body: ''
    })
    expect(within(card()).getByLabelText('Your question').tagName).toBe(
      'TEXTAREA'
    )
  })

  it('shows each thread with who wrote what and when, and a reply under it', () => {
    render(supportCard(ready([answered, closed])))
    const threads = within(
      within(card()).getByRole('list', { name: 'Support threads' })
    ).getAllByRole('listitem', { name: undefined })
    const first = threads[0]!
    expect(
      within(first).getByRole('heading', { name: 'Klaviyo drafts' })
    ).toBeVisible()
    expect(first).toHaveTextContent('Being looked at')
    expect(first).toHaveTextContent(
      'You · Nov 16, 2026 · 3:45 PMWhere do my drafts go?'
    )
    expect(first).toHaveTextContent(
      'Grey Retention team · Nov 16, 2026 · 5:45 PMIn Klaviyo, as drafts.'
    )
    expect(
      fieldsOf(
        within(first).getByRole('button', {
          name: 'Send reply: Klaviyo drafts'
        })
      )
    ).toEqual({
      surface: 'client',
      kind: 'reply_ticket',
      id: answered.id,
      tenant,
      revision: '2',
      state: 'in_progress',
      body: ''
    })
    // A reply to a closed thread opens it again.
    expect(card()).toHaveTextContent('Closed')
    expect(
      fieldsOf(
        within(card()).getByRole('button', { name: 'Send reply: Old question' })
      )
    ).toMatchObject({ id: closed.id, revision: '5', state: 'open' })
    // Each reply is named after its thread, and the question stays apart.
    expect(
      within(first).getByLabelText('Your reply to Klaviyo drafts').tagName
    ).toBe('TEXTAREA')
    expect(
      within(card()).getAllByLabelText('Your question', { exact: true })
    ).toHaveLength(1)
    expect(
      within(card()).queryByRole('link', { name: 'Show older' })
    ).toBeNull()
  })

  it('offers Show older when there are more, and says UTC when the timezone is unknown', () => {
    render(supportCard(ready([answered], true), null))
    expect(
      within(card()).getByRole('link', { name: 'Show older' })
    ).toHaveAttribute('href', '/settings?support=all#support')
    expect(card()).toHaveTextContent(
      'You · Nov 16, 2026 · 10:00 AM UTCWhere do my drafts go?'
    )
  })

  it('answers in the card, and keeps a refused question to fix', async () => {
    const user = userEvent.setup()
    ops.operationAction
      .mockResolvedValueOnce({
        error: 'Write a subject of at least 2 characters, and your question.'
      })
      .mockResolvedValueOnce({
        message: 'Sent to support. Their reply shows here.'
      })
    render(supportCard(ready([])))
    await user.type(within(card()).getByLabelText('Subject'), 'K')
    await user.type(within(card()).getByLabelText('Your question'), 'Help')
    await user.click(
      within(card()).getByRole('button', { name: 'Send to support' })
    )
    await waitFor(() =>
      expect(card()).toHaveTextContent(
        'Write a subject of at least 2 characters, and your question.'
      )
    )
    expect(within(card()).getByLabelText('Subject')).toHaveValue('K')
    await user.type(within(card()).getByLabelText('Subject'), 'laviyo')
    await user.click(
      within(card()).getByRole('button', { name: 'Send to support' })
    )
    await waitFor(() =>
      expect(card()).toHaveTextContent(
        'Sent to support. Their reply shows here.'
      )
    )
    expect(within(card()).getByLabelText('Subject')).toHaveValue('')
  })

  it('shows only why when the threads could not be read (also the demo)', () => {
    render(supportCard(null))
    expect(card()).toHaveTextContent(
      'Your support questions could not be read just now.'
    )
    expect(within(card()).queryByRole('button')).toBeNull()
  })
})
