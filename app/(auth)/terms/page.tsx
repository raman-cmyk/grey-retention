import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { legalDraftsOn, termsDraft } from '@/features/legal/drafts'
import { PolicyPage } from '@/features/legal/policy-page'

// POLICY-DRAFT: a draft, shown only with LEGAL_DRAFTS=on, never indexed and
// never linked from sign-up until Raman confirms it.
export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Terms of Service (draft)',
  robots: { index: false, follow: false }
}

export default function Page() {
  if (!legalDraftsOn()) notFound()
  return <PolicyPage draft={termsDraft} />
}
