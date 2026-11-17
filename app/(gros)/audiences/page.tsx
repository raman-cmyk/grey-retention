import type { Metadata } from 'next'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { audiencesReadModel } from '@/features/audiences/read-model'
import { AudiencesScreen } from '@/features/audiences/screen'

export const metadata: Metadata = { title: 'Audiences' }

/** Audiences (UI-AUDa): the store's Klaviyo segments and lists. */
export default async function AudiencesPage() {
  const context = await requireRequestContext('client')
  return (
    <AudiencesScreen
      view={await audiencesReadModel(context)}
      owner={context.tenantRole === 'owner'}
    />
  )
}
