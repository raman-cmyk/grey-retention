import type { Route } from 'next'
import { ButtonLink } from '@/components/gros/button'
import { Card } from '@/components/gros/card'
import { ListRow, RowList } from '@/components/gros/list-row'
import { EmptyState } from '@/components/gros/states'

type Area = { title: string; details: string[]; href: Route; label: string }

/** What the admin works with today, and what is not built yet. */
export const adminAreas: { built: Area[]; planned: Area[] } = {
  built: [
    {
      title: 'Operations',
      details: ['Go-live switches', 'Fallback log', 'Jobs', 'Support'],
      href: '/admin/operations',
      label: 'Open operations'
    },
    {
      title: 'Inspiration inbox',
      details: ['Inbox tasks', 'Brand directory'],
      href: '/admin/inbox',
      label: 'Open inbox'
    }
  ],
  planned: [
    {
      title: 'Clients',
      details: ['Workspaces, their stores and usage'],
      href: '/admin/clients',
      label: 'Open clients'
    },
    {
      title: 'Prompts',
      details: ['Prompt versions and model settings'],
      href: '/admin/prompts',
      label: 'Open prompts'
    },
    {
      title: 'Templates',
      details: ['Platform templates and categories'],
      href: '/admin/templates',
      label: 'Open templates'
    }
  ]
}

function AreaCard({ title, areas }: { title: string; areas: Area[] }) {
  return (
    <Card label={title}>
      <div className="flex flex-col gap-[var(--space-5)]">
        <h2 className="type-heading">{title}</h2>
        <RowList label={title}>
          {areas.map((area) => (
            <ListRow
              key={area.href}
              thumbnail={null}
              title={area.title}
              details={area.details}
              wrap
              end={
                <ButtonLink
                  href={area.href}
                  label={area.label}
                  kind="outline"
                  size="row"
                />
              }
            />
          ))}
        </RowList>
      </div>
    </Card>
  )
}

/**
 * The admin Dashboard (UI-ADM): the areas that work today and the ones not
 * built yet (Prompts and Templates live here instead of in the menu).
 */
export function AdminDashboard() {
  return (
    <>
      <AreaCard title="Tools" areas={adminAreas.built} />
      <AreaCard title="Not built yet" areas={adminAreas.planned} />
    </>
  )
}

/** A planned admin page: the empty state with the way back. */
export function NotBuiltYet() {
  return (
    <EmptyState
      title="Not built yet"
      action={<ButtonLink href="/admin/dashboard" label="Open dashboard" />}
    />
  )
}
