import { requireRequestContext } from '@/features/auth/application/request-context'

/**
 * The platform admin pages (UI-ADM): a platform admin only, and no old
 * AppShell around them; each page draws the GROS admin bar itself.
 */
export default async function AdminLayout({
  children
}: {
  children: React.ReactNode
}) {
  await requireRequestContext('admin')
  return children
}
