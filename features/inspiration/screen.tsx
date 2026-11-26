import type { Route } from 'next'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { ActionAnswers, ActionButton } from '@/components/gros/action'
import { ButtonLink, buttonClasses } from '@/components/gros/button'
import { Card } from '@/components/gros/card'
import {
  EmailThumb,
  ListRow,
  RowList,
  TextThumb
} from '@/components/gros/list-row'
import { AppPage, CardRow } from '@/components/gros/nav'
import { ErrorState } from '@/components/gros/states'
import {
  stopTracking,
  trackDomain
} from '@/features/library/inspirations/actions'
import type { TrackedDomain } from '@/features/library/reference-library/data'
import { referenceHref } from '@/features/library/reference-library/model'
import { hideBrand } from './actions'
import { FollowForm } from './follow-form'
import type { InspirationSelection, InspirationView } from './read-model'

/**
 * Inspiration (UI-INSa): the brands the workspace follows, brands like the
 * store to follow or hide, and the latest emails to build from, on the
 * GROS components. Following, stopping and hiding are the owner's; staff
 * see the same screen without them. A part that cannot be read says so and
 * the others still show; when nothing can be read, the page is one error
 * with Try again.
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
      {view.unread.includes('library') &&
      view.unread.includes('suggestions') ? (
        <ErrorState
          title="Inspiration did not open"
          reason="We could not read the brands you follow just now. Nothing was changed. Try again in a minute."
          action={<ButtonLink href={inspirationHref} label="Try again" />}
        />
      ) : (
        <>
          <CardRow>
            <FollowedCard view={view} />
            <SuggestionsCard view={view} />
          </CardRow>
          <EmailsCard view={view} timezone={timezone} />
        </>
      )}
    </AppPage>
  )
}

const inspirationHref: Route = '/inspiration'

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
  error: 'Its emails could not be brought in',
  // GROS-INS-002: a real brand Grey Observer is signing up to.
  requested: 'Requested: we are subscribing to its emails',
  subscribed: 'Subscribed: waiting for an email our team rates Exemplary'
}

const perWeek = (n: number) =>
  n < 1 ? 'less than one a week' : `${Math.round(n)} a week`

function FollowedCard({ view }: { view: InspirationView }) {
  const title = 'Brands you follow'
  return (
    <Card label={title}>
      <div className="flex flex-col gap-[var(--space-5)]">
        {/* Stop's answer stays when its row leaves (ActionAnswers). */}
        <ActionAnswers>
          <h2 className="type-heading">{title}</h2>
          {view.unread.includes('library') ? (
            <p className="type-body text-[var(--stone)]">
              The brands you follow could not be read just now. Open Inspiration
              again in a minute.
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
                    wrap
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
        </ActionAnswers>
      </div>
    </Card>
  )
}

function SuggestionsCard({ view }: { view: InspirationView }) {
  const title = 'Brands like yours'
  return (
    <Card label={title}>
      <div className="flex flex-col gap-[var(--space-5)]">
        {/* Hide's and Follow's answers stay when the row leaves. */}
        <ActionAnswers>
          <h2 className="type-heading">{title}</h2>
          {view.unread.includes('suggestions') ? (
            <p className="type-body text-[var(--stone)]">
              Suggestions could not be read just now. Open Inspiration again in
              a minute.
            </p>
          ) : view.suggestions.length === 0 ? (
            <p className="type-body text-[var(--stone)]">
              No suggestions yet. They come from brands of your industry that
              send newsletters.
            </p>
          ) : (
            <RowList label={title}>
              {view.suggestions.map((s) => (
                <ListRow
                  key={s.captureId}
                  thumbnail={<BrandThumb name={s.name} />}
                  title={s.name}
                  wrap
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
                          fields={{ capture: s.captureId, name: s.name }}
                        />
                      </div>
                    ) : null
                  }
                />
              ))}
            </RowList>
          )}
        </ActionAnswers>
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

/** The page's address for a selection; the defaults are left out. */
export function selectionHref(selection: InspirationSelection): Route {
  const params = new URLSearchParams()
  if (selection.source === 'niche') params.set('source', 'niche')
  if (selection.show !== 'all') params.set('show', selection.show)
  if (selection.brand) params.set('brand', selection.brand)
  const query = params.toString()
  return (query ? `${inspirationHref}?${query}` : inspirationHref) as Route
}

/** One choice of a filter: a pill link, lime when it is the current one. */
function FilterLink({
  href,
  label,
  current
}: {
  href: Route
  label: string
  current: boolean
}) {
  return (
    <Link
      href={href}
      aria-current={current ? 'true' : undefined}
      className={buttonClasses(current ? 'lime' : 'outline', 'row')}
    >
      {label}
    </Link>
  )
}

function Filters({ label, children }: { label: string; children: ReactNode }) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-[var(--space-2)]">
      {children}
    </nav>
  )
}

const formatWord = { design: 'Design', text: 'Text' } as const
const showWords = { all: 'All', design: 'Design', text: 'Text' } as const

function EmailsCard({
  view,
  timezone
}: {
  view: InspirationView
  timezone: string
}) {
  const title = 'Latest emails'
  const { selection } = view
  const niche = selection.source === 'niche'
  const filtered = selection.show !== 'all' || !!selection.brand
  const followed = new Set(view.followed)
  const unread = niche
    ? view.unread.includes('niche') || view.unread.includes('suggestions')
    : view.unread.includes('library')
  return (
    <Card label={title}>
      <div className="flex flex-col gap-[var(--space-5)]">
        {/* Follow's answer stays when the row leaves. */}
        <ActionAnswers>
          <h2 className="type-heading">{title}</h2>
          {/* GROS-INS-002: whose emails, which kind, which brand. */}
          <Filters label="Whose emails">
            <FilterLink
              href={selectionHref({
                ...selection,
                source: 'competitors',
                brand: null
              })}
              label="Your competitors"
              current={!niche}
            />
            <FilterLink
              href={selectionHref({
                ...selection,
                source: 'niche',
                brand: null
              })}
              label={view.niche ? `Your niche: ${view.niche}` : 'Your niche'}
              current={niche}
            />
          </Filters>
          <Filters label="Kind of email">
            {(['all', 'design', 'text'] as const).map((show) => (
              <FilterLink
                key={show}
                href={selectionHref({ ...selection, show })}
                label={showWords[show]}
                current={selection.show === show}
              />
            ))}
          </Filters>
          {view.brands.length > 1 || selection.brand ? (
            <Filters label="Brand">
              <FilterLink
                href={selectionHref({ ...selection, brand: null })}
                label="All brands"
                current={!selection.brand}
              />
              {view.brands.map((b) => (
                <FilterLink
                  key={b.domain}
                  href={selectionHref({ ...selection, brand: b.domain })}
                  label={b.name}
                  current={selection.brand === b.domain}
                />
              ))}
            </Filters>
          ) : null}
          {unread ? (
            <p className="type-body text-[var(--stone)]">
              The emails could not be read just now. Open Inspiration again in a
              minute.
            </p>
          ) : view.emails.length === 0 ? (
            <p className="type-body text-[var(--stone)]">
              {filtered
                ? 'No emails match these choices. Choose All to see every email.'
                : niche
                  ? `No emails from brands like yours yet. As our team adds brands${view.niche ? ` in ${view.niche}` : ' of your industry'} and rates their emails Exemplary, they appear here.`
                  : // Only the owner follows brands.
                    view.owner
                    ? 'No emails yet. Follow a brand and its emails arrive here.'
                    : 'No emails yet.'}
            </p>
          ) : (
            <RowList label={title}>
              {view.emails.map((item) => {
                const usable =
                  item.source === 'competitor' &&
                  (!niche || (!!item.domain && followed.has(item.domain)))
                return (
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
                    // A long subject and its sender show whole, on a phone too.
                    wrap
                    details={[
                      item.from,
                      formatWord[item.format],
                      arrived(item.at, timezone),
                      item.source === 'import' ? 'Added by you' : '',
                      item.sample ? 'Sample' : ''
                    ]}
                    end={
                      // UI-USE: Create email follows an email of a brand the
                      // workspace follows (its tagged sections); an email the
                      // owner added has none, so it gets no button here. A
                      // niche brand is followed first (GROS-INS-002).
                      !view.owner ? (
                        <span />
                      ) : usable ? (
                        <ButtonLink
                          href={referenceHref(item) as Route}
                          label="Use this design"
                          kind="outline"
                          size="row"
                        />
                      ) : niche && item.domain && view.slotsLeft > 0 ? (
                        <ActionButton
                          action={trackDomain}
                          label="Follow"
                          kind="outline"
                          size="row"
                          spokenLabel={`Follow: ${item.from || item.domain}`}
                          fields={{ domain: item.domain }}
                        />
                      ) : (
                        <span />
                      )
                    }
                  />
                )
              })}
            </RowList>
          )}
        </ActionAnswers>
      </div>
    </Card>
  )
}
