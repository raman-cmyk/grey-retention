import type { Route } from 'next'
import { ActionButton } from '@/components/gros/action'
import { ButtonLink } from '@/components/gros/button'
import { Card } from '@/components/gros/card'
import {
  EmailThumb,
  ListRow,
  RowList,
  TextThumb
} from '@/components/gros/list-row'
import { AppPage, CardRow } from '@/components/gros/nav'
import {
  stopTracking,
  trackDomain
} from '@/features/library/inspirations/actions'
import type { TrackedDomain } from '@/features/library/reference-library/data'
import { referenceHref } from '@/features/library/reference-library/model'
import { hideBrand } from './actions'
import { FollowForm } from './follow-form'
import type { InspirationView } from './read-model'

/**
 * Inspiration (UI-INSa): the brands the workspace follows, brands like the
 * store to follow or hide, and the latest emails to build from, on the
 * GROS components. Following, stopping and hiding are the owner's; staff
 * see the same screen without them.
 */
export function InspirationScreen({
  view,
  timezone
}: {
  view: InspirationView
  timezone: string
}) {
  return (
    <AppPage current="inspiration" title="Inspiration">
      <CardRow>
        <FollowedCard view={view} />
        <SuggestionsCard view={view} />
      </CardRow>
      <EmailsCard view={view} timezone={timezone} />
    </AppPage>
  )
}

/** A brand's first letter in a thumbnail-sized tile (it has no picture). */
function BrandThumb({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className="gros-thumb type-heading flex shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--mist)] text-[var(--stone)]"
    >
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
}

/** How following a brand is going, in words (not one of the four statuses). */
const followWords: Record<TrackedDomain['status'], string> = {
  live: '',
  pending: 'Waiting for its first email',
  error: 'Its emails could not be brought in'
}

const perWeek = (n: number) =>
  n < 1 ? 'less than one a week' : `${Math.round(n)} a week`

function FollowedCard({ view }: { view: InspirationView }) {
  const title = 'Brands you follow'
  return (
    <Card label={title}>
      <div className="flex flex-col gap-[var(--space-5)]">
        <h2 className="type-heading">{title}</h2>
        {view.unread.includes('library') ? (
          <p className="type-body text-[var(--stone)]">
            The brands you follow could not be read. Open Inspiration again in a
            minute.
          </p>
        ) : view.tracked.length === 0 ? (
          <p className="type-body text-[var(--stone)]">
            No brands followed yet.
          </p>
        ) : (
          <RowList label={title}>
            {view.tracked.map((t) => {
              const summary = view.summaries[t.domain]
              return (
                <ListRow
                  key={t.subscriptionId}
                  thumbnail={<BrandThumb name={t.label} />}
                  title={t.label}
                  details={[
                    t.label === t.domain ? '' : t.domain,
                    t.emails === 1 ? '1 email' : `${t.emails} emails`,
                    summary ? `Sends ${perWeek(summary.perWeek)}` : '',
                    // In words, for everyone: these are not email statuses.
                    followWords[t.status],
                    t.sample ? 'Sample' : ''
                  ]}
                  end={
                    view.owner ? (
                      <ActionButton
                        action={stopTracking}
                        label="Stop"
                        kind="outline"
                        size="row"
                        fields={{
                          subscription: t.subscriptionId,
                          revision: String(t.revision),
                          domain: t.domain
                        }}
                      />
                    ) : null
                  }
                />
              )
            })}
          </RowList>
        )}
        {view.owner && !view.unread.includes('library') ? (
          view.slotsLeft > 0 ? (
            <FollowForm />
          ) : (
            <p className="type-caption text-[var(--stone)]">
              You follow {view.limit} brands, the most at a time. Stop one to
              follow another.
            </p>
          )
        ) : null}
      </div>
    </Card>
  )
}

function SuggestionsCard({ view }: { view: InspirationView }) {
  const title = 'Brands like yours'
  return (
    <Card label={title}>
      <div className="flex flex-col gap-[var(--space-5)]">
        <h2 className="type-heading">{title}</h2>
        {view.unread.includes('suggestions') ? (
          <p className="type-body text-[var(--stone)]">
            Suggestions could not be read just now.
          </p>
        ) : view.suggestions.length === 0 ? (
          <p className="type-body text-[var(--stone)]">
            No suggestions yet. They come from brands of your industry that send
            newsletters.
          </p>
        ) : (
          <RowList label={title}>
            {view.suggestions.map((s) => (
              <ListRow
                key={s.captureId}
                thumbnail={<BrandThumb name={s.name} />}
                title={s.name}
                details={[s.domain, s.reason]}
                end={
                  view.owner ? (
                    <div className="flex flex-wrap items-center gap-[var(--space-2)]">
                      {s.followable && view.slotsLeft > 0 ? (
                        <ActionButton
                          action={trackDomain}
                          label="Follow"
                          kind="outline"
                          size="row"
                          fields={{ domain: s.domain }}
                        />
                      ) : null}
                      <ActionButton
                        action={hideBrand}
                        label="Hide"
                        kind="quiet"
                        size="row"
                        fields={{ capture: s.captureId }}
                      />
                    </div>
                  ) : null
                }
              />
            ))}
          </RowList>
        )}
      </div>
    </Card>
  )
}

/** When an email arrived, in the store's own time: Mon 16 Nov. */
function arrived(iso: string, timezone: string) {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  try {
    return at.toLocaleDateString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: timezone
    })
  } catch {
    return at.toISOString().slice(0, 10)
  }
}

function EmailsCard({
  view,
  timezone
}: {
  view: InspirationView
  timezone: string
}) {
  const title = 'Latest emails'
  return (
    <Card label={title}>
      <div className="flex flex-col gap-[var(--space-5)]">
        <h2 className="type-heading">{title}</h2>
        {view.unread.includes('library') ? (
          <p className="type-body text-[var(--stone)]">
            The emails could not be read just now.
          </p>
        ) : view.emails.length === 0 ? (
          <p className="type-body text-[var(--stone)]">
            No emails yet. Follow a brand and its newsletters arrive here.
          </p>
        ) : (
          <RowList label={title}>
            {view.emails.map((item) => (
              <ListRow
                key={`${item.source}-${item.id}`}
                thumbnail={
                  item.screenshot ? (
                    <EmailThumb
                      src={item.screenshot.url}
                      alt={`Screenshot of ${item.title}`}
                    />
                  ) : (
                    <TextThumb />
                  )
                }
                title={item.title}
                details={[
                  item.from,
                  arrived(item.at, timezone),
                  item.source === 'import' ? 'Added by you' : '',
                  item.sample ? 'Sample' : ''
                ]}
                end={
                  view.owner ? (
                    <ButtonLink
                      href={referenceHref(item) as Route}
                      label="Use this design"
                      kind="outline"
                      size="row"
                    />
                  ) : (
                    <span />
                  )
                }
              />
            ))}
          </RowList>
        )}
      </div>
    </Card>
  )
}
