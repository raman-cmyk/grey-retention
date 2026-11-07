import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const actions = vi.hoisted(() => ({
  connectKlaviyo: vi.fn(async () => ({}))
}))
vi.mock('./actions', () => actions)

import { ConnectionsBoard, type ConnectionView } from './board'

afterEach(cleanup)

const klaviyo: ConnectionView = {
  status: 'connected',
  accountLabel: 'Juniper Supply',
  credentialHint: 'pk_Ab3dE••••••••1a2b',
  templateCount: 218
}
const card = (name: string) =>
  screen.getByRole('heading', { name, level: 2 }).closest('section')!

describe('ConnectionsBoard', () => {
  it('shows the Klaviyo card with its benefits, and no Shopify card (Klaviyo only)', () => {
    render(<ConnectionsBoard owner klaviyo={null} />)
    expect(screen.queryByRole('heading', { name: 'Shopify' })).toBeNull()
    expect(screen.queryByText(/Shopify/)).toBeNull()
    expect(
      within(card('Klaviyo')).getByText('Unlocks flows & segments')
    ).toBeVisible()
    expect(within(card('Klaviyo')).getByText('Sync CLTV data')).toBeVisible()
    expect(
      within(card('Klaviyo')).getByText('Deliverability insights')
    ).toBeVisible()
  })

  it('offers a key input and Connect when Klaviyo is not connected', () => {
    render(<ConnectionsBoard owner klaviyo={null} />)
    const key = within(card('Klaviyo')).getByLabelText('Private API key')
    expect(key).toHaveAttribute('type', 'password')
    expect(key).toHaveAttribute('placeholder', 'pk_…')
    expect(key).toHaveAttribute('autocomplete', 'off')
    expect(
      within(card('Klaviyo')).getByRole('button', { name: 'Connect' })
    ).toBeVisible()
  })

  it('shows the connected Klaviyo state and reveals the key swap', async () => {
    render(<ConnectionsBoard owner klaviyo={klaviyo} />)
    const k = card('Klaviyo')
    expect(within(k).getByText('Pulled 218 sample templates')).toBeVisible()
    expect(within(k).getByRole('status')).toHaveTextContent('Klaviyo Connected')
    expect(
      within(k).getByText('Juniper Supply · pk_Ab3dE••••••••1a2b')
    ).toBeVisible()
    expect(within(k).queryByLabelText('New private API key')).toBeNull()
    const toggle = within(k).getByRole('button', { name: 'Update API key' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const key = within(k).getByLabelText('New private API key')
    expect(key).toHaveAttribute('type', 'password')
    expect(key).toHaveFocus()
    expect(
      within(k).getByRole('button', { name: 'Validate & swap key' })
    ).toBeVisible()
    expect(
      within(k).getByText(/If it fails, your existing key stays in place\./)
    ).toBeVisible()
  })

  it('shows staff the state but no connect controls', () => {
    render(<ConnectionsBoard owner={false} klaviyo={klaviyo} />)
    expect(screen.queryByRole('button', { name: 'Update API key' })).toBeNull()
    expect(screen.queryByLabelText('Private API key')).toBeNull()
  })

  it('shows a failed connection as needing attention, not as missing', () => {
    render(
      <ConnectionsBoard owner klaviyo={{ ...klaviyo, status: 'expired' }} />
    )
    expect(
      within(card('Klaviyo')).getByText(
        'This connection has expired. Paste a new private API key to reconnect.'
      )
    ).toBeVisible()
    // Present at page load, so not announced as an alert every time.
    expect(screen.queryByRole('alert')).toBeNull()
    expect(
      within(card('Klaviyo')).getByLabelText('Private API key')
    ).toBeVisible()
    expect(within(card('Klaviyo')).queryByText(/Pulled 218/)).toBeNull()
  })

  it('shows no warning for healthy or missing connections', () => {
    render(<ConnectionsBoard owner klaviyo={klaviyo} />)
    expect(screen.queryByText(/This connection/)).toBeNull()
  })

  it('keeps the success message and focus when the card switches to connected', async () => {
    actions.connectKlaviyo.mockResolvedValueOnce({
      message:
        'Klaviyo connected with sample data. Nothing was sent to Klaviyo.'
    })
    const view = render(<ConnectionsBoard owner klaviyo={null} />)
    await userEvent.type(
      screen.getByLabelText('Private API key'),
      'pk_Ab3dEfg12hi34jk56lm78no90pq12rs1a2b'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }))
    await screen.findByText(
      'Klaviyo connected with sample data. Nothing was sent to Klaviyo.'
    )
    // The server re-renders the page with the saved connection.
    view.rerender(<ConnectionsBoard owner klaviyo={klaviyo} />)
    expect(
      screen.getByText(
        'Klaviyo connected with sample data. Nothing was sent to Klaviyo.'
      )
    ).toBeVisible()
    expect(within(card('Klaviyo')).getByRole('status')).toHaveFocus()
  })

  it('labels the sample mode honestly', () => {
    render(<ConnectionsBoard owner klaviyo={null} />)
    expect(
      within(card('Klaviyo')).getByText(/Sample mode: we check the format only/)
    ).toBeVisible()
  })
})
