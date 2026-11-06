import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const actions = vi.hoisted(() => ({
  updateAccount: vi.fn(async () => ({})),
  changePassword: vi.fn(async () => ({}))
}))
vi.mock('./actions', () => actions)
vi.mock('next/link', () => ({
  default: ({
    href,
    children
  }: {
    href: string
    children: React.ReactNode
  }) => <a href={href}>{children}</a>
}))

import { AccountForm, PasswordForm } from './forms'

afterEach(cleanup)

describe('AccountForm', () => {
  it('shows the account fields with the email locked and a support link', () => {
    render(
      <AccountForm
        name="Rae Owner"
        email="rae@example.com"
        jobTitle="Founder"
        phone=""
      />
    )
    expect(
      screen.getByRole('heading', { name: 'Account information' })
    ).toBeVisible()
    expect(
      screen.getByText('Name, job title, and contact phone.')
    ).toBeVisible()
    expect(screen.getByLabelText('Name')).toHaveValue('Rae Owner')
    const email = screen.getByLabelText('Email')
    expect(email).toBeDisabled()
    expect(email).toHaveValue('rae@example.com')
    expect(email).toHaveAccessibleDescription(
      'Email is locked. Contact support if you need to change it.'
    )
    expect(screen.getByRole('link', { name: 'support' })).toHaveAttribute(
      'href',
      '/support'
    )
    expect(screen.getByLabelText('Job title')).toHaveValue('Founder')
    expect(screen.getByLabelText('Phone')).toHaveAttribute('type', 'tel')
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeVisible()
  })

  it('links a field error to its field', async () => {
    actions.updateAccount.mockResolvedValueOnce({
      status: 'error',
      fieldErrors: { phone: 'Use digits, spaces and + ( ) - only.' }
    })
    render(
      <AccountForm name="Rae" email="rae@example.com" jobTitle="" phone="" />
    )
    await userEvent.type(screen.getByLabelText('Phone'), 'call me')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    const phone = await screen.findByLabelText('Phone')
    await screen.findByText('Use digits, spaces and + ( ) - only.')
    expect(phone).toHaveAttribute('aria-invalid', 'true')
    expect(phone).toHaveAccessibleDescription(
      'Use digits, spaces and + ( ) - only.'
    )
    // What the owner typed is kept after an error.
    expect(phone).toHaveValue('call me')
  })
})

describe('PasswordForm', () => {
  it('has the three password fields and inline errors', async () => {
    actions.changePassword.mockResolvedValueOnce({
      status: 'error',
      fieldErrors: {
        current: 'That is not your current password.',
        confirm: 'The new passwords do not match.'
      }
    })
    render(<PasswordForm />)
    expect(
      screen.getByText(
        "At least 8 characters. We'll verify your current password first."
      )
    ).toBeVisible()
    for (const label of [
      'Current password',
      'New password',
      'Confirm new password'
    ])
      expect(screen.getByLabelText(label)).toHaveAttribute('type', 'password')
    await userEvent.type(screen.getByLabelText('Current password'), 'wrong-one')
    await userEvent.type(
      screen.getByLabelText('New password'),
      'new-password-1'
    )
    await userEvent.type(
      screen.getByLabelText('Confirm new password'),
      'new-password-2'
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Update password' })
    )
    expect(
      await screen.findByLabelText('Current password')
    ).toHaveAccessibleDescription('That is not your current password.')
    expect(
      screen.getByLabelText('Confirm new password')
    ).toHaveAccessibleDescription('The new passwords do not match.')
  })
})
