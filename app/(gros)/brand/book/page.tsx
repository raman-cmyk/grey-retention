import type { Metadata } from 'next'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { BrandBookScreen } from '@/features/brand-profile/book-screen'
import { brandBookPage } from '@/features/brand-profile/page-model'

// UI-BRAND-2: the Brand book rewrite runs after the owner's click on this
// page (approve, a correction, Try again), within 25 s of the reply.
export const maxDuration = 60

export const metadata: Metadata = { title: 'Brand book' }

/** Brand book (UI-BRAND): what the agents read about the brand. */
export default async function BrandBookPage() {
  const context = await requireRequestContext('client')
  return <BrandBookScreen view={await brandBookPage(context)} />
}
