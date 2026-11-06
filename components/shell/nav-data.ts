import type { Route } from 'next'

export type NavigationIcon =
  | 'start'
  | 'admin-overview'
  | 'agents'
  | 'assignments'
  | 'ab-test'
  | 'bill'
  | 'brand'
  | 'assets'
  | 'copy'
  | 'campaigns'
  | 'clients'
  | 'connections'
  | 'dashboard'
  | 'deliverability'
  | 'feedback'
  | 'designers'
  | 'flow-audit'
  | 'gros'
  | 'help'
  | 'holidays'
  | 'inspirations'
  | 'list-health'
  | 'more'
  | 'operations'
  | 'overview'
  | 'prompts'
  | 'reports'
  | 'settings'
  | 'support'
  | 'team'
  | 'templates'
  | 'workspace'

/** A page in the sidebar. */
export type NavigationItem = {
  label: string
  href: Route
  icon: NavigationIcon
}

/** A planned item: shown greyed with a SOON pill, never clickable. */
export type NavigationSoon = {
  label: string
  icon: NavigationIcon
  soon: true
}

export type NavigationGroup = {
  id: string
  label: string
  icon: NavigationIcon
  items: (NavigationItem | NavigationSoon)[]
  /** Open on a first visit; afterwards the owner's choice is remembered. */
  defaultOpen?: boolean
}

export type ShellNavigation = {
  primary: NavigationItem[]
  groups: NavigationGroup[]
}

export function isSoon(
  item: NavigationItem | NavigationSoon
): item is NavigationSoon {
  return 'soon' in item
}

/** Every link in the navigation, for tests and current-page checks. */
export function navigationLinks(navigation: ShellNavigation) {
  return [
    ...navigation.primary,
    ...navigation.groups.flatMap((group) =>
      group.items.filter((item): item is NavigationItem => !isSoon(item))
    )
  ]
}

/**
 * Brand-owner sidebar: layout from docs/UI_REBUILD_SPEC.md §2, labels and
 * items from docs/OWNER_JOURNEYS.md §2 and §18 (which win where they differ):
 * "Campaigns" and "Inspiration" instead of "… Agent", Team and Request a
 * Feature in Workspace. "More tools" holds pages the old app did not have;
 * they move into the rebuilt screens as those land (copy review into §7).
 */
export function createClientNavigation(assistantName: string): ShellNavigation {
  return {
    primary: [
      { label: 'Dashboard', href: '/dashboard', icon: 'dashboard' },
      { label: 'Brand & Store', href: '/brand', icon: 'brand' },
      { label: 'Campaigns', href: '/campaign-agent', icon: 'campaigns' },
      { label: `Ask ${assistantName}`, href: '/gros', icon: 'gros' },
      { label: 'Inspiration', href: '/competitor-agent', icon: 'inspirations' },
      { label: 'Support', href: '/support', icon: 'support' }
    ],
    groups: [
      {
        id: 'agents',
        label: 'Agents',
        icon: 'agents',
        items: [
          { label: 'List Health', icon: 'list-health', soon: true },
          // A fixture-backed optimizer page exists, so this one is a link.
          { label: 'Bill Optimizer', href: '/optimizer', icon: 'bill' },
          { label: 'Flow Audit', icon: 'flow-audit', soon: true },
          { label: 'Deliverability', icon: 'deliverability', soon: true },
          { label: 'A/B Test Monitor', icon: 'ab-test', soon: true }
        ]
      },
      {
        id: 'workspace',
        label: 'Workspace',
        icon: 'workspace',
        defaultOpen: true,
        items: [
          { label: 'Settings', href: '/settings', icon: 'settings' },
          // Holidays live on Settings until /holidays is built (§12).
          {
            label: 'Holidays & Events',
            href: '/settings#holidays',
            icon: 'holidays'
          },
          { label: 'Connections', href: '/connections', icon: 'connections' },
          { label: 'Team', href: '/team', icon: 'team' },
          // /feedback is built by the other lane (OWNER_JOURNEYS.md §15).
          { label: 'Request a Feature', icon: 'feedback', soon: true }
        ]
      },
      {
        id: 'more',
        label: 'More tools',
        icon: 'more',
        items: [
          { label: 'Get started', href: '/get-started', icon: 'start' },
          {
            label: 'Templates & references',
            href: '/email-library',
            icon: 'templates'
          },
          { label: 'Copy review', href: '/copy-review', icon: 'copy' },
          { label: 'Assets', href: '/assets', icon: 'assets' },
          { label: 'Results & learning', href: '/reports', icon: 'reports' }
        ]
      }
    ]
  }
}

export const adminNavigation: ShellNavigation = {
  primary: [
    { label: 'Overview', href: '/admin/dashboard', icon: 'admin-overview' },
    { label: 'Clients', href: '/admin/clients', icon: 'clients' },
    { label: 'Designers', href: '/admin/designers', icon: 'designers' },
    { label: 'Prompt engine', href: '/admin/prompts', icon: 'prompts' },
    { label: 'Templates', href: '/admin/templates', icon: 'templates' },
    { label: 'Operations', href: '/admin/operations', icon: 'operations' }
  ],
  groups: []
}

export const designerNavigation: ShellNavigation = {
  primary: [
    { label: 'Assignments', href: '/designer/dashboard', icon: 'assignments' },
    { label: 'Help', href: '/designer/help', icon: 'help' }
  ],
  groups: []
}

// Child pages highlight their parent area (OWNER_JOURNEYS.md §2 fix).
const parentAreas: Record<string, readonly string[]> = {
  // Klaviyo detail pages belong to the dashboard.
  '/dashboard': [
    '/campaigns/klaviyo',
    '/lists',
    '/segments',
    '/flows',
    '/flow-messages',
    '/metrics'
  ],
  // `/campaigns/:id` is this workspace's own campaign page, so it belongs to
  // Campaigns; Klaviyo campaigns live under `/campaigns/klaviyo/:id`.
  '/campaign-agent': ['/campaigns', '/campaign-drafts', '/calendar']
}

function under(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function isCurrentPath(pathname: string, href: string) {
  return (
    under(pathname, href) ||
    (parentAreas[href] ?? []).some((child) => under(pathname, child))
  )
}

/**
 * The nav item for `pathname`: the most specific match wins, whatever the
 * nav order (so /campaigns/klaviyo/… is Dashboard, /campaigns/… Campaigns).
 */
export function currentNavigationHref(
  navigation: ShellNavigation,
  pathname: string
) {
  let best: { href: string; length: number } | null = null
  for (const item of navigationLinks(navigation)) {
    const base = item.href.split(/[?#]/)[0]
    const candidates = [base, ...(parentAreas[base] ?? [])]
    for (const candidate of candidates)
      if (
        under(pathname, candidate) &&
        (!best || candidate.length > best.length)
      )
        best = { href: item.href, length: candidate.length }
  }
  return best?.href ?? null
}
