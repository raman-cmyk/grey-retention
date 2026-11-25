import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { campaignDetail } from '@/features/klaviyo-detail/detail'
import { CampaignScreen } from '@/features/klaviyo-detail/detail-screen'
import { klaviyoCampaignHref } from '@/features/klaviyo-detail/hrefs'

export const metadata: Metadata = { title: 'Campaign' }

/** A Klaviyo campaign's own page under Results (UI-KLV). */
export default async function CampaignPage({
  params
}: {
  params: Promise<{ campaignId: string }>
}) {
  const { campaignId } = await params
  const context = await requireRequestContext('client')
  const view = await campaignDetail(context, campaignId)
  if (view.state === 'not_found') notFound()
  return (
    <CampaignScreen
      view={view}
      owner={context.tenantRole === 'owner'}
      href={klaviyoCampaignHref(campaignId)}
    />
  )
}
