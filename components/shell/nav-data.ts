import type { Route } from 'next'

export type NavigationIcon =
  | 'admin-overview'
  | 'assignments'
  | 'brand'
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
}

export function createClientNavigation(
  assistantName: string
): NavigationItem[] {
  return [
    { label: 'Overview', href: '/dashboard', icon: 'overview' },
    { label: 'Brand & store', href: '/brand', icon: 'brand' },
    { label: 'Campaign agent', href: '/campaign-agent', icon: 'campaigns' },
    { label: `Ask ${assistantName}`, href: '/gros', icon: 'gros' },
    {
      label: 'Competitor agent',
      href: '/competitor-agent',
      icon: 'inspirations'
    },
    { label: 'Results & learning', href: '/reports', icon: 'admin-overview' },
    { label: 'Bill optimizer', href: '/optimizer', icon: 'operations' },
    {
      label: 'Templates & references',
      href: '/email-library',
      icon: 'templates'
    },
    { label: 'Connections', href: '/connections', icon: 'connections' },
    { label: 'Team', href: '/team', icon: 'team' },
    { label: 'Support', href: '/support', icon: 'support' },
    { label: 'Settings', href: '/settings', icon: 'settings' }
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
