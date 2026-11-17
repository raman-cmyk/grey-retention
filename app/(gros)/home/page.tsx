import type { Metadata } from 'next'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { homeReadModel } from '@/features/home/read-model'
import { HomeScreen } from '@/features/home/screen'

export const metadata: Metadata = { title: 'Home' }

/** Home (UI-HOMEb): replaces the old dashboard. */
export default async function HomePage() {
  const context = await requireRequestContext('client')
  return <HomeScreen view={await homeReadModel(context)} />
}
