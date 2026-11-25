import type { Metadata } from 'next'
import { requireRequestContext } from '@/features/auth/application/request-context'
import {
  loadKlaviyoResults,
  loadResultsScreen
} from '@/features/results/results-screen-load'
import { ResultsScreen } from '@/features/results/screen'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Results' }

/**
 * Results (UI-RES-b): every email GROS put into Klaviyo, with its numbers,
 * and Klaviyo's own campaigns, flows and metrics, each opening its page
 * (UI-KLV).
 */
export default async function ResultsPage() {
  const context = await requireRequestContext('client')
  const db = await createClient()
  const [view, klaviyo] = await Promise.all([
    db
      ? loadResultsScreen(db, context.tenantId)
      : Promise.resolve({ kind: 'error' } as const),
    loadKlaviyoResults(context)
  ])
  return <ResultsScreen view={view} klaviyo={klaviyo} />
}
