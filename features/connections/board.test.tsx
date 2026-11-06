import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const actions = vi.hoisted(() => ({
  connectKlaviyo: vi.fn(async () => ({})),
  connectShopify: vi.fn(async () => ({}))
}))
vi.mock('./actions', () => actions)

import { ConnectionsBoard, type ConnectionView } from './board'

afterEach(cleanup)

const klaviyo: ConnectionView = {
  status: 'connected',
  accountLabel: 'Juniper Supply',
  credentialHint: 'pk_Ab3dE••••••••1a2b',
  shopDomain: null,
  templateCount: 218
}
const card = (name: string) =>
  screen.getByRole('heading', { name, level: 2 }).closest('section')!

describe('ConnectionsBoard', () => {
  it('shows two cards with their benefit lists', () => {
    render(<ConnectionsBoard owner klaviyo={null} shopify={null} />)
    expect(
      within(card('Klaviyo')).getByText('Unlocks flows & segments')
    ).toBeVisible()
    expect(within(card('Klaviyo')).getByText('Sync CLTV data')).toBeVisible()
    expect(
      within(card('Klaviyo')).getByText('Deliverability insights')
    ).toBeVisible()
    expect(
      within(card('Shopify')).getByText('Products & inventory')
    ).toBeVisible()
    expect(
      within(card('Shopify')).getByText('Orders & customers')
    ).toBeVisible()
    expect(
      within(card('Shopify')).getByText('Discount-code creation')
    ).toBeVisible()
  })

  it('says what is missing while Shopify is not connected', () => {
    render(<ConnectionsBoard owner klaviyo={null} shopify={null} />)
    expect(
      within(card('Shopify')).getByText(
        'Without Shopify: no Store page, no UTM revenue, product list may be outdated.'
      )
    ).toBeVisible()
    cleanup()
    render(
      <ConnectionsBoard
        owner
        klaviyo={null}
        shopify={{
          ...klaviyo,
          shopDomain: 'cedar.myshopify.com',
          templateCount: null
        }}
      />
    )
    expect(screen.queryByText(/Without Shopify/)).toBeNull()
  })

  it('offers a key input and Connect when Klaviyo is not connected', () => {
    render(<ConnectionsBoard owner klaviyo={null} shopify={null} />)
    const key = within(card('Klaviyo')).getByLabelText('Private API key')
    expect(key).toHaveAttribute('type', 'password')
    expect(key).toHaveAttribute('placeholder', 'pk_…')
    expect(key).toHaveAttribute('autocomplete', 'off')
    expect(
      within(card('Klaviyo')).getByRole('button', { name: 'Connect' })
    ).toBeVisible()
  })

  it('shows the connected Klaviyo state and reveals the key swap', async () => {
    render(<ConnectionsBoard owner klaviyo={klaviyo} shopify={null} />)
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

  it('opens the full-width Shopify form with autofill turned off', async () => {
    render(<ConnectionsBoard owner klaviyo={null} shopify={null} />)
    expect(
      screen.queryByRole('heading', { name: 'Connect your Shopify store' })
    ).toBeNull()
    const open = screen.getByRole('button', { name: 'Connect Shopify' })
    expect(open).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(open)
    expect(open).toHaveAttribute('aria-expanded', 'true')
    expect(open).toHaveAttribute('aria-controls', 'connect-shopify')
    expect(screen.getByLabelText('Shop domain')).toHaveFocus()
    const form = screen
      .getByRole('heading', { name: 'Connect your Shopify store' })
      .closest('section')!
    const domain = within(form).getByLabelText('Shop domain')
    expect(domain).toHaveAttribute('autocomplete', 'off')
    expect(domain).toHaveAttribute('placeholder', 'your-store.myshopify.com')
    expect(
      within(form).getByLabelText('Admin API access token')
    ).toHaveAttribute('type', 'password')
    for (const scope of [
      'read_products',
      'read_orders',
      'read_customers',
      'read_analytics'
    ])
      expect(within(form).getByText(scope)).toBeVisible()
    expect(
      within(form).getByRole('button', { name: 'Verify & connect' })
    ).toBeVisible()
    expect(within(form).getByText('Common issues')).toBeVisible()
    expect(
      within(form).getByRole('link', { name: 'How to create a Custom App →' })
    ).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('warns at once when an email lands in the domain field', async () => {
    render(<ConnectionsBoard owner klaviyo={null} shopify={null} />)
    await userEvent.click(
      screen.getByRole('button', { name: 'Connect Shopify' })
    )
    const domain = screen.getByLabelText('Shop domain')
    await userEvent.type(domain, 'raman@greyemails.com')
    expect(domain).toHaveAttribute('aria-invalid', 'true')
    expect(domain).toHaveAccessibleDescription(
      /^That looks like an email address\. Use your store’s \.myshopify\.com address\.$/
    )
  })

  it('shows staff the state but no connect controls', () => {
    render(<ConnectionsBoard owner={false} klaviyo={klaviyo} shopify={null} />)
    expect(screen.queryByRole('button', { name: 'Update API key' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Connect Shopify' })).toBeNull()
    expect(screen.queryByLabelText('Private API key')).toBeNull()
    expect(
      screen.getByText(
        'Not connected. Ask your workspace owner to connect Shopify.'
      )
    ).toBeVisible()
  })

  it('shows a failed connection as needing attention, not as missing', () => {
    render(
      <ConnectionsBoard
        owner
        klaviyo={{ ...klaviyo, status: 'expired' }}
        shopify={{ ...klaviyo, status: 'error', templateCount: null }}
      />
    )
    expect(
      within(card('Klaviyo')).getByText(
        'This connection has expired. Paste a new private API key to reconnect.'
      )
    ).toBeVisible()
    expect(
      within(card('Shopify')).getByText(
        'This connection stopped working. Connect the store again with a new access token.'
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
    render(<ConnectionsBoard owner klaviyo={klaviyo} shopify={null} />)
    expect(screen.queryByText(/This connection/)).toBeNull()
  })

  it('keeps the success message and focus when the card switches to connected', async () => {
    actions.connectKlaviyo.mockResolvedValueOnce({
      message:
        'Klaviyo connected with sample data. Nothing was sent to Klaviyo.'
    })
    const view = render(
      <ConnectionsBoard owner klaviyo={null} shopify={null} />
    )
    await userEvent.type(
      screen.getByLabelText('Private API key'),
      'pk_Ab3dEfg12hi34jk56lm78no90pq12rs1a2b'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }))
    await screen.findByText(
      'Klaviyo connected with sample data. Nothing was sent to Klaviyo.'
    )
    // The server re-renders the page with the saved connection.
    view.rerender(<ConnectionsBoard owner klaviyo={klaviyo} shopify={null} />)
    expect(
      screen.getByText(
        'Klaviyo connected with sample data. Nothing was sent to Klaviyo.'
      )
    ).toBeVisible()
    expect(within(card('Klaviyo')).getByRole('status')).toHaveFocus()
  })

  it('labels the sample mode honestly', () => {
    render(<ConnectionsBoard owner klaviyo={null} shopify={null} />)
    expect(
      within(card('Klaviyo')).getByText(/Sample mode: we check the format only/)
    ).toBeVisible()
  })
})
