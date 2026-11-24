import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import AppError from '@/app/error'
import AppNotFound from '@/app/not-found'
import AuthError from './error'
import AuthLoading from './loading'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('sign-in screens and the app-wide pages (UI-AUTH)', () => {
  it('opens on the focused shell, busy, with no main', () => {
    const { container } = render(<AuthLoading />)
    expect(
      screen.getByRole('complementary', { name: 'Where you are' })
    ).toBeVisible()
    expect(screen.getByText('Opening')).toBeInTheDocument()
    expect(container.querySelector('main')).toBeNull()
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
  })

  it('says a sign-in screen did not open, with Try again', async () => {
    const retry = vi.fn()
    render(<AuthError retry={retry} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Page did not open')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalledOnce()
  })

  it('answers an unknown address with the GROS empty state and one button', () => {
    const { container } = render(<AppNotFound />)
    expect(container.firstElementChild?.className).toContain('gros')
    expect(
      screen.getByRole('heading', { name: 'Page not found' })
    ).toBeVisible()
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'Back to Home' })).toHaveAttribute(
      'href',
      '/home'
    )
  })

  it('says a page did not open, that saved work is safe, and retries', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const retry = vi.fn()
    const { container } = render(
      <AppError error={new Error('boom')} retry={retry} />
    )
    expect(container.firstElementChild?.className).toContain('gros')
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Page did not openWe could not open this page just now. What you saved is safe.'
    )
    expect(screen.queryByText('boom')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalledOnce()
  })
})
