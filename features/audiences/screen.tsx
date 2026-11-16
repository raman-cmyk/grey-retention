import type { Route } from 'next'
import { Users } from 'lucide-react'
import { ButtonLink } from '@/components/gros/button'
import { Card } from '@/components/gros/card'
import { ListRow, RowList } from '@/components/gros/list-row'
import { AppPage, CardRow } from '@/components/gros/nav'
import { EmptyState } from '@/components/gros/states'
import type { AudienceRow, AudiencesView } from './read-model'

/**
 * Audiences (UI-AUDa): the store's Klaviyo segments and lists with their
 * sizes, each opening its own page, on the GROS components.
 */
export function AudiencesScreen({
  view,
  owner
}: {
  view: AudiencesView
  owner: boolean
}) {
  return (
    <AppPage current="audiences" title="Audiences">
      {view.state === 'not_connected' ? (
        <EmptyState
          title="Connect Klaviyo"
          action={
            owner ? (
              <ButtonLink href={'/settings' as Route} label="Open Settings" />
            ) : null
          }
        />
      ) : view.state === 'unavailable' ? (
        <Card label="Audiences">
          <h2 className="type-heading">Audiences</h2>
          <p className="type-body mt-[var(--space-3)] text-[var(--stone)]">
            {view.source}
          </p>
        </Card>
      ) : (
        <CardRow>
          <AudienceCard
            title="Segments"
            rows={view.segments}
            source={view.source}
            href={(id) => `/segments/${encodeURIComponent(id)}` as Route}
          />
          <AudienceCard
            title="Lists"
            rows={view.lists}
            source={view.source}
            href={(id) => `/lists/${encodeURIComponent(id)}` as Route}
          />
        </CardRow>
      )}
    </AppPage>
  )
}

const people = (n: number) =>
  n === 1 ? '1 person' : `${new Intl.NumberFormat('en-US').format(n)} people`

function AudienceThumb() {
  return (
    <span
      aria-hidden
      className="gros-thumb flex shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--mist)] text-[var(--stone)]"
    >
      <Users size={18} strokeWidth={2} />
    </span>
  )
}

function AudienceCard({
  title,
  rows,
  source,
  href
}: {
  title: string
  rows: AudienceRow[]
  source: string
  href: (id: string) => Route
}) {
  return (
    <Card label={title}>
      <div className="flex flex-col gap-[var(--space-5)]">
        <div className="flex flex-col gap-[var(--space-1)]">
          <h2 className="type-heading">{title}</h2>
          <p className="type-caption text-[var(--stone)]">{source}</p>
        </div>
        {rows.length === 0 ? (
          <p className="type-body text-[var(--stone)]">
            {title === 'Segments'
              ? 'No segments in Klaviyo yet.'
              : 'No lists in Klaviyo yet.'}
          </p>
        ) : (
          <RowList label={title}>
            {rows.map((row) => (
              <ListRow
                key={row.id}
                thumbnail={<AudienceThumb />}
                title={row.name}
                details={[
                  people(row.people),
                  row.detail,
                  row.active ? '' : 'Not kept up to date'
                ]}
                end={
                  <ButtonLink
                    href={href(row.id)}
                    label="Open"
                    kind="outline"
                    size="row"
                  />
                }
              />
            ))}
          </RowList>
        )}
      </div>
    </Card>
  )
}
