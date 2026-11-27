import type { Route } from 'next'
import { Users } from 'lucide-react'
import { ButtonLink } from '@/components/gros/button'
import { Card } from '@/components/gros/card'
import { ListRow, RowList } from '@/components/gros/list-row'
import { AppPage, CardRow } from '@/components/gros/nav'
import { EmptyState, ErrorState } from '@/components/gros/states'
import { HygieneCard } from './hygiene-card'
import type { HygieneView } from './hygiene-view'
import type { AudienceRow, AudiencesProblem, AudiencesView } from './read-model'

// Klaviyo is connected on the Klaviyo card of the GROS Settings (UI-AUDc).
export const connectKlaviyoHref: Route = '/settings#klaviyo'
export const audiencesHref: Route = '/audiences'

/** A segment's own page (UI-AUDc). */
export const segmentHref = (id: string) =>
  `/audiences/segments/${encodeURIComponent(id)}` as Route
/** A list's own page (UI-AUDc). */
export const listHref = (id: string) =>
  `/audiences/lists/${encodeURIComponent(id)}` as Route

/**
 * Audiences (UI-AUDa): the store's Klaviyo segments and lists with their
 * sizes, each opening its own page, on the GROS components.
 */
export function AudiencesScreen({
  view,
  owner,
  hygiene
}: {
  view: AudiencesView
  owner: boolean
  /** PICK-101: who every email leaves out (missing: not shown). */
  hygiene?: HygieneView
}) {
  return (
    <AppPage current="audiences" title="Audiences">
      {hygiene ? <HygieneCard view={hygiene} owner={owner} /> : null}
      {view.state !== 'ready' ? (
        <AudiencesProblemCard
          problem={view}
          owner={owner}
          retryHref={audiencesHref}
        />
      ) : (
        <CardRow>
          <AudienceCard
            title="Segments"
            empty="No segments in Klaviyo yet."
            source={view.source}
            rows={view.segments}
            href={segmentHref}
          />
          <AudienceCard
            title="Lists"
            empty="No lists in Klaviyo yet."
            source={view.source}
            rows={view.lists}
            href={listHref}
          />
        </CardRow>
      )}
    </AppPage>
  )
}

/**
 * Why Klaviyo's audiences cannot be shown, with the one button that fixes
 * it, on Audiences and on a segment's or a list's page alike: the owner
 * connects or reconnects Klaviyo on Settings; staff are told who does.
 */
export function AudiencesProblemCard({
  problem,
  owner,
  retryHref
}: {
  problem: AudiencesProblem
  owner: boolean
  /** The page Try again opens again. */
  retryHref: Route
}) {
  if (problem.state === 'not_connected')
    return owner ? (
      <EmptyState
        title="Klaviyo not connected"
        action={
          <ButtonLink href={connectKlaviyoHref} label="Connect Klaviyo" />
        }
      />
    ) : (
      <Card label="Klaviyo">
        <h2 className="type-heading">Klaviyo not connected</h2>
        <p className="type-body mt-[var(--space-3)] text-[var(--stone)]">
          The store’s owner connects Klaviyo. Its segments and lists then show
          here.
        </p>
      </Card>
    )
  if (problem.state === 'reconnect')
    return (
      <ErrorState
        title="Klaviyo key stopped working"
        reason={
          owner
            ? 'Reconnect Klaviyo with a new private key to see your segments and lists.'
            : 'The store’s owner reconnects Klaviyo with a new private key.'
        }
        action={
          owner ? (
            <ButtonLink href={connectKlaviyoHref} label="Reconnect" />
          ) : null
        }
      />
    )
  return (
    <ErrorState
      title="Audiences could not be read"
      reason={
        problem.retry
          ? `${problem.reason} Try again in a minute.`
          : problem.reason
      }
      action={
        problem.retry ? <ButtonLink href={retryHref} label="Try again" /> : null
      }
    />
  )
}

export const people = (n: number) =>
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
                // A long name and its rules show whole, on a phone too.
                wrap
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
