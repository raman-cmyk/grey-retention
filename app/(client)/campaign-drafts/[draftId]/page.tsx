import type { Route } from 'next'
import { redirect } from 'next/navigation'

/** An old draft link opens that campaign's page (UIR-017). */
export default async function CampaignDraftPage({
  params
}: {
  params: Promise<{ draftId: string }>
}) {
  const { draftId } = await params
  redirect(`/campaigns/${encodeURIComponent(draftId)}` as Route)
}
