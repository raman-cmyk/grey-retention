import type { Metadata } from 'next'
import { profilePageData } from '@/features/profile/data'
import { AccountScreen } from '@/features/profile/screen'

export const metadata: Metadata = { title: 'Account' }

/** Account (UI-AUTH): replaces the old /profile page, which redirects here. */
export default async function SettingsAccountPage() {
  return <AccountScreen profile={await profilePageData()} />
}
