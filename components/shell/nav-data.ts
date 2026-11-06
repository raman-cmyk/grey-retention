import type { Route } from 'next'

export type NavigationIcon =
  | 'start'
  | 'admin-overview'
  | 'assignments'
  | 'brand'
  | 'assets'
  | 'copy'
  | 'campaigns'
  | 'clients'
  | 'connections'
  | 'designers'
  | 'gros'
  | 'help'
  | 'inspirations'
  | 'operations'
  | 'overview'
  | 'prompts'
  | 'settings'
  | 'support'
  | 'team'
  | 'templates'

export type NavigationItem = {
  label: string
  href: Route
  icon: NavigationIcon
  group?: string
  collapsible?: boolean
}

export function createClientNavigation(
  assistantName: string
): NavigationItem[] {
  return [
    {
      label: 'Get started',
      href: '/get-started',
      icon: 'start',
      group: 'Workspace'
    },
    {
      label: 'Overview',
      href: '/dashboard',
      icon: 'overview',
      group: 'Workspace'
    },
    {
      label: 'Competitor agent',
      href: '/competitor-agent',
      icon: 'inspirations',
      group: 'Workspace'
    },
    {
      label: 'Templates & references',
      href: '/email-library',
      icon: 'templates',
      group: 'Workspace'
    },
    {
      label: 'Campaign agent',
      href: '/campaign-agent',
      icon: 'campaigns',
      group: 'Workspace'
    },
    {
      label: `Ask ${assistantName}`,
      href: '/gros',
      icon: 'gros',
      group: 'Workspace'
    },
    {
      label: 'Copy review',
      href: '/copy-review',
      icon: 'copy',
      group: 'More tools',
      collapsible: true
    },
    {
      label: 'Brand & store',
      href: '/brand',
      icon: 'brand',
      group: 'More tools',
      collapsible: true
    },
    {
      label: 'Assets',
      href: '/assets',
      icon: 'assets',
      group: 'More tools',
      collapsible: true
    },
    {
      label: 'Results & learning',
      href: '/reports',
      icon: 'admin-overview',
      group: 'More tools',
      collapsible: true
    },
    {
      label: 'Bill optimizer',
      href: '/optimizer',
      icon: 'operations',
      group: 'More tools',
      collapsible: true
    },
    {
      label: 'Connections',
      href: '/connections',
      icon: 'connections',
      group: 'Manage',
      collapsible: true
    },
    {
      label: 'Team',
      href: '/team',
      icon: 'team',
      group: 'Manage',
      collapsible: true
    },
    {
      label: 'Support',
      href: '/support',
      icon: 'support',
      group: 'Manage',
      collapsible: true
    },
    {
      label: 'Settings',
      href: '/settings',
      icon: 'settings',
      group: 'Manage',
      collapsible: true
    }
  ]
}

export const adminNavigation: NavigationItem[] = [
  { label: 'Overview', href: '/admin/dashboard', icon: 'admin-overview' },
  { label: 'Clients', href: '/admin/clients', icon: 'clients' },
  { label: 'Designers', href: '/admin/designers', icon: 'designers' },
  { label: 'Prompt engine', href: '/admin/prompts', icon: 'prompts' },
  { label: 'Templates', href: '/admin/templates', icon: 'templates' },
  { label: 'Operations', href: '/admin/operations', icon: 'operations' }
]

export const designerNavigation: NavigationItem[] = [
  { label: 'Assignments', href: '/designer/dashboard', icon: 'assignments' },
  { label: 'Help', href: '/designer/help', icon: 'help' }
]
