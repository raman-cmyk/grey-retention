import type { Metadata } from 'next'
import { Notice } from '@/components/ui/workspace'
import { onboardingWorkspace } from '@/features/onboarding/data'
import { BrandEvidence } from '@/features/onboarding/panels'
import { CataloguePanels } from '@/features/brand/catalogue-panels'
import { brandProfileData } from '@/features/brand-profile/data'
import {
  ApprovalBar,
  BrandHeader,
  MismatchBanner,
  updatedAgo
} from '@/features/brand-profile/header'
import {
  BrandProfile,
  type SectionView
} from '@/features/brand-profile/profile'
import {
  savedBrandDefaults,
  sectionKeys
} from '@/features/brand-profile/sections'

export const metadata: Metadata = { title: 'Brand Intelligence' }

export default async function BrandPage() {
  const { context, data, error, setup } = await onboardingWorkspace()
  const owner = context.tenantRole === 'owner'
  if (error || !data)
    return <Notice error>{error ?? 'Brand details unavailable.'}</Notice>
  const profile = await brandProfileData(context.tenantId, data.brand)
  const sections = profile?.sections ?? []
  const latest =
    sections
      .map((s) => s.updatedAt)
      .sort()
      .at(-1) ?? null
  // Unsaved Identity and Tone show the brand details the AI already reads.
  const defaults = data.brand ? savedBrandDefaults(data.brand) : {}
  const views: SectionView[] = sectionKeys.flatMap((key): SectionView[] => {
    const saved = sections.find((s) => s.section === key)
    if (saved)
      return [
        {
          section: key,
          content: saved.content,
          locked: saved.locked,
          source: saved.source,
          revision: saved.revision,
          updated: updatedAgo(saved.updatedAt)
        }
      ]
    const content = defaults[key]
    return content
      ? [
          {
            section: key,
            content,
            locked: [],
            source: 'saved',
            revision: 0,
            updated: null
          }
        ]
      : []
  })
  return (
    <div className="mx-auto max-w-[920px]">
      <BrandHeader
        active="profile"
        owner={owner}
        lastUpdated={updatedAgo(latest)}
        revisions={Object.fromEntries(
          sections.map((s) => [s.section, s.revision])
        )}
      />
      <MismatchBanner mismatches={profile?.mismatches ?? []} />
      <ApprovalBar brand={data.brand} owner={owner} />
      {profile?.unavailable && (
        <Notice error>
          The editable Brand profile needs a database update. Your saved brand
          details and approvals still work.
        </Notice>
      )}
      <BrandProfile owner={owner} products={data.products} views={views} />
      <h2 className="tracking-label mt-12 mb-4 font-mono text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase">
        Catalogue, offers and brand kit
      </h2>
      <div className="space-y-6">
        <CataloguePanels context={context} data={data} />
        {setup && <BrandEvidence setup={setup} owner={owner} />}
      </div>
    </div>
  )
}
