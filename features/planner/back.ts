import type { Route } from 'next'

/**
 * "Back to the plan" for a Klaviyo page opened from the old Campaigns
 * planner (`from=planner`). UI-OLDc retired that planner: the next 15 days
 * are the Plan now, so the link opens it. Null for any other `from`.
 */
export function plannerBack(
  raw: Record<string, string | string[] | undefined>
): { href: Route; label: string } | null {
  const from = Array.isArray(raw.from) ? raw.from[0] : raw.from
  if (from !== 'planner') return null
  return { href: '/plan', label: 'Back to the plan' }
}
