import type { Metadata } from 'next'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { settingsPageModel } from '@/features/settings/page-model'
import { SettingsScreen } from '@/features/settings/screen'

export const metadata: Metadata = { title: 'Settings' }

/** Settings (UI-SETa): replaces the old Settings page. */
export default async function SettingsPage({
  searchParams
}: {
  searchParams: Promise<{
    support?: string | string[]
    requests?: string | string[]
  }>
}) {
  const [context, { support, requests }] = await Promise.all([
    requireRequestContext('client'),
    searchParams
  ])
  // Show older (UI-SETd): ?support=all lists every support thread, and
  // ?requests=all every feature request.
  return (
    <SettingsScreen
      view={await settingsPageModel(context, new Date(), {
        allSupport: support === 'all',
        allRequests: requests === 'all'
      })}
    />
  )
}
