import { requireRequestContext } from '@/features/auth/application/request-context'

/**
 * The GROS screens (docs/design/BRAND.md): a signed-in workspace member
 * only, and no old AppShell around them (each page draws its own top bar).
 */
export default async function GrosLayout({
  children
}: {
  children: React.ReactNode
}) {
  await requireRequestContext('client')
  return children
}
