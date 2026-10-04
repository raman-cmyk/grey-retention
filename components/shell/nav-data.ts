import type { Route } from 'next'

export type NavigationIcon =
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
}

export function createClientNavigation(
  assistantName: string
): NavigationItem[] {
  return [
    {
      label: 'Overview',
      href: '/dashboard',
      icon: 'overview',
      group: 'Workspace'
    },
    {
      label: 'Campaign agent',
      href: '/campaign-agent',
      icon: 'campaigns',
      group: 'Workspace'
    },
    {
      label: 'Copy review',
      href: '/copy-review',
      icon: 'copy',
      group: 'Workspace'
    },
    {
      label: `Ask ${assistantName}`,
      href: '/gros',
      icon: 'gros',
      group: 'Workspace'
    },
    {
      label: 'Brand & store',
      href: '/brand',
      icon: 'brand',
      group: 'Brand & intelligence'
    },
    {
      label: 'Assets',
      href: '/assets',
      icon: 'assets',
      group: 'Brand & intelligence'
    },
    {
      label: 'Competitor agent',
      href: '/competitor-agent',
      icon: 'inspirations',
      group: 'Brand & intelligence'
    },
    {
      label: 'Results & learning',
      href: '/reports',
      icon: 'admin-overview',
      group: 'Brand & intelligence'
    },
    {
      label: 'Templates & references',
      href: '/email-library',
      icon: 'templates',
      group: 'Brand & intelligence'
    },
    {
      label: 'Connections',
      href: '/connections',
      icon: 'connections',
      group: 'Manage'
    },
    {
      label: 'Bill optimizer',
      href: '/optimizer',
      icon: 'operations',
      group: 'Manage'
    },
    { label: 'Team', href: '/team', icon: 'team', group: 'Manage' },
    { label: 'Support', href: '/support', icon: 'support', group: 'Manage' },
    { label: 'Settings', href: '/settings', icon: 'settings', group: 'Manage' }
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
