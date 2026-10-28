import { campaignWorkspace } from '@/features/campaigns/data'
import { CampaignOverview } from '@/features/campaigns/overview'

export default async function DashboardPage({
  searchParams
}: {
  searchParams: Promise<{ focus?: string; p?: string }>
}) {
  const [workspace, params] = await Promise.all([
    campaignWorkspace(),
    searchParams
  ])
  return (
    <CampaignOverview
      workspace={workspace}
      focus={params.focus}
      page={params.p}
    />
  )
}
