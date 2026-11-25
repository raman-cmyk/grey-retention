import type { Route } from 'next'
import type { ReactNode } from 'react'
import { ButtonLink } from '@/components/gros/button'
import { Card, Tile } from '@/components/gros/card'
import { ListRow, RowList, TextThumb } from '@/components/gros/list-row'
import { AppPage, CardRow } from '@/components/gros/nav'
import type {
  AudienceDetailView,
  AudienceUse,
  ListDetail,
  SegmentDetail
} from './detail'
import { AudiencesProblemCard, audiencesHref } from './screen'

type Shown<T extends SegmentDetail | ListDetail> = Exclude<
  AudienceDetailView<T>,
  { state: 'not_found' }
>

const count = (n: number) => new Intl.NumberFormat('en-US').format(n)

/**
 * A segment's own page (UI-AUDc) on the GROS components: how many people
 * are in it, its rules in words, its dates and what uses it. The bar's
 * Audiences item stays current, and Back to Audiences leads back.
 */
export function SegmentScreen({
  view,
  owner,
  href
}: {
  view: Shown<SegmentDetail>
  owner: boolean
  /** This page's own address (Try again opens it again). */
  href: Route
}) {
  if (view.state !== 'ready')
    return (
      <Frame title="Segment">
        <AudiencesProblemCard problem={view} owner={owner} retryHref={href} />
      </Frame>
    )
  const segment = view.audience
  return (
    <Frame title={segment.name}>
      <CardRow>
        <PeopleCard
          people={segment.people}
          what="in this segment"
          note={segment.starred ? 'Starred in Klaviyo' : null}
          source={view.source}
        />
        <Card label="Rules">
          <div className="flex flex-col gap-[var(--space-5)]">
            <h2 className="type-heading">Rules</h2>
            <p className="type-body break-words">{segment.rules}</p>
            <p className="type-caption text-[var(--stone)]">
              {segment.active
                ? 'Klaviyo adds and removes people as they match these rules.'
                : 'Klaviyo is not keeping this segment up to date, so who is in it may be old.'}
            </p>
          </div>
        </Card>
      </CardRow>
      <CardRow>
        <DatesCard audience={segment} />
        <UsedByCard
          uses={segment.usedBy}
          empty="No campaign uses this segment yet."
        />
      </CardRow>
    </Frame>
  )
}

/**
 * A list's own page (UI-AUDc) on the GROS components: how many people are
 * on it, how they join, its dates and the flows and campaigns that use it.
 */
export function ListScreen({
  view,
  owner,
  href
}: {
  view: Shown<ListDetail>
  owner: boolean
  /** This page's own address (Try again opens it again). */
  href: Route
}) {
  if (view.state !== 'ready')
    return (
      <Frame title="List">
        <AudiencesProblemCard problem={view} owner={owner} retryHref={href} />
      </Frame>
    )
  const list = view.audience
  return (
    <Frame title={list.name}>
      <CardRow>
        <PeopleCard
          people={list.people}
          what="on this list"
          note={null}
          source={view.source}
        />
        <Card label="Sign-up">
          <div className="flex flex-col gap-[var(--space-5)]">
            <h2 className="type-heading">Sign-up</h2>
            <div className="flex flex-col gap-[var(--space-1)]">
              <p className="type-body-strong">{list.signUp.label}</p>
              <p className="type-body text-[var(--stone)]">
                {list.signUp.line}
              </p>
            </div>
            <p className="type-caption text-[var(--stone)]">
              People are on a list because they joined it; it does not change by
              rules.
            </p>
          </div>
        </Card>
      </CardRow>
      <CardRow>
        <DatesCard audience={list} />
        <UsedByCard
          uses={list.usedBy}
          empty="No flow or campaign uses this list yet."
        />
      </CardRow>
    </Frame>
  )
}

/** The page: Audiences current in the bar, and the way back on top. */
function Frame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <AppPage current="audiences" title={title}>
      <div>
        <ButtonLink
          href={audiencesHref}
          label="Back to Audiences"
          kind="quiet"
        />
      </div>
      {children}
    </AppPage>
  )
}

/** The one big number: how many people, and where it comes from. */
function PeopleCard({
  people,
  what,
  note,
  source
}: {
  people: number
  /** "in this segment", "on this list". */
  what: string
  note: string | null
  /** Where the number comes from (sample data today), on the card. */
  source: string
}) {
  const label = 'People'
  return (
    <Card label={label}>
      <div className="flex flex-col gap-[var(--space-5)]">
        <div className="flex flex-col gap-[var(--space-1)]">
          <h2 className="type-label text-[var(--stone)]">{label}</h2>
          <p className="type-number-lg break-words">{count(people)}</p>
          <p className="type-caption text-[var(--stone)]">
            {people === 1 ? `person ${what}` : `people ${what}`}
          </p>
        </div>
        {note ? <p className="type-body">{note}</p> : null}
        <p className="type-caption text-[var(--stone)]">{source}</p>
      </div>
    </Card>
  )
}

/** When Klaviyo made it and last changed it. */
function DatesCard({ audience }: { audience: SegmentDetail | ListDetail }) {
  const title = 'Dates'
  const { created, updated } = audience
  return (
    <Card label={title}>
      <div className="flex flex-col gap-[var(--space-5)]">
        <h2 className="type-heading">{title}</h2>
        <div className="grid grid-cols-1 gap-[var(--space-3)] sm:grid-cols-2">
          <Tile label="Created" value={created?.date ?? 'Not known'} />
          <Tile label="Last changed" value={updated?.date ?? 'Not known'} />
        </div>
        <p className="type-caption break-words text-[var(--stone)]">
          {[
            created ? `Created ${created.ago}` : '',
            updated ? `changed ${updated.ago}` : ''
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>
    </Card>
  )
}

/** The campaigns and flows that use it, by name and what they do with it. */
function UsedByCard({ uses, empty }: { uses: AudienceUse[]; empty: string }) {
  const title = 'Used by'
  return (
    <Card label={title}>
      <div className="flex flex-col gap-[var(--space-5)]">
        <h2 className="type-heading">{title}</h2>
        {uses.length ? (
          <RowList label={title}>
            {uses.map((use) => (
              <ListRow
                key={use.key}
                thumbnail={<TextThumb />}
                title={use.name}
                wrap
                details={use.details}
                // Its own page under Results (UI-KLV).
                end={
                  <ButtonLink
                    href={use.href}
                    label="Open"
                    kind="outline"
                    size="row"
                  />
                }
              />
            ))}
          </RowList>
        ) : (
          <p className="type-body text-[var(--stone)]">{empty}</p>
        )}
      </div>
    </Card>
  )
}
