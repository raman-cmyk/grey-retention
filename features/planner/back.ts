import type { Route } from 'next'
import { plannerHref, readPlannerQuery } from './model'

/**
 * "Back to Campaigns" for a Klaviyo page opened from the planner
 * (`from=planner` plus the planner's month, view and filters), so the owner
 * returns to the exact view they left. Null for any other `from`.
 */
export function plannerBack(
  raw: Record<string, string | string[] | undefined>,
  timezone: string,
  now = new Date()
): { href: Route; label: string } | null {
  const from = Array.isArray(raw.from) ? raw.from[0] : raw.from
  if (from !== 'planner') return null
  return {
    href: plannerHref(readPlannerQuery(raw, timezone, now), {}),
    label: 'Back to Campaigns'
  }
}
