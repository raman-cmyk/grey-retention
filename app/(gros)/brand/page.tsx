import type { Metadata } from 'next'
import { brandPage } from '@/features/brand-profile/page-model'
import { BrandScreen } from '@/features/brand-profile/screen'

export const metadata: Metadata = { title: 'Brand' }

/** Brand (UI-BRAND; a main page at /brand since UI-BRAND-2). */
export default async function BrandPage() {
  return <BrandScreen view={await brandPage()} />
}
