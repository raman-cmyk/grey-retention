import type { Metadata } from 'next'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { setupReadModel } from '@/features/onboarding/flow'
import { openPlace } from '@/features/onboarding/flow-model'
import { SetupScreen } from '@/features/onboarding/setup-screen'

export const metadata: Metadata = { title: 'Set up your store' }

/** Onboarding (UI-ONBb): opens the step that is Now, or a done one asked for. */
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
  return (
    <SetupScreen
      view={view}
      place={view.flow ? openPlace(view.flow, asked) : 'store'}
    />
  )
}
