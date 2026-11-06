import type { Metadata } from 'next'
import { Notice } from '@/components/ui/workspace'
import { onboardingWorkspace } from '@/features/onboarding/data'
import { BrandEvidence } from '@/features/onboarding/panels'
import { CataloguePanels } from '@/features/brand/catalogue-panels'
import { brandProfileData } from '@/features/brand-profile/data'
import {
  ApprovalBar,
  BrandHeader,
  MismatchBanner
} from '@/features/brand-profile/header'
import { BrandProfile } from '@/features/brand-profile/profile'
import { lastUpdated, profileViews } from '@/features/brand-profile/view'

export const metadata: Metadata = { title: 'Brand Intelligence' }

export default async function BrandPage() {
  const { context, data, error, setup } = await onboardingWorkspace()
  const owner = context.tenantRole === 'owner'
  if (error || !data)
    return (
      <div className="mx-auto max-w-[920px]">
        <BrandHeader active="profile" owner={false} lastUpdated={null} />
        <Notice error>{error ?? 'Brand details unavailable.'}</Notice>
      </div>
    )
  const profile = await brandProfileData(context.tenantId, data.brand)
  const rows = profile?.sections ?? []
  const views = profileViews(data.brand, rows)
  return (
    <div className="mx-auto max-w-[920px]">
      <BrandHeader
        active="profile"
        owner={owner}
        lastUpdated={lastUpdated(rows)}
        revisions={Object.fromEntries(
          views.map((v) => [v.section, v.revision])
        )}
      />
      <MismatchBanner mismatches={profile?.mismatches ?? []} owner={owner} />
      <ApprovalBar brand={data.brand} owner={owner} />
      {profile?.unavailable && (
        <Notice error>
          The editable Brand profile needs a database update. Your saved brand
          details and approvals still work.
        </Notice>
      )}
      <BrandProfile owner={owner} products={data.products} views={views} />
      <h2
        id="catalogue"
        className="tracking-label mt-12 mb-4 scroll-mt-24 font-mono text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase"
      >
        Catalogue, offers and brand kit
      </h2>
      <div className="space-y-6">
        <CataloguePanels context={context} data={data} />
        {setup && <BrandEvidence setup={setup} owner={owner} />}
      </div>
    </div>
  )
}
