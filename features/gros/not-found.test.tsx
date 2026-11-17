import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import GrosNotFound from '@/app/(gros)/not-found'

afterEach(cleanup)

describe('the GROS not-found page (UI-404)', () => {
  it('keeps the top bar, says the page is not there, and leads back to Home', () => {
    const { container } = render(<GrosNotFound />)
    expect(container.firstElementChild).toHaveClass('gros')
    expect(
      screen.getByRole('heading', { level: 1, name: 'Not found' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 2, name: 'Page not found' })
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to Home' })).toHaveAttribute(
      'href',
      '/home'
    )
    // No menu item is current: the page is none of them.
    for (const link of within(
      screen.getByRole('navigation', { name: 'Main' })
    ).getAllByRole('link'))
      expect(link).not.toHaveAttribute('aria-current')
  })
})
