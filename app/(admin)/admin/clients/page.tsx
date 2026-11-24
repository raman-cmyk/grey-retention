import type { Metadata } from 'next'
import { AdminPage } from '@/components/gros/admin-nav'
import { NotBuiltYet } from '@/features/admin/screens'
import { adminAlsoMember } from '@/features/auth/application/admin-member'

export const metadata: Metadata = { title: 'Clients' }

/** Not built yet (UI-ADM): the GROS empty state with the way back. */
export default async function AdminClientsPage() {
  return (
    <AdminPage
      current="clients"
      title="Clients"
      member={await adminAlsoMember()}
    >
      <NotBuiltYet />
    </AdminPage>
  )
}
