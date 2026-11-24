import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AdminDashboard, NotBuiltYet } from './screens'

afterEach(cleanup)

describe('the admin Dashboard (UI-ADM)', () => {
  it('opens the working tools, and the areas not built yet (Prompts and Templates are here, not in the menu)', () => {
    render(<AdminDashboard />)
    const links = (name: string) =>
      within(screen.getByRole('list', { name }))
        .getAllByRole('link')
        .map((l) => [l.textContent, l.getAttribute('href')])
    expect(links('Tools')).toEqual([
      ['Open operations', '/admin/operations'],
      ['Open inbox', '/admin/inbox']
    ])
    expect(links('Not built yet')).toEqual([
      ['Open clients', '/admin/clients'],
      ['Open prompts', '/admin/prompts'],
      ['Open templates', '/admin/templates']
    ])
    // No main (forest) button: every row is a second action.
    for (const link of screen.getAllByRole('link'))
      expect(link.className).not.toContain('bg-[var(--forest)]')
  })
})

describe('a page not built yet', () => {
  it('is a title and one button back to Dashboard', () => {
    render(<NotBuiltYet />)
    expect(
      screen.getByRole('heading', { name: 'Not built yet' })
    ).toBeInTheDocument()
    const back = screen.getByRole('link')
    expect(back).toHaveTextContent('Open dashboard')
    expect(back).toHaveAttribute('href', '/admin/dashboard')
  })
})
