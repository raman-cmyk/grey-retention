import type { Metadata } from 'next'
import { AdminPage } from '@/components/gros/admin-nav'
import { AdminDashboard } from '@/features/admin/screens'
import { adminAlsoMember } from '@/features/auth/application/admin-member'

export const metadata: Metadata = { title: 'Dashboard' }

/** The admin Dashboard (UI-ADM). */
export default async function AdminDashboardPage() {
  return (
    <AdminPage
      current="dashboard"
      title="Platform operations"
      member={await adminAlsoMember()}
    >
      <AdminDashboard />
    </AdminPage>
  )
}
