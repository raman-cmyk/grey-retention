import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { campaignDetail } from '@/features/campaigns/data'
import { DraftError, DraftScreen } from '@/features/drafts/draft-screen'
import { draftView } from '@/features/drafts/draft-view'

export const metadata: Metadata = { title: 'Your draft' }

/**
 * A saved draft (UI-OLDc), on the GROS screens: where "Use this design"
 * lands. Replaces the old campaign page; `/campaigns/<id>` redirects here.
 */
export default async function DraftPage({
  params
}: {
  params: Promise<{ campaignId: string }>
}) {
  const { campaignId } = await params
  if (!z.uuid().safeParse(campaignId).success) notFound()
  const detail = await campaignDetail(campaignId)
  if (!detail.campaign) {
    if (detail.error) return <DraftError />
    notFound()
  }
  return (
    <DraftScreen
      view={draftView({
        campaign: detail.campaign,
        content: detail.content,
        comments: detail.comments,
        audiences: detail.data?.audiences ?? [],
        owner: detail.context.tenantRole === 'owner'
      })}
    />
  )
}
