import type { Metadata } from 'next'
import { Notice, PageHeading } from '@/components/ui/workspace'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { inboxAdminData } from '@/features/inbox/admin/data'
import { BrandDirectory, OpsQueue } from '@/features/inbox/admin/views'

export const metadata: Metadata = { title: 'Inspiration inbox' }

/** The inbox ops queue and the competitor brand directory (INB-004). */
export default async function InboxAdminPage() {
  await requireRequestContext('admin')
  const data = await inboxAdminData()
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeading
        title="Inspiration inbox"
        description="Competitor newsletters arrive at one inbox, one +alias per brand. Here a person handles what the inbox cannot, and keeps the brand list."
      />
      {!data ? (
        <Notice error>
          The inbox could not be read. Reload the page to try again.
        </Notice>
      ) : (
        <>
          <OpsQueue tasks={data.tasks} brands={data.brands} />
          <BrandDirectory brands={data.brands} />
        </>
      )}
    </div>
  )
}
