import type { Metadata } from 'next'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { loadResultsScreen } from '@/features/results/results-screen-load'
import { ResultsScreen } from '@/features/results/screen'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Results' }

/** Results (UI-RES-b): every email GROS put into Klaviyo, with its numbers. */
export default async function ResultsPage() {
  const context = await requireRequestContext('client')
  const db = await createClient()
  const view = db
    ? await loadResultsScreen(db, context.tenantId)
    : ({ kind: 'error' } as const)
  return <ResultsScreen view={view} />
}
