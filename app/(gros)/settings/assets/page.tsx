import type { Metadata } from 'next'
import { klaviyoMode } from '@/features/connections/live-klaviyo'
import { onboardingWorkspace } from '@/features/onboarding/data'
import { AssetsScreen } from '@/features/assets/screen'
import { assetFilter, assetsView } from '@/features/assets/view'

export const metadata: Metadata = { title: 'Brand assets' }

/** Brand assets (UI-BRAND): replaces the old /assets page. */
export default async function SettingsAssetsPage({
  searchParams
}: {
  searchParams: Promise<{ category?: string | string[] }>
}) {
  const [workspace, { category }] = await Promise.all([
    onboardingWorkspace(),
    searchParams
  ])
  return (
    <AssetsScreen
      view={assetsView({
        owner: workspace.context.tenantRole === 'owner',
        filter: assetFilter(category),
        setup: workspace.setup,
        products: workspace.data?.products ?? null,
        liveKlaviyo: klaviyoMode() === 'live'
      })}
    />
  )
}
