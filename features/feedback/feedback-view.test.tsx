import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installDialogPolyfill } from '@/tests/helpers/dialog-polyfill'

const actions = vi.hoisted(() => ({
  sendFeatureRequest: vi.fn(async () => ({
    message: 'Thanks — your request was sent.'
  }))
}))
vi.mock('./actions', () => actions)

import { FeedbackBoard } from './feedback-view'
import type { FeatureRequest } from './rules'

installDialogPolyfill()
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const now = Date.parse('2026-11-06T12:00:00Z')
const request = (over: Partial<FeatureRequest>): FeatureRequest => ({
  id: 'r1',
  subject: 'Duplicate campaign button',
  category: 'feature',
  status: 'open',
  createdAt: '2026-11-05T10:00:00Z',
  by: 'You',
  details: 'So I can reuse last week’s email.',
  replies: [],
  ...over
})
const list = [
  request({
    replies: [
      {
        id: 'x',
        author: 'Grey Retention team',
        fromTeam: true,
        body: 'Good idea, it is on our list.',
        createdAt: '2026-11-06T09:00:00Z'
      }
    ]
  }),
  request({
    id: 'r2',
    subject: 'Preview is blank',
    category: 'bug',
    status: 'planned',
    by: 'Sam'
  }),
  request({ id: 'r3', subject: 'Dark mode', status: 'done' })
]
const board = (requests: FeatureRequest[] = list) =>
  render(
    <FeedbackBoard
      requests={requests}
      timezone="Asia/Kathmandu"
      now={now}
      team="Grey Retention team"
    />
  )

describe('FeedbackBoard', () => {
  it('shows the empty state from the old app', () => {
    board([])
    expect(screen.getByText('Nothing here yet')).toBeVisible()
    expect(
      screen.getByText(
        'Ask for what would make your day. Your request goes to the Grey Retention team.'
      )
    ).toBeVisible()
    expect(screen.getByRole('radio', { name: 'All 0' })).toBeChecked()
  })

  it('lists requests with type, status, author, date and team replies', () => {
    board()
    const first = screen.getByText('Duplicate campaign button').closest('li')!
    expect(within(first).getByText('Feature Request')).toBeVisible()
    expect(within(first).getByText('Open')).toBeVisible()
    expect(first).toHaveTextContent('You · Nov 5')
    const replies = within(first).getByRole('list', {
      name: 'Replies to Duplicate campaign button'
    })
    expect(replies).toHaveTextContent('Grey Retention team · Nov 6')
    expect(replies).toHaveTextContent('Good idea, it is on our list.')
    const second = screen.getByText('Preview is blank').closest('li')!
    expect(within(second).getByText('Bug')).toBeVisible()
    expect(within(second).getByText('Planned')).toBeVisible()
  })

  it('filters by status with counts, and searches', async () => {
    board()
    expect(screen.getByRole('radio', { name: 'All 3' })).toBeChecked()
    await userEvent.click(screen.getByRole('radio', { name: 'Planned 1' }))
    expect(screen.getByText('Preview is blank')).toBeVisible()
    expect(screen.queryByText('Dark mode')).toBeNull()
    await userEvent.click(screen.getByRole('radio', { name: 'All 3' }))
    await userEvent.type(
      screen.getByPlaceholderText('Search your requests…'),
      'on our list'
    )
    expect(screen.getByText('Duplicate campaign button')).toBeVisible()
    expect(screen.queryByText('Preview is blank')).toBeNull()
    await userEvent.type(
      screen.getByPlaceholderText('Search your requests…'),
      ' nothing like this'
    )
    expect(screen.getByText('No requests match.')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Show all' }))
    expect(screen.getByText('Dark mode')).toBeVisible()
  })

  it('keeps Send disabled until subject and details are filled, then sends', async () => {
    board([])
    await userEvent.click(
      screen.getAllByRole('button', { name: /New request/ })[0]!
    )
    const dialog = screen.getByRole('dialog', { name: 'Request a Feature' })
    const send = within(dialog).getByRole('button', { name: 'Send' })
    expect(
      within(dialog).getByRole('radio', { name: /Feature Request/ })
    ).toBeChecked()
    expect(send).toBeDisabled()
    await userEvent.type(within(dialog).getByLabelText('Subject'), 'Dark mode')
    expect(send).toBeDisabled()
    await userEvent.type(
      within(dialog).getByLabelText('Details'),
      'Easier on the eyes.'
    )
    await userEvent.click(
      within(dialog).getByRole('radio', { name: /Improve Existing/ })
    )
    expect(send).toBeEnabled()
    await userEvent.click(send)
    await vi.waitFor(() =>
      expect(actions.sendFeatureRequest).toHaveBeenCalled()
    )
    const sent = (
      actions.sendFeatureRequest.mock.calls[0] as unknown[]
    )[1] as FormData
    expect(Object.fromEntries(sent)).toEqual({
      category: 'improvement',
      subject: 'Dark mode',
      details: 'Easier on the eyes.'
    })
    expect(
      await screen.findByText('Thanks — your request was sent.')
    ).toBeVisible()
    await vi.waitFor(() =>
      expect(
        screen.getByRole('region', { name: 'Your requests' })
      ).toHaveFocus()
    )
  })

  it('keeps the text and shows why when sending fails', async () => {
    actions.sendFeatureRequest.mockResolvedValueOnce({
      error: 'We could not send this. Nothing was saved. Try again.'
    } as never)
    board([])
    await userEvent.click(
      screen.getAllByRole('button', { name: /New request/ })[0]!
    )
    const dialog = screen.getByRole('dialog', { name: 'Request a Feature' })
    await userEvent.type(within(dialog).getByLabelText('Subject'), 'Dark mode')
    await userEvent.type(within(dialog).getByLabelText('Details'), 'Please.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send' }))
    expect(await within(dialog).findByText(/Nothing was saved/)).toBeVisible()
    expect(within(dialog).getByLabelText('Subject')).toHaveValue('Dark mode')
  })

  it('Cancel closes with nothing saved (asks first when typed)', async () => {
    board([])
    await userEvent.click(
      screen.getAllByRole('button', { name: /New request/ })[0]!
    )
    const dialog = screen.getByRole('dialog', { name: 'Request a Feature' })
    await userEvent.type(
      within(dialog).getByLabelText('Subject'),
      'Half an idea'
    )
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Cancel' })
    )
    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Discard'
      })
    )
    expect(actions.sendFeatureRequest).not.toHaveBeenCalled()
    // A fresh form next time.
    await userEvent.click(
      screen.getAllByRole('button', { name: /New request/ })[0]!
    )
    expect(
      within(
        screen.getByRole('dialog', { name: 'Request a Feature' })
      ).getByLabelText('Subject')
    ).toHaveValue('')
  })
})
