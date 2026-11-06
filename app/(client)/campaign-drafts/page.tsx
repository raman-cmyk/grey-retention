import type { Route } from 'next'
import { redirect } from 'next/navigation'
import { legacyDraftStatus } from '@/features/planner/model'

/**
 * The old app's drafts list is now the Campaigns table (UIR-017,
 * OWNER_JOURNEYS.md §18.1). Old links land there with their filter.
 */
export default async function CampaignDraftsPage({
  searchParams
}: {
  searchParams: Promise<{ status?: string | string[] }>
}) {
  const { status } = await searchParams
  const value = legacyDraftStatus(Array.isArray(status) ? status[0] : status)
  redirect(
    `/campaign-agent?view=table${value === 'all' ? '' : `&status=${value}`}` as Route
  )
}
