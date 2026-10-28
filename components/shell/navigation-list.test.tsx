import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NavigationList } from './navigation-list'
import { createClientNavigation, adminNavigation } from './nav-data'
const { location } = vi.hoisted(() => ({
  location: { pathname: '/dashboard' }
}))
vi.mock('next/navigation', () => ({ usePathname: () => location.pathname }))

describe('Simplified navigation', () => {
  it('keeps primary work visible and reveals extra tools on demand', async () => {
    location.pathname = '/dashboard'
    render(
      <NavigationList
        navigation={createClientNavigation('GROS')}
        label="Workspace"
        variant="sidebar"
      />
    )
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(screen.getByRole('link', { name: 'Competitor agent' })).toBeVisible()
    expect(screen.getByText('Manage').closest('details')).not.toHaveAttribute(
      'open'
    )
    await userEvent.click(screen.getByText('Manage'))
    expect(screen.getByText('Manage').closest('details')).toHaveAttribute(
      'open'
    )
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'href',
      '/settings'
    )
  })
  it('opens the current secondary group after navigation and keeps campaign details selected', () => {
    location.pathname = '/settings'
    const { rerender } = render(
      <NavigationList
        navigation={createClientNavigation('GROS')}
        label="Workspace"
        variant="popover"
      />
    )
    expect(screen.getByText('Manage').closest('details')).toHaveAttribute(
      'open'
    )
    location.pathname = '/campaigns/example'
    rerender(
      <NavigationList
        navigation={createClientNavigation('GROS')}
        label="Workspace"
        variant="popover"
      />
    )
    expect(
      screen.getByRole('link', { name: 'Campaign agent' })
    ).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('Manage').closest('details')).not.toHaveAttribute(
      'open'
    )
  })
  it('shows matching advanced pages immediately in search results', () => {
    location.pathname = '/dashboard'
    render(
      <NavigationList
        navigation={createClientNavigation('GROS').filter(
          (item) => item.label === 'Assets'
        )}
        label="Search results"
        variant="popover"
        expandGroups
      />
    )
    expect(screen.getByRole('link', { name: 'Assets' })).toBeVisible()
    expect(document.querySelector('details')).not.toBeInTheDocument()
  })
  it('preserves ungrouped role navigation', () => {
    location.pathname = '/admin/clients'
    render(
      <NavigationList
        navigation={adminNavigation}
        label="Admin"
        variant="sidebar"
      />
    )
    expect(screen.getByRole('link', { name: 'Clients' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(screen.queryByText('More tools')).not.toBeInTheDocument()
  })
})

afterEach(cleanup)
