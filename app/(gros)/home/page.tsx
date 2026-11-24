import type { Metadata } from 'next'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { homeReadModel } from '@/features/home/read-model'
import { HomeScreen } from '@/features/home/screen'

export const metadata: Metadata = { title: 'Home' }
// Plan next 15 days and Create email can start their jobs from Home too.
export const maxDuration = 120

/** Home (UI-HOMEb): replaces the old dashboard. */
export default async function HomePage() {
  const context = await requireRequestContext('client')
  return <HomeScreen view={await homeReadModel(context)} />
}
