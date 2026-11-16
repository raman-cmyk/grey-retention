import type { Route } from 'next'

/**
 * Where "Back" goes from a Klaviyo detail page. The old dashboard and its
 * Klaviyo tabs are retired (UI-HOMEb): Home, until Audiences (lists and
 * segments) and Results (campaigns, flows, metrics) take these pages.
 */
export function dashboardBack(from: unknown): { href: Route; label: string } {
  void from
  return { href: '/home' as Route, label: 'Back to Home' }
}
