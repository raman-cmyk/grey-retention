import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TextLink } from './text-link'

afterEach(cleanup)

describe('TextLink', () => {
  it('reads as plain link text while showing a decorative arrow', () => {
    render(<TextLink href="/email-library">View all captures</TextLink>)
    const link = screen.getByRole('link', { name: 'View all captures' })
    expect(link).toHaveAttribute('href', '/email-library')
    expect(link).toHaveTextContent('View all captures→')
  })

  it('can drop the arrow', () => {
    render(
      <TextLink href="/settings" arrow={false}>
        Settings
      </TextLink>
    )
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveTextContent(
      /^Settings$/
    )
  })
})
