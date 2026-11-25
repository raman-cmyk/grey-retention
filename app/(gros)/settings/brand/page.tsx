import type { Metadata } from 'next'
import { brandPage } from '@/features/brand-profile/page-model'
import { BrandScreen } from '@/features/brand-profile/screen'

export const metadata: Metadata = { title: 'Brand' }

/** Brand (UI-BRAND): replaces the old /brand page. */
export default async function SettingsBrandPage() {
  return <BrandScreen view={await brandPage()} />
}
