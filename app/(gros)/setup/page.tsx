import type { Metadata, Route } from 'next'
import { redirect } from 'next/navigation'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { setupReadModel } from '@/features/onboarding/flow'
import { openPlace } from '@/features/onboarding/flow-model'
import { setupRivals } from '@/features/onboarding/rivals'
import { SetupScreen } from '@/features/onboarding/setup-screen'

export const metadata: Metadata = { title: 'Set up your store' }

/**
 * Onboarding (UI-ONBb..e): opens the step that is Now, or a done one asked
 * for. Once finished, `/setup` alone goes to Home; a step asked for still
 * opens.
 */
export default async function SetupPage({
  searchParams
}: {
  searchParams: Promise<{ step?: string | string[] }>
}) {
  const context = await requireRequestContext('client')
  const [{ step }, view] = await Promise.all([
    searchParams,
    setupReadModel(context)
  ])
  const asked = typeof step === 'string' ? step : null
  if (view.flow?.finished && !asked) redirect('/home' as Route)
  const place = view.flow ? openPlace(view.flow, asked) : 'store'
  const rivals = place === 'rivals' ? await setupRivals(context) : null
  return <SetupScreen view={view} place={place} rivals={rivals} />
}
