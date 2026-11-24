import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./actions', () => ({
  updateAccount: vi.fn(async () => ({})),
  changePassword: vi.fn(async () => ({}))
}))

import AccountLoading from '@/app/(gros)/settings/account/loading'
import { AccountScreen } from './screen'

afterEach(cleanup)

describe('Account (UI-AUTH)', () => {
  it('is a GROS page under Settings with the two forms as cards', () => {
    render(
      <AccountScreen
        profile={{
          name: 'Sam Cedar',
          email: 'owner@cedarlane.example',
          jobTitle: 'Founder',
          phone: ''
        }}
      />
    )
    expect(
      screen.getByRole('heading', { level: 1, name: 'Account' })
    ).toBeVisible()
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(
      screen.getByRole('link', { name: 'Back to Settings' })
    ).toHaveAttribute('href', '/settings')
    const account = screen.getByRole('region', {
      name: 'Account information'
    })
    expect(within(account).getByLabelText('Name')).toHaveValue('Sam Cedar')
    const password = screen.getByRole('region', { name: 'Change password' })
    expect(
      within(password).getByRole('button', { name: 'Update password' })
    ).toBeVisible()
  })

  it('says to sign in again when the profile cannot be read', () => {
    render(<AccountScreen profile={null} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Account did not open')
    expect(screen.getByRole('link', { name: 'Sign in again' })).toHaveAttribute(
      'href',
      '/login'
    )
    expect(screen.queryByLabelText('Name')).toBeNull()
  })

  it('opens with its words and the bar, busy, and no main', () => {
    const { container } = render(<AccountLoading />)
    expect(screen.getByText('Opening your account')).toBeInTheDocument()
    expect(container.querySelector('main')).toBeNull()
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
  })
})
