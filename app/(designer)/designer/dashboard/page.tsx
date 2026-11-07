import { PageHeading, Notice } from '@/components/ui/workspace'
import { designerWorkspace } from '@/features/designers/data'
import {
  DeskList,
  DeskNotifications,
  DeskTabs
} from '@/features/designers/desk'
import { deskModel, parseDeskFilter } from '@/features/designers/model'

export default async function DesignerDashboard({
  searchParams
}: {
  searchParams: Promise<{ show?: string | string[] }>
}) {
  const { show } = await searchParams
  const { assignments, notifications, error } = await designerWorkspace()
  const now = new Date()
  const desk = deskModel(assignments, parseDeskFilter(show), now)
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeading
        title="Assignment desk"
        description="Briefs assigned to you. Submit a design for each one; the brand owner approves the exact version."
      />
      {error ? (
        <Notice error>{error}</Notice>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <section aria-labelledby="desk-briefs">
            <h2 id="desk-briefs" className="sr-only">
              Your assigned briefs
            </h2>
            <DeskTabs filter={desk.filter} counts={desk.counts} />
            <DeskList rows={desk.rows} filter={desk.filter} />
          </section>
          <DeskNotifications items={notifications} now={now} />
        </div>
      )}
    </div>
  )
}
