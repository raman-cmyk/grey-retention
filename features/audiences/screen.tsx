import type { Route } from 'next'
import { Users } from 'lucide-react'
import { ButtonLink } from '@/components/gros/button'
import { Card } from '@/components/gros/card'
import { ListRow, RowList } from '@/components/gros/list-row'
import { AppPage, CardRow } from '@/components/gros/nav'
import { EmptyState, ErrorState } from '@/components/gros/states'
import type { AudienceRow, AudiencesView } from './read-model'

// Klaviyo is connected on Connections today (the detail pages say "Go to
// Connections" too); the GROS Settings screen takes this over later.
const connectHref: Route = '/connections'
const audiencesHref: Route = '/audiences'

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
        owner ? (
          <EmptyState
            title="Klaviyo not connected"
            action={<ButtonLink href={connectHref} label="Connect Klaviyo" />}
          />
        ) : (
          <Card label="Klaviyo">
            <h2 className="type-heading">Klaviyo is not connected</h2>
            <p className="type-body mt-[var(--space-3)] text-[var(--stone)]">
              The store’s owner connects Klaviyo. Its segments and lists then
              show here.
            </p>
          </Card>
        )
      ) : view.state === 'reconnect' ? (
        <ErrorState
          title="Klaviyo key stopped working"
          reason={
            owner
              ? 'Reconnect Klaviyo with a new private key to see your segments and lists.'
              : 'The store’s owner reconnects Klaviyo with a new private key.'
          }
          action={
            owner ? <ButtonLink href={connectHref} label="Reconnect" /> : null
          }
        />
      ) : view.state === 'unavailable' ? (
        <ErrorState
          title="Audiences could not be read"
          reason={
            view.retry ? `${view.reason} Try again in a minute.` : view.reason
          }
          action={
            view.retry ? (
              <ButtonLink href={audiencesHref} label="Try again" />
            ) : null
          }
        />
      ) : (
        <CardRow>
          <AudienceCard
            title="Segments"
            empty="No segments in Klaviyo yet."
            source={view.source}
            rows={view.segments}
            href={(id) => `/segments/${encodeURIComponent(id)}` as Route}
          />
          <AudienceCard
            title="Lists"
            empty="No lists in Klaviyo yet."
            source={view.source}
            rows={view.lists}
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
  empty,
  source,
  rows,
  href
}: {
  title: string
  /** What the card says when Klaviyo has none. */
  empty: string
  /** Where its numbers come from (BRAND rule 1: on the card, not the page). */
  source: string
  rows: AudienceRow[]
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
          <p className="type-body text-[var(--stone)]">{empty}</p>
        ) : (
          <RowList label={title}>
            {rows.map((row) => (
              <ListRow
                key={row.id}
                thumbnail={<AudienceThumb />}
                title={row.name}
                details={[
                  // Starred segments come first, so say why.
                  row.starred ? 'Starred' : '',
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
