import type { Metadata } from 'next'
import { AdminPage } from '@/components/gros/admin-nav'
import { NotBuiltYet } from '@/features/admin/screens'
import { adminAlsoMember } from '@/features/auth/application/admin-member'

export const metadata: Metadata = { title: 'Prompts' }

/**
 * Not built yet (UI-ADM): the GROS empty state with the way back. Opened
 * from Dashboard, so Dashboard is its menu item.
 */
export default async function AdminPromptsPage() {
  return (
    <AdminPage
      current="dashboard"
      title="Prompts"
      member={await adminAlsoMember()}
    >
      <NotBuiltYet />
    </AdminPage>
  )
}
