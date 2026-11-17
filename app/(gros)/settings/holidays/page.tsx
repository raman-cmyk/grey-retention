import type { Metadata } from 'next'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { holidaysPage } from '@/features/holidays/data'
import {
  editingEntry,
  HolidaysScreen
} from '@/features/settings/holidays-screen'

export const metadata: Metadata = { title: 'Holidays and events' }

/** Holidays and events (UI-SETd): replaces the old /holidays page. */
export default async function SettingsHolidaysPage({
  searchParams
}: {
  searchParams: Promise<{ edit?: string | string[] }>
}) {
  const [context, { edit }] = await Promise.all([
    requireRequestContext('client'),
    searchParams
  ])
  const page = await holidaysPage(context)
  const owner = context.tenantRole === 'owner'
  return (
    <HolidaysScreen
      page={page}
      owner={owner}
      editing={editingEntry(page.own, owner, edit)}
    />
  )
}
