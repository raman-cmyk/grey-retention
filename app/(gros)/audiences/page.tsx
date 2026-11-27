import type { Metadata } from 'next'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { hygieneReadModel } from '@/features/audiences/hygiene-view'
import { audiencesReadModel } from '@/features/audiences/read-model'
import { AudiencesScreen } from '@/features/audiences/screen'

export const metadata: Metadata = { title: 'Audiences' }

/** Audiences (UI-AUDa): the store's Klaviyo segments and lists. */
export default async function AudiencesPage() {
  const context = await requireRequestContext('client')
  const [view, hygiene] = await Promise.all([
    audiencesReadModel(context),
    hygieneReadModel(context)
  ])
  return (
    <AudiencesScreen
      view={view}
      owner={context.tenantRole === 'owner'}
      hygiene={hygiene}
    />
  )
}
