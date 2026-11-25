import type { Metadata } from 'next'
import { brandPage } from '@/features/brand-profile/page-model'
import { BrandScreen } from '@/features/brand-profile/screen'

// UI-BRAND-2: the Brand book rewrite runs after the owner's click on this
// page (approve, a correction, Try again), within 25 s of the reply.
export const maxDuration = 60

export const metadata: Metadata = { title: 'Brand' }

/** Brand (UI-BRAND; a main page at /brand since UI-BRAND-2). */
export default async function BrandPage() {
  return <BrandScreen view={await brandPage()} />
}
