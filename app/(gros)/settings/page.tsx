import type { Metadata } from 'next'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { settingsPageModel } from '@/features/settings/page-model'
import { SettingsScreen } from '@/features/settings/screen'

export const metadata: Metadata = { title: 'Settings' }

/** Settings (UI-SETa): replaces the old Settings page. */
export default async function SettingsPage() {
  const context = await requireRequestContext('client')
  return <SettingsScreen view={await settingsPageModel(context)} />
}
