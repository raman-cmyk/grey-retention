import type { Metadata } from 'next'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { noticesReadModel } from '@/features/notifications/read-model'
import { NotificationsScreen } from '@/features/notifications/screen'

export const metadata: Metadata = { title: 'Notifications' }

/** Notifications (PICK-107): plan ready, drafts in Klaviyo, results in. */
export default async function NotificationsPage() {
  const context = await requireRequestContext('client')
  return <NotificationsScreen view={await noticesReadModel(context)} />
}
