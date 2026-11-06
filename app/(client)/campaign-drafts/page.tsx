import { redirect } from 'next/navigation'
import { legacyDraftsHref } from '@/features/planner/model'

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
  redirect(legacyDraftsHref(status))
}
