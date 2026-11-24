import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const actions = vi.hoisted(() => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
  requestPasswordReset: vi.fn(),
  updatePassword: vi.fn()
}))
vi.mock('@/features/auth/presentation/actions', () => actions)

import { FocusShell } from '@/components/gros/steps'
import { PasswordUpdateForm } from './password-update-form'
import { ResetRequestForm } from './reset-request-form'
import { SignInPanel } from './sign-in-panel'
import { SignupForm } from './signup-form'

beforeEach(() => {
  for (const action of Object.values(actions)) action.mockReset()
})
afterEach(cleanup)

describe('Sign in (UI-AUTH)', () => {
  it('is one title, two labelled fields and Sign in on the GROS focused shell', () => {
    render(
      <FocusShell>
        <SignInPanel title="Welcome back" surface="client" next="/plan" />
      </FocusShell>
    )
    expect(
      screen.getByRole('heading', { level: 1, name: 'Welcome back' })
    ).toBeVisible()
    expect(
      screen.getByRole('complementary', { name: 'Where you are' })
    ).toBeVisible()
    const email = screen.getByLabelText('Email')
    expect(email).toHaveAttribute('type', 'email')
    expect(email).toHaveAttribute('autocomplete', 'email')
    expect(email.className).toContain('gros-input')
    expect(screen.getByLabelText('Password')).toHaveAttribute(
      'type',
      'password'
    )
    expect(screen.getByRole('button', { name: 'Sign in' })).toHaveAttribute(
      'type',
      'submit'
    )
    expect(
      screen.getByRole('link', { name: 'Reset password' })
    ).toHaveAttribute('href', '/forgot-password')
    // The old card's subtitle is gone (BRAND.md rule 16).
    expect(document.querySelector('main p')).toBeNull()
    expect(
      document.querySelector('input[type="hidden"][name="next"]')
    ).toHaveValue('/plan')
  })

  it('sends the surface, shows field errors under their field and the answer under the button', async () => {
    actions.signIn
      .mockResolvedValueOnce({
        status: 'error',
        fieldErrors: { email: ['Enter a valid email.'] }
      })
      .mockResolvedValueOnce({
        status: 'error',
        message: 'Email or password is incorrect.'
      })
    const user = userEvent.setup()
    render(<SignInPanel title="Admin sign in" surface="admin" />)
    await user.type(screen.getByLabelText('Email'), 'owner@cedarlane.example')
    await user.type(screen.getByLabelText('Password'), 'not-it')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    const email = await screen.findByLabelText('Email')
    await waitFor(() => expect(email).toHaveAttribute('aria-invalid', 'true'))
    expect(email).toHaveAccessibleDescription('Enter a valid email.')
    expect(actions.signIn.mock.calls[0][0]).toBe('admin')
    await user.clear(screen.getByLabelText('Email'))
    await user.clear(screen.getByLabelText('Password'))
    await user.type(screen.getByLabelText('Email'), 'owner@cedarlane.example')
    await user.type(screen.getByLabelText('Password'), 'not-it')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Email or password is incorrect.'
    )
    expect(screen.getByRole('status').className).toContain('signal-ink')
  })
})

describe('Account forms (UI-AUTH)', () => {
  it('signs up with name, work email and password, and says what happens next', async () => {
    actions.signUp.mockResolvedValueOnce({
      status: 'success',
      message: 'Account created. Check your email to confirm access.'
    })
    const user = userEvent.setup()
    render(<SignupForm />)
    await user.type(screen.getByLabelText('Name'), 'Sam Cedar')
    await user.type(
      screen.getByLabelText('Work email'),
      'sam@cedarlane.example'
    )
    await user.type(screen.getByLabelText('Password'), 'a-long-password')
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Check your email to confirm access.'
    )
    const form = actions.signUp.mock.calls[0][1] as FormData
    expect(form.get('email')).toBe('sam@cedarlane.example')
  })

  it('asks for a reset link by email', async () => {
    actions.requestPasswordReset.mockResolvedValueOnce({
      status: 'success',
      message: 'If the account exists, a reset link is on its way.'
    })
    const user = userEvent.setup()
    render(<ResetRequestForm />)
    await user.type(screen.getByLabelText('Email'), 'sam@cedarlane.example')
    await user.click(screen.getByRole('button', { name: 'Send reset link' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'a reset link is on its way'
    )
  })

  it('sets a new password with its confirmation', async () => {
    actions.updatePassword.mockResolvedValueOnce({
      status: 'error',
      message: 'Passwords do not match.'
    })
    const user = userEvent.setup()
    render(<PasswordUpdateForm />)
    for (const label of ['New password', 'Confirm password'])
      expect(screen.getByLabelText(label)).toHaveAttribute('minlength', '12')
    await user.type(screen.getByLabelText('New password'), 'twelve-chars-1')
    await user.type(screen.getByLabelText('Confirm password'), 'twelve-chars-2')
    await user.click(screen.getByRole('button', { name: 'Update password' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Passwords do not match.'
    )
    const form = actions.updatePassword.mock.calls[0][1] as FormData
    expect(form.get('confirmation')).toBe('twelve-chars-2')
  })
})
