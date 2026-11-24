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
  | 'campaigns'
  | 'plan'
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
  /** The account menu's "Profile Update" page; omitted where none exists. */
  profileHref?: Route
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
 * they move into the rebuilt screens as those land. The weekly copy review
 * is retired (D17, RET-002).
 */
export function createClientNavigation(assistantName: string): ShellNavigation {
  return {
    profileHref: '/profile',
    primary: [
      { label: 'Home', href: '/home', icon: 'dashboard' },
      { label: 'Brand & Store', href: '/brand', icon: 'brand' },
      { label: 'Plan next 15 days', href: '/plan', icon: 'plan' },
      { label: 'Campaigns', href: '/campaign-agent', icon: 'campaigns' },
      { label: `Ask ${assistantName}`, href: '/gros', icon: 'gros' },
      {
        label: 'Inspiration',
        href: '/inspiration',
        icon: 'inspirations'
      }
      // UI-SETd: support is a card on Settings (Workspace, below).
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
          { label: 'Connections', href: '/connections', icon: 'connections' }
        ]
      },
      {
        id: 'more',
        label: 'More tools',
        icon: 'more',
        items: [
          { label: 'Get started', href: '/setup', icon: 'start' },
          {
            label: 'Templates & references',
            href: '/email-library',
            icon: 'templates'
          },
          { label: 'Assets', href: '/assets', icon: 'assets' },
          { label: 'Results & learning', href: '/reports', icon: 'reports' }
        ]
      }
    ]
  }
}

// The admin pages draw the GROS admin bar (components/gros/admin-nav.tsx,
// UI-ADM); they no longer use this sidebar.

export const designerNavigation: ShellNavigation = {
  primary: [
    { label: 'Assignments', href: '/designer/dashboard', icon: 'assignments' },
    { label: 'Help', href: '/designer/help', icon: 'help' }
  ],
  groups: []
}

// Child pages highlight their parent area (OWNER_JOURNEYS.md §2 fix).
const parentAreas: Record<string, readonly string[]> = {
  // Klaviyo detail pages belong to Home (until Results); segments and lists
  // are GROS pages under Audiences (UI-AUDc).
  '/home': ['/campaigns/klaviyo', '/flows', '/flow-messages', '/metrics'],
  // `/campaigns/:id` is this workspace's own campaign page, so it belongs to
  // Campaigns; Klaviyo campaigns live under `/campaigns/klaviyo/:id`.
  '/campaign-agent': ['/campaigns', '/campaign-drafts', '/calendar'],
  // The older competitor pages are part of Inspiration (UIR-009).
  '/inspiration': ['/competitor-agent'],
  // An open brief belongs to the designer's Assignments desk.
  '/designer/dashboard': ['/designer/assignments']
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
