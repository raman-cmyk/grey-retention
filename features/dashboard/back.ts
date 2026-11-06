import type { Route } from 'next'
import { klaviyoTabs } from './klaviyo-card'

/**
 * Where "Back to dashboard" goes from a Klaviyo detail page: the tab the
 * owner came from, scrolled to the Klaviyo card (docs/OWNER_JOURNEYS.md
 * Job 5 fix). Anything unexpected goes to the top of the dashboard.
 */
export function dashboardBack(from: unknown): { href: Route; label: string } {
  const tab =
    typeof from === 'string' ? from : Array.isArray(from) ? from[0] : ''
  return tab !== 'overview' && (klaviyoTabs as readonly unknown[]).includes(tab)
    ? {
        href: `/dashboard?tab=${tab}#klaviyo-data` as Route,
        label: 'Back to dashboard'
      }
    : { href: '/dashboard', label: 'Back to dashboard' }
}
