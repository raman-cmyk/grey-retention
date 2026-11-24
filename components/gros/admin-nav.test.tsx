import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/features/auth/presentation/actions', () => ({
  signOut: vi.fn(async () => undefined)
}))
import { AdminBar, AdminLoadingPage, AdminPage } from './admin-nav'

afterEach(cleanup)

describe('the admin top bar (UI-ADM)', () => {
  it('has the four admin areas, the current one marked, and no Ask GROS or Settings', () => {
    render(<AdminBar current="inbox" title="Inspiration inbox" />)
    expect(
      screen.getByRole('heading', { level: 1, name: 'Inspiration inbox' })
    ).toBeInTheDocument()
    const menu = within(screen.getByRole('navigation', { name: 'Main' }))
    expect(
      menu
        .getAllByRole('link')
        .map((l) => [l.textContent, l.getAttribute('href')])
    ).toEqual([
      ['Dashboard', '/admin/dashboard'],
      ['Clients', '/admin/clients'],
      ['Inbox', '/admin/inbox'],
      ['Operations', '/admin/operations']
    ])
    const here = menu.getByRole('link', { name: 'Inbox' })
    expect(here).toHaveAttribute('aria-current', 'page')
    expect(here.className).toContain('bg-[var(--lime)]')
    expect(menu.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute(
      'aria-current'
    )
    expect(screen.queryByRole('link', { name: /^Ask / })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull()
    // Not a member of any workspace: no way to one.
    expect(screen.queryByRole('link', { name: 'Open workspace' })).toBeNull()
    const logOut = screen.getByRole('button', { name: 'Log out' })
    expect(logOut).toHaveAttribute('type', 'submit')
    expect(logOut.closest('form')).not.toBeNull()
  })

  it('opens the workspace when the admin is also a member', () => {
    render(<AdminBar current="dashboard" title="Platform operations" member />)
    expect(
      screen.getByRole('link', { name: 'Open workspace' })
    ).toHaveAttribute('href', '/home')
  })

  it('wraps a page in the GROS tokens with the skip link and one main', () => {
    const { container } = render(
      <AdminPage current="operations" title="Operations">
        <p>Cards</p>
      </AdminPage>
    )
    expect(container.firstElementChild).toHaveClass('gros', 'urbanist-variable')
    expect(screen.getByRole('main')).toHaveTextContent('Cards')
    expect(screen.getAllByRole('link')[0]).toHaveTextContent('Skip to content')
    expect(container.querySelectorAll('main')).toHaveLength(1)
  })

  it('draws the bar and what opens while loading, with no main', () => {
    const { container } = render(
      <AdminLoadingPage
        current="operations"
        title="Operations"
        words="Opening Operations"
      />
    )
    expect(screen.getByText('Opening Operations')).toHaveAttribute(
      'aria-live',
      'polite'
    )
    expect(container.querySelector('main')).toBeNull()
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(
      within(screen.getByRole('navigation', { name: 'Main' })).getByRole(
        'link',
        { name: 'Operations' }
      )
    ).toHaveAttribute('aria-current', 'page')
  })
})
