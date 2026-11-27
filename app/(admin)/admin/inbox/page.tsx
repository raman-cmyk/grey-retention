import type { Metadata } from 'next'
import { AdminPage } from '@/components/gros/admin-nav'
import { ButtonLink } from '@/components/gros/button'
import { ErrorState } from '@/components/gros/states'
import { adminAlsoMember } from '@/features/auth/application/admin-member'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { BlockLibraryCard } from '@/features/block-library/admin-card'
import { readBlockLibraryCount } from '@/features/block-library/count'
import { inboxAdminData } from '@/features/inbox/admin/data'
import { createClient } from '@/lib/supabase/server'
import {
  AddBrand,
  BrandDirectory,
  OpsQueue
} from '@/features/inbox/admin/views'

export const metadata: Metadata = { title: 'Inspiration inbox' }

/**
 * The inbox ops queue and the competitor brand directory (INB-004), and
 * the block library's count (DES-ENGINE-004).
 */
export default async function InboxAdminPage() {
  await requireRequestContext('admin')
  const [data, member, blocks] = await Promise.all([
    inboxAdminData(),
    adminAlsoMember(),
    createClient()
      .then((db) => (db ? readBlockLibraryCount(db) : null))
      .catch(() => null)
  ])
  return (
    <AdminPage current="inbox" title="Inspiration inbox" member={member}>
      {!data ? (
        <ErrorState
          title="The inbox did not open"
          reason="The inbox could not be read. Reload the page to try again."
          action={<ButtonLink href="/admin/inbox" label="Try again" />}
        />
      ) : (
        <>
          <OpsQueue tasks={data.tasks} brands={data.brands} />
          <BrandDirectory brands={data.brands} />
          <BlockLibraryCard count={blocks} />
          <AddBrand />
        </>
      )}
    </AdminPage>
  )
}
