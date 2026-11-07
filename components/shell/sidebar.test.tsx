import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest'
import { installDialogPolyfill } from '@/tests/helpers/dialog-polyfill'
import {
  adminNavigation,
  createClientNavigation,
  designerNavigation,
  type ShellNavigation
} from './nav-data'
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

function shell(
  initialState = { collapsed: false, groups: {} },
  {
    navigation = createClientNavigation('GROS'),
    contextLabel = 'Client workspace',
    demo = null as { label: string; description: string } | null
  }: {
    navigation?: ShellNavigation
    contextLabel?: string
    demo?: { label: string; description: string } | null
  } = {}
) {
  return render(
    <ShellFrame
      navigation={navigation}
      contextLabel={contextLabel}
      workspaceName="Northwind Coffee"
      identity={identity}
      demo={demo}
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

beforeAll(installDialogPolyfill)
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

  it('lists the unbuilt Agents as SOON items that are not links', async () => {
    shell()
    const agents = within(desktopNav()).getByRole('button', { name: 'Agents' })
    expect(agents).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(agents)
    expect(agents).toHaveAttribute('aria-expanded', 'true')
    for (const label of [
      'List Health',
      'Flow Audit',
      'Deliverability',
      'A/B Test Monitor'
    ]) {
      const item = within(desktopNav()).getByText(label).closest('[data-soon]')!
      expect(item.tagName).not.toBe('A')
      expect(item.closest('a')).toBeNull()
      expect(item).toHaveTextContent(`${label} — Coming soon`)
      expect(within(item as HTMLElement).getByText('Soon')).toHaveAttribute(
        'aria-hidden'
      )
    }
    // The fixture optimizer page exists, so Bill Optimizer is a real link.
    expect(
      within(desktopNav()).getByRole('link', { name: 'Bill Optimizer' })
    ).toHaveAttribute('href', '/optimizer')
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
    ).toHaveAttribute('href', '/settings#holidays')
    expect(nav.getByRole('link', { name: 'Connections' })).toHaveAttribute(
      'href',
      '/connections'
    )
    expect(nav.getByRole('link', { name: 'Team' })).toHaveAttribute(
      'href',
      '/team'
    )
    expect(
      nav.getByText('Request a Feature').closest('[data-soon]')
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
    ['/campaigns/klaviyo/CMPspr001', 'Dashboard'],
    ['/gros/thread-1', 'Ask GROS']
  ])('highlights the parent area on %s', (pathname, label) => {
    location.pathname = pathname
    shell()
    const current = within(desktopNav())
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page')
    expect(current.map((link) => link.textContent)).toEqual([label])
  })

  it('keeps Assignments current on an open designer brief', () => {
    location.pathname = '/designer/assignments/abc'
    shell(undefined, {
      navigation: designerNavigation,
      contextLabel: 'Designer workspace'
    })
    const current = within(
      screen.getByRole('navigation', {
        name: 'Designer workspace navigation'
      })
    )
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page')
    expect(current.map((link) => link.textContent)).toEqual(['Assignments'])
  })

  it('opens a closed group that holds the current page, without saving it', async () => {
    location.pathname = '/assets'
    shell()
    const nav = within(desktopNav())
    const more = nav.getByRole('button', { name: 'More tools' })
    expect(more).toHaveAttribute('aria-expanded', 'true')
    expect(nav.getByRole('link', { name: 'Assets' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(cookieState().groups.more).toBeUndefined()
    // The owner can still close it on this page.
    await userEvent.click(more)
    expect(more).toHaveAttribute('aria-expanded', 'false')
    expect(cookieState().groups.more).toBe(false)
  })

  it('shows the demo label to screen readers and on hover', () => {
    shell(undefined, {
      demo: { label: 'Demo workspace', description: 'Synthetic data only' }
    })
    const top = screen.getByTestId('shell-workspace')
    expect(top).toHaveTextContent('Demo workspace: Synthetic data only')
    expect(within(top).getByText('Demo')).toHaveAttribute('aria-hidden')
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

  it('keeps keyboard focus on the group after the rail expands', async () => {
    shell({ collapsed: true, groups: {} })
    within(desktopNav())
      .getByRole('button', { name: 'Agents: expand the sidebar' })
      .focus()
    await userEvent.keyboard('{Enter}')
    const agents = within(desktopNav()).getByRole('button', { name: 'Agents' })
    expect(agents).toHaveFocus()
    expect(agents).toHaveAttribute('aria-expanded', 'true')
  })

  it('marks the rail group that holds the current page', () => {
    location.pathname = '/settings'
    shell({ collapsed: true, groups: {} })
    const workspace = within(desktopNav()).getByRole('button', {
      name: 'Workspace (current section): expand the sidebar'
    })
    expect(workspace).toHaveAttribute('data-current')
    expect(
      within(desktopNav()).getByRole('button', {
        name: 'Agents: expand the sidebar'
      })
    ).not.toHaveAttribute('data-current')
  })

  it('points the toggle at the navigation it hides', () => {
    shell()
    const toggle = screen.getByRole('button', { name: 'Toggle sidebar' })
    expect(document.getElementById(toggle.getAttribute('aria-controls')!)).toBe(
      desktopNav()
    )
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
    // Profile is the only link; Connections is already in Workspace
    // (OWNER_JOURNEYS.md §18.18).
    expect(
      within(menu)
        .getAllByRole('link')
        .map((link) => [link.textContent, link.getAttribute('href')])
    ).toEqual([['Profile Update', '/profile']])
    expect(
      within(menu).getByRole('button', { name: 'Log out' })
    ).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveFocus()
  })

  it('lets a keyboard user Tab from the button into the menu, and closes when focus leaves', async () => {
    shell()
    const trigger = screen.getAllByRole('button', {
      name: 'Open account menu for Rae Owner'
    })[0]
    trigger.focus()
    await userEvent.keyboard('{Enter}')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await userEvent.tab()
    expect(screen.getByRole('link', { name: 'Profile Update' })).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Log out' })).toHaveFocus()
    await userEvent.tab()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('closes after following Profile Update', async () => {
    shell()
    const trigger = screen.getAllByRole('button', {
      name: 'Open account menu for Rae Owner'
    })[0]
    await userEvent.click(trigger)
    const profile = screen.getByRole('link', { name: 'Profile Update' })
    profile.addEventListener('click', (event) => event.preventDefault())
    await userEvent.click(profile)
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('has no Profile Update where the surface has no profile page', async () => {
    for (const navigation of [adminNavigation, designerNavigation]) {
      const { unmount } = shell(undefined, { navigation })
      const trigger = screen.getAllByRole('button', {
        name: 'Open account menu for Rae Owner'
      })[0]
      await userEvent.click(trigger)
      const menu = document.getElementById(
        trigger.getAttribute('aria-controls')!
      )!
      expect(within(menu).queryByRole('link')).toBeNull()
      expect(
        within(menu).getByRole('button', { name: 'Log out' })
      ).toBeInTheDocument()
      expect(document.querySelector('dialog a[href="/profile"]')).toBeNull()
      unmount()
    }
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

  it('opens, and closes from the Close button or a link', async () => {
    shell()
    const drawer = document.querySelector('dialog')!
    await userEvent.click(
      screen.getByRole('button', { name: 'Open navigation' })
    )
    expect(drawer).toHaveAttribute('open')
    await userEvent.click(
      within(drawer).getByRole('button', { name: 'Close navigation' })
    )
    expect(drawer).not.toHaveAttribute('open')
    await userEvent.click(
      screen.getByRole('button', { name: 'Open navigation' })
    )
    const support = within(drawer).getByRole('link', { name: 'Support' })
    support.addEventListener('click', (event) => event.preventDefault())
    await userEvent.click(support)
    expect(drawer).not.toHaveAttribute('open')
    await userEvent.click(
      screen.getByRole('button', { name: 'Open navigation' })
    )
    const profile = within(drawer).getByRole('link', {
      name: 'Profile Update'
    })
    profile.addEventListener('click', (event) => event.preventDefault())
    await userEvent.click(profile)
    expect(drawer).not.toHaveAttribute('open')
  })
})

describe('frame', () => {
  it('has a skip link to the main landmark and a bounded content column', () => {
    shell()
    const skip = screen.getByRole('link', { name: 'Skip to content' })
    expect(skip).toHaveAttribute('href', '#main-content')
    const main = screen.getByRole('main')
    expect(main).toHaveAttribute('id', 'main-content')
    expect(main.firstElementChild?.className).toContain(
      'max-w-[var(--gr-content-max)]'
    )
    expect(
      within(main).getByRole('heading', { name: 'Page content' })
    ).toBeInTheDocument()
  })

  it.each([
    ['Admin console', adminNavigation, 'Clients'],
    ['Designer workspace', designerNavigation, 'Assignments']
  ])(
    'renders the %s with its own links and no groups',
    (label, navigation, link) => {
      location.pathname = '/nowhere'
      shell(undefined, { navigation, contextLabel: label })
      const nav = screen.getByRole('navigation', {
        name: `${label} navigation`
      })
      expect(within(nav).getByRole('link', { name: link })).toBeInTheDocument()
      expect(within(nav).queryByRole('button')).not.toBeInTheDocument()
      expect(within(nav).queryByText('Agents')).not.toBeInTheDocument()
    }
  )
})
