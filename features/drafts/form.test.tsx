import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FirstDraftForm } from './form'
const { createFirstDraft } = vi.hoisted(() => ({ createFirstDraft: vi.fn() }))
vi.mock('./actions', () => ({ createFirstDraft }))
afterEach(cleanup)
const reference = {
  id: crypto.randomUUID(),
  subject: 'Original sample reference',
  safe_html: '<p>Original sample content</p>',
  received_at: '2026-10-28T00:00:00Z'
}
const props = {
  references: [reference],
  audiences: [],
  timezone: 'UTC',
  defaultDate: '2099-11-01T10:00',
  requestKey: crypto.randomUUID(),
  brandName: 'Wellness'
}
describe('First draft composer', () => {
  it('preselects an accessible reference and keeps its preview isolated', async () => {
    render(<FirstDraftForm {...props} selectedReference={reference.id} />)
    expect(screen.getByLabelText('Start with')).toHaveValue(reference.id)
    expect(
      screen.getByText('Plan details · optional').closest('details')
    ).not.toHaveAttribute('open')
    expect(screen.getByText(/We reuse its section structure/)).toBeVisible()
    await userEvent.click(screen.getByText('See the original email'))
    expect(screen.getByTitle('Selected reference preview')).toHaveAttribute(
      'sandbox',
      ''
    )
    expect(screen.getByTitle('Selected reference preview')).toHaveAttribute(
      'referrerpolicy',
      'no-referrer'
    )
  })
  it('opens plan details when a repeated clock time needs a decision', () => {
    render(
      <FirstDraftForm
        {...props}
        timezone="America/New_York"
        defaultDate="2026-11-01T01:30"
      />
    )
    expect(
      screen.getByText('Plan details · optional').closest('details')
    ).toHaveAttribute('open')
    expect(
      screen.getByRole('option', { name: /First occurrence/ })
    ).toHaveTextContent('GMT-4')
    expect(
      screen.getByRole('option', { name: /Second occurrence/ })
    ).toHaveTextContent('GMT-5')
    expect(
      screen.getByLabelText('This time occurs twice when clocks change')
    ).toBeRequired()
  })
  it('preserves entered content and the request key after a save failure', async () => {
    createFirstDraft.mockResolvedValue({ error: 'Source no longer available.' })
    const user = userEvent.setup()
    render(<FirstDraftForm {...props} />)
    await user.type(
      screen.getByLabelText('What should this email do?'),
      'Explain our new collection'
    )
    await user.selectOptions(screen.getByLabelText('Start with'), reference.id)
    await user.click(screen.getByRole('button', { name: 'Create my draft' }))
    expect(await screen.findByText('Source no longer available.')).toBeVisible()
    expect(screen.getByLabelText('What should this email do?')).toHaveValue(
      'Explain our new collection'
    )
    expect(screen.getByLabelText('Start with')).toHaveValue(reference.id)
    expect(
      (createFirstDraft.mock.calls.at(-1)![1] as FormData).get('requestKey')
    ).toBe(props.requestKey)
  })
})
