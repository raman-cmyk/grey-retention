import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClientNavigation } from './nav-data'
import { parseShellState, shellCookieName } from './shell-state'
import { ShellFrame } from './sidebar'

const { location } = vi.hoisted(() => ({
  location: { pathname: '/dashboard' }
}))
vi.mock('next/navigation', () => ({ usePathname: () => location.pathname }))
vi.mock('@/features/auth/presentation/actions', () => ({
  signOut: async () => undefined
}))

const identity = {
  name: 'Rae Owner',
  initials: 'RO',
  email: 'rae@northwind.example',
  role: 'owner'
}

function shell(initialState = { collapsed: false, groups: {} }) {
  return render(
    <ShellFrame
      navigation={createClientNavigation('GROS')}
      contextLabel="Client workspace"
      workspaceName="Northwind Coffee"
      identity={identity}
      demo={false}
      initialState={initialState}
    >
      <h1>Page content</h1>
    </ShellFrame>
  )
}

function cookieState() {
  const raw = document.cookie
    .split('; ')
    .find((part) => part.startsWith(`${shellCookieName}=`))
    ?.slice(shellCookieName.length + 1)
  return parseShellState(raw)
}

const desktopNav = () =>
  screen.getByRole('navigation', { name: 'Client workspace navigation' })

beforeEach(() => {
  location.pathname = '/dashboard'
  document.cookie = `${shellCookieName}=; max-age=0; path=/`
})
afterEach(cleanup)

describe('sidebar (expanded)', () => {
  it('shows the workspace block and the six main pages in order', () => {
    shell()
    const top = screen.getByTestId('shell-workspace')
    expect(within(top).getByText('Northwind Coffee')).toBeInTheDocument()
    expect(within(top).getByText('Rae Owner')).toBeInTheDocument()
    expect(within(top).getByText('N')).toBeInTheDocument()
    expect(
      within(top).getByRole('button', { name: 'Toggle sidebar' })
    ).toHaveAttribute('aria-expanded', 'true')
    const labels = within(desktopNav())
      .getAllByRole('link')
      .slice(0, 6)
      .map((link) => link.textContent)
    expect(labels).toEqual([
      'Dashboard',
      'Brand & Store',
      'Campaigns',
      'Ask GROS',
      'Inspiration',
      'Support'
    ])
    expect(
      within(desktopNav()).getByRole('link', { name: 'Dashboard' })
    ).toHaveAttribute('aria-current', 'page')
  })

  it('lists the Agents as disabled SOON items that are not links', async () => {
    shell()
    const agents = within(desktopNav()).getByRole('button', { name: 'Agents' })
    expect(agents).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(agents)
    expect(agents).toHaveAttribute('aria-expanded', 'true')
    for (const label of [
      'List Health',
      'Bill Optimizer',
      'Flow Audit',
      'Deliverability',
      'A/B Test Monitor'
    ]) {
      const item = within(desktopNav())
        .getByText(label)
        .closest('[aria-disabled]')!
      expect(item).toHaveAttribute('aria-disabled', 'true')
      expect(item.tagName).not.toBe('A')
      expect(item).toHaveTextContent(`${label} — Coming soon`)
      expect(within(item as HTMLElement).getByText('Soon')).toHaveAttribute(
        'aria-hidden'
      )
    }
  })

  it('opens Workspace by default and remembers group choices', async () => {
    shell()
    const nav = within(desktopNav())
    expect(nav.getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'href',
      '/settings'
    )
    expect(
      nav.getByRole('link', { name: 'Holidays & Events' })
    ).toBeInTheDocument()
    expect(nav.getByRole('link', { name: 'Connections' })).toHaveAttribute(
      'href',
      '/connections'
    )
    expect(nav.getByRole('link', { name: 'Team' })).toHaveAttribute(
      'href',
      '/team'
    )
    expect(
      nav.getByText('Request a Feature').closest('[aria-disabled]')
    ).toHaveTextContent('Request a Feature — Coming soon')
    await userEvent.click(nav.getByRole('button', { name: 'Workspace' }))
    expect(cookieState().groups.workspace).toBe(false)
    await userEvent.click(nav.getByRole('button', { name: 'Agents' }))
    expect(cookieState().groups.agents).toBe(true)
  })

  it.each([
    ['/lists/abc', 'Dashboard'],
    ['/segments/abc', 'Dashboard'],
    ['/flows/abc', 'Dashboard'],
    ['/flow-messages/abc', 'Dashboard'],
    ['/metrics/abc', 'Dashboard'],
    ['/campaign-drafts', 'Campaigns'],
    ['/campaign-drafts/new', 'Campaigns'],
    ['/campaigns/abc', 'Campaigns'],
    ['/gros/thread-1', 'Ask GROS']
  ])('highlights the parent area on %s', (pathname, label) => {
    location.pathname = pathname
    shell()
    const current = within(desktopNav())
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page')
    expect(current.map((link) => link.textContent)).toEqual([label])
  })

  it('marks only the first entry for a shared page as current', () => {
    location.pathname = '/settings'
    shell()
    const nav = within(desktopNav())
    expect(nav.getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(
      nav.getByRole('link', { name: 'Holidays & Events' })
    ).not.toHaveAttribute('aria-current')
  })
})

describe('sidebar (collapsed)', () => {
  it('collapses to an icon rail with labelled icons and remembers it', async () => {
    shell()
    await userEvent.click(
      screen.getByRole('button', { name: 'Toggle sidebar' })
    )
    expect(cookieState().collapsed).toBe(true)
    const nav = within(desktopNav())
    const dashboard = nav.getByRole('link', { name: 'Dashboard' })
    expect(dashboard).toHaveAttribute('aria-current', 'page')
    expect(dashboard).toHaveTextContent('')
    expect(screen.queryByTestId('rail-tooltip')).not.toBeInTheDocument()
    await userEvent.hover(dashboard)
    expect(screen.getByTestId('rail-tooltip')).toHaveTextContent('Dashboard')
    await userEvent.unhover(dashboard)
    expect(screen.queryByTestId('rail-tooltip')).not.toBeInTheDocument()
    const expand = screen.getByRole('button', { name: 'Toggle sidebar' })
    expect(expand).toHaveAttribute('aria-expanded', 'false')
    act(() => {
      expand.blur()
      expand.focus()
    })
    expect(screen.getByTestId('rail-tooltip')).toHaveTextContent(
      'Expand sidebar'
    )
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByTestId('rail-tooltip')).not.toBeInTheDocument()
  })

  it('renders collapsed from the saved state and expands to a group', async () => {
    shell({ collapsed: true, groups: {} })
    const nav = within(desktopNav())
    expect(nav.queryByText('List Health')).not.toBeInTheDocument()
    await userEvent.click(
      nav.getByRole('button', { name: 'Agents: expand the sidebar' })
    )
    expect(cookieState()).toEqual({
      collapsed: false,
      groups: { agents: true }
    })
  })
})

describe('account menu', () => {
  it('opens upward with profile and log out, and closes on Esc', async () => {
    shell()
    const trigger = screen.getAllByRole('button', {
      name: 'Open account menu for Rae Owner'
    })[0]
    await userEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    const menu = document.getElementById(
      trigger.getAttribute('aria-controls')!
    )!
    expect(within(menu).getByText('rae@northwind.example')).toBeInTheDocument()
    expect(
      within(menu).getByText('Profile Update').closest('[aria-disabled]')
    ).toHaveAttribute('aria-disabled', 'true')
    // Connections is already in Workspace (OWNER_JOURNEYS.md §18.18).
    expect(within(menu).queryByRole('link')).not.toBeInTheDocument()
    expect(
      within(menu).getByRole('button', { name: 'Log out' })
    ).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveFocus()
  })

  it('closes on an outside click', async () => {
    shell()
    const trigger = screen.getAllByRole('button', {
      name: 'Open account menu for Rae Owner'
    })[0]
    await userEvent.click(trigger)
    await userEvent.click(screen.getByRole('heading', { name: 'Page content' }))
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('small screens', () => {
  it('offers a labelled drawer with the same navigation', () => {
    shell()
    expect(
      screen.getByRole('button', { name: 'Open navigation' })
    ).toHaveAttribute('aria-controls')
    const drawer = document.querySelector('dialog')!
    expect(drawer).toHaveAttribute(
      'aria-label',
      'Client workspace navigation menu'
    )
    expect(
      drawer.querySelector(
        'nav[aria-label="Client workspace mobile navigation"]'
      )
    ).not.toBeNull()
  })
})
