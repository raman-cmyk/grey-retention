import Link from 'next/link'
import type { Route } from 'next'
import { PageHeading, Panel, Notice } from '@/components/ui/workspace'
import { designerWorkspace } from '@/features/designers/data'
export default async function DesignerDashboard() {
  const { assignments, notifications, error } = await designerWorkspace()
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeading
        title="Assignment desk"
        description="Work from approved briefs. Submit and revise designs for the brand owner’s exact-version approval."
      />
      {error ? (
        <Notice error>{error}</Notice>
      ) : (
        <div className="space-y-6">
          <Panel title="Your assigned briefs">
            {assignments.length === 0 ? (
              <Notice>
                No active assignments yet. Platform admin assigns approved copy.
              </Notice>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {assignments.map((a) => (
                  <Link
                    className="rounded-lg border border-[var(--line)] p-4 hover:bg-[var(--surface-hover)]"
                    key={a.id}
                    href={`/designer/assignments/${a.id}` as Route}
                  >
                    <h3 className="font-semibold">
                      {(a.brief as { title?: string }).title ??
                        'Approved campaign brief'}
                    </h3>
                    <p className="mt-2 text-sm">
                      {a.state.replaceAll('_', ' ')} · copy v{a.copy_revision}
                    </p>
                    <p className="mt-2 text-xs text-[var(--text-muted)]">
                      Due {new Date(a.due_at).toISOString()} UTC
                    </p>
                  </Link>
                ))}
              </div>
            )}
          </Panel>
          <Panel title="Notifications">
            <ul className="space-y-3 text-sm">
              {notifications.map((n) => (
                <li key={n.id}>
                  {n.message}
                  <span className="block text-xs text-[var(--text-muted)]">
                    Email delivery simulated
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      )}
    </div>
  )
}
