import type { Route } from 'next'
import type { ReactNode } from 'react'
import { Clock3, Users } from 'lucide-react'
import { ButtonLink } from '@/components/gros/button'
import { Card, Tile } from '@/components/gros/card'
import { ListRow, RowList, TextThumb } from '@/components/gros/list-row'
import { AppPage, CardRow } from '@/components/gros/nav'
import { EmptyState, ErrorState } from '@/components/gros/states'
import type { AudiencesProblem } from '@/features/audiences/read-model'
import { connectKlaviyoHref } from '@/features/audiences/screen'
import type { SafePreview } from '@/features/email-generation/safe-preview'
import type {
  AudienceLink,
  CampaignDetail,
  FlowDetail,
  FlowEmailDetail,
  KlaviyoDate,
  KlaviyoDetailView,
  MetricDetail
} from './detail'
import { resultsHref } from './hrefs'

/**
 * The pages of Klaviyo's own campaigns, flows, flow emails and metrics
 * (UI-KLV) on the GROS components. They read what Klaviyo did, so the
 * bar's Results item stays current and Back to Results (or Back to the
 * flow) leads back. No commands: changes are made in Klaviyo.
 */
type Shown<T> = Exclude<KlaviyoDetailView<T>, { state: 'not_found' }>

type Page<T> = {
  view: Shown<T>
  owner: boolean
  /** This page's own address (Try again opens it again). */
  href: Route
}

/** A Klaviyo campaign: when and how it is sent, how it did, who, what. */
export function CampaignScreen({ view, owner, href }: Page<CampaignDetail>) {
  if (view.state !== 'ready')
    return <Problem title="Campaign" problem={view} owner={owner} href={href} />
  const c = view.item
  return (
    <Frame title={c.name}>
      <CardRow>
        <Card label={c.words.how}>
          <div className="flex flex-col gap-[var(--space-5)]">
            <h2 className="type-heading">{c.words.how}</h2>
            <div className="grid grid-cols-1 gap-[var(--space-3)] sm:grid-cols-2">
              <Tile label="Status" value={c.status} />
              <Tile
                label={c.words.timeLabel ?? 'Send time'}
                value={c.sendTime ?? 'Not scheduled'}
              />
            </div>
            {c.strategy ? (
              <div className="flex flex-col gap-[var(--space-1)]">
                <p className="type-body-strong">{c.strategy.label}</p>
                <p className="type-body text-[var(--stone)]">
                  {c.strategy.line}
                  {c.localTime
                    ? ' Sent in each recipient’s own time zone.'
                    : ''}
                </p>
              </div>
            ) : (
              <p className="type-body text-[var(--stone)]">
                No send time is set yet.
              </p>
            )}
            <p className="type-caption break-words text-[var(--stone)]">
              {[
                c.sendTime ? `Times in ${c.zone}` : '',
                c.created ? `Created ${c.created}` : ''
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
        </Card>
        <StatsCard campaign={c} source={view.source} />
      </CardRow>
      <Card label={c.words.who}>
        <div className="flex flex-col gap-[var(--space-5)]">
          <div className="flex flex-col gap-[var(--space-1)]">
            <h2 className="type-heading">{c.words.who}</h2>
            <p className="type-body text-[var(--stone)]">{c.words.whoLine}</p>
          </div>
          {c.included.length || c.excluded.length ? (
            <RowList label={c.words.who}>
              {[...c.included, ...c.excluded].map((a) => (
                <AudienceRow key={a.key} audience={a} />
              ))}
            </RowList>
          ) : (
            <p className="type-body text-[var(--stone)]">
              No list or segment is set yet.
            </p>
          )}
        </div>
      </Card>
      <Card label={c.words.what}>
        <div className="flex flex-col gap-[var(--space-5)]">
          <h2 className="type-heading">{c.words.what}</h2>
          <Facts
            facts={[
              ['Subject', c.subject],
              ['Preview text', c.previewText],
              ['From', c.from],
              ['Template', c.templateName]
            ]}
          />
          <EmailPreview preview={c.preview} title={`Preview of ${c.name}`} />
        </div>
      </Card>
    </Frame>
  )
}

/** How a campaign did, or why it has no numbers yet. */
function StatsCard({
  campaign: c,
  source
}: {
  campaign: CampaignDetail
  source: string
}) {
  const title = 'How it did'
  if (!c.stats)
    return (
      <Card label={title}>
        <div className="flex flex-col gap-[var(--space-5)]">
          <h2 className="type-heading">{title}</h2>
          <p className="type-body text-[var(--stone)]">
            {c.status === 'Cancelled'
              ? 'It was cancelled, so it has no numbers.'
              : c.status === 'Sent'
                ? 'Klaviyo has no numbers for it yet.'
                : 'Klaviyo has numbers once it is sent.'}
          </p>
          <p className="type-caption text-[var(--stone)]">{source}</p>
        </div>
      </Card>
    )
  const s = c.stats
  return (
    <Card label={title}>
      <div className="flex flex-col gap-[var(--space-5)]">
        <div className="flex flex-col gap-[var(--space-1)]">
          <h2 className="type-label text-[var(--stone)]">Sent to</h2>
          <p className="type-number-lg break-words">{s.recipients}</p>
          <p className="type-caption text-[var(--stone)]">people</p>
        </div>
        <div className="grid grid-cols-2 gap-[var(--space-3)]">
          <Tile label="Open rate" value={s.opened} />
          <Tile label="Click rate" value={s.clicked} />
          <Tile label="Orders" value={s.orders} />
          <Tile label="Sales" value={s.sales} />
        </div>
        <p className="type-caption text-[var(--stone)]">{source}</p>
      </div>
    </Card>
  )
}

function AudienceRow({ audience: a }: { audience: AudienceLink }) {
  return (
    <ListRow
      thumbnail={
        <IconThumb>
          <Users size={18} strokeWidth={2} />
        </IconThumb>
      }
      title={a.name}
      wrap
      details={a.href ? a.details : [...a.details, 'No longer in Klaviyo']}
      end={
        a.href ? (
          <ButtonLink href={a.href} label="Open" kind="outline" size="row" />
        ) : null
      }
    />
  )
}

/** A flow: what it earned, what starts it, its waits and emails, dates. */
export function FlowScreen({ view, owner, href }: Page<FlowDetail>) {
  if (view.state !== 'ready')
    return <Problem title="Flow" problem={view} owner={owner} href={href} />
  const f = view.item
  return (
    <Frame title={f.name}>
      <CardRow>
        <Card label="Sales">
          <div className="flex flex-col gap-[var(--space-5)]">
            <div className="flex flex-col gap-[var(--space-1)]">
              <h2 className="type-label text-[var(--stone)]">
                Sales · 30 days
              </h2>
              <p className="type-number-lg break-words">{f.sales}</p>
              <p className="type-caption text-[var(--stone)]">
                from this flow in the last 30 days
              </p>
            </div>
            <div className="grid grid-cols-2 gap-[var(--space-3)]">
              <Tile label="Status" value={f.live ? 'Live' : 'Draft'} />
              <Tile label="Emails" value={f.emails} />
            </div>
            {f.notLive ? <p className="type-body">{f.notLive}</p> : null}
            <p className="type-caption text-[var(--stone)]">{view.source}</p>
          </div>
        </Card>
        <Card label="What starts it">
          <div className="flex flex-col gap-[var(--space-5)]">
            <h2 className="type-heading">What starts it</h2>
            <div className="flex flex-col gap-[var(--space-1)]">
              <p className="type-body-strong break-words">{f.trigger.label}</p>
              <p className="type-body text-[var(--stone)]">{f.trigger.line}</p>
            </div>
            {f.trigger.href ? (
              <div>
                <ButtonLink
                  href={f.trigger.href}
                  label={f.trigger.open}
                  kind="outline"
                />
              </div>
            ) : null}
          </div>
        </Card>
      </CardRow>
      <Card label="Steps">
        <div className="flex flex-col gap-[var(--space-5)]">
          <h2 className="type-heading">Steps</h2>
          {f.steps.length ? (
            <RowList label="Steps">
              {f.steps.map((step) =>
                step.kind === 'wait' ? (
                  <ListRow
                    key={step.key}
                    thumbnail={
                      <IconThumb>
                        <Clock3 size={18} strokeWidth={2} />
                      </IconThumb>
                    }
                    title="Wait"
                    wrap
                    details={[step.text]}
                    end={null}
                  />
                ) : (
                  <ListRow
                    key={step.key}
                    thumbnail={<TextThumb />}
                    title={step.subject}
                    wrap
                    details={[
                      step.name,
                      step.live ? 'Live' : 'Draft',
                      `From ${step.from}`
                    ]}
                    end={
                      <ButtonLink
                        href={step.href}
                        label="Open"
                        kind="outline"
                        size="row"
                      />
                    }
                  />
                )
              )}
            </RowList>
          ) : (
            <p className="type-body text-[var(--stone)]">
              This flow has no emails yet.
            </p>
          )}
        </div>
      </Card>
      <DatesCard created={f.created} updated={f.updated} />
    </Frame>
  )
}

/** One email of a flow: who it is from, when it goes, and the email. */
export function FlowEmailScreen({ view, owner, href }: Page<FlowEmailDetail>) {
  if (view.state !== 'ready')
    return (
      <Problem title="Flow email" problem={view} owner={owner} href={href} />
    )
  const m = view.item
  return (
    <Frame
      title={m.subject}
      back={{ href: m.flow.href, label: 'Back to the flow' }}
    >
      <Card label="About this email">
        <div className="flex flex-col gap-[var(--space-5)]">
          <h2 className="type-heading">About this email</h2>
          <div className="grid grid-cols-1 gap-[var(--space-3)] sm:grid-cols-2">
            <Tile label="Status" value={m.live ? 'Live' : 'Draft'} />
            <Tile label="Sent after" value={m.wait ?? 'Right away'} />
          </div>
          <Facts
            facts={[
              ['Flow', m.flow.name],
              ['Name in Klaviyo', m.name],
              ['Preview text', m.previewText],
              ['From', m.from],
              ['Reply to', m.replyTo ?? 'Not set'],
              ['Template', m.templateName],
              [
                'Template changed',
                m.templateChanged
                  ? `${m.templateChanged} (${m.zone})`
                  : 'Not known'
              ]
            ]}
          />
          <p className="type-caption text-[var(--stone)]">{view.source}</p>
        </div>
      </Card>
      <Card label="The email">
        <div className="flex flex-col gap-[var(--space-5)]">
          <h2 className="type-heading">The email</h2>
          <EmailPreview preview={m.preview} title={`Preview of ${m.subject}`} />
        </div>
      </Card>
    </Frame>
  )
}

/** A metric: what it counts, how often, where from, and what it starts. */
export function MetricScreen({ view, owner, href }: Page<MetricDetail>) {
  if (view.state !== 'ready')
    return <Problem title="Metric" problem={view} owner={owner} href={href} />
  const m = view.item
  return (
    <Frame title={m.name}>
      <CardRow>
        <Card label="Events">
          <div className="flex flex-col gap-[var(--space-5)]">
            <div className="flex flex-col gap-[var(--space-1)]">
              <h2 className="type-label text-[var(--stone)]">
                Events · 30 days
              </h2>
              <p className="type-number-lg break-words">{m.events}</p>
              <p className="type-caption text-[var(--stone)]">
                times it happened in the last 30 days
              </p>
            </div>
            <p className="type-body">{m.measures}</p>
            <p className="type-caption text-[var(--stone)]">{view.source}</p>
          </div>
        </Card>
        <Card label="Where it comes from">
          <div className="flex flex-col gap-[var(--space-5)]">
            <h2 className="type-heading">Where it comes from</h2>
            <div className="grid grid-cols-1 gap-[var(--space-3)] sm:grid-cols-2">
              <Tile label="From" value={m.from} />
              <Tile label="Kind" value={m.kind} />
            </div>
            <p className="type-caption text-[var(--stone)]">
              {m.since
                ? `Counted since ${m.since}`
                : 'Counted since: not known'}
            </p>
          </div>
        </Card>
      </CardRow>
      <Card label="Flows it starts">
        <div className="flex flex-col gap-[var(--space-5)]">
          <h2 className="type-heading">Flows it starts</h2>
          {m.flows.length ? (
            <RowList label="Flows it starts">
              {m.flows.map((f) => (
                <ListRow
                  key={f.key}
                  thumbnail={<TextThumb />}
                  title={f.name}
                  wrap
                  details={f.details}
                  end={
                    <ButtonLink
                      href={f.href}
                      label="Open"
                      kind="outline"
                      size="row"
                    />
                  }
                />
              ))}
            </RowList>
          ) : (
            <p className="type-body text-[var(--stone)]">
              No flow starts with this metric.
            </p>
          )}
        </div>
      </Card>
    </Frame>
  )
}

/** The page: Results current in the bar, and the way back on top. */
function Frame({
  title,
  back = { href: resultsHref, label: 'Back to Results' },
  children
}: {
  title: string
  back?: { href: Route; label: string }
  children: ReactNode
}) {
  return (
    <AppPage current="results" title={title}>
      <div>
        <ButtonLink href={back.href} label={back.label} kind="quiet" />
      </div>
      {children}
    </AppPage>
  )
}

/**
 * Why Klaviyo cannot be shown, with the one button that fixes it: the
 * owner connects or reconnects Klaviyo on Settings; staff are told who
 * does; a failed read can be tried again.
 */
export function Problem({
  title,
  problem,
  owner,
  href
}: {
  /** The page's title: Campaign, Flow, Flow email, Metric. */
  title: string
  problem: AudiencesProblem
  owner: boolean
  href: Route
}) {
  return (
    <Frame title={title}>
      <ProblemCard problem={problem} owner={owner} retryHref={href} />
    </Frame>
  )
}

function ProblemCard({
  problem,
  owner,
  retryHref
}: {
  problem: AudiencesProblem
  owner: boolean
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
          The store’s owner connects Klaviyo. Its campaigns, flows and metrics
          then show here.
        </p>
      </Card>
    )
  if (problem.state === 'reconnect')
    return (
      <ErrorState
        title="Klaviyo key stopped working"
        reason={
          owner
            ? 'Reconnect Klaviyo with a new private key to see this page.'
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
      title="Klaviyo could not be read"
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

/** Label and text pairs, grouped by space (no lines, no boxes). */
function Facts({ facts }: { facts: [label: string, value: string][] }) {
  return (
    <dl className="grid grid-cols-1 gap-[var(--space-4)] sm:grid-cols-2">
      {facts.map(([label, value]) => (
        <div key={label} className="flex flex-col gap-[var(--space-1)]">
          <dt className="type-label text-[var(--stone)]">{label}</dt>
          <dd className="type-body break-words">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** When Klaviyo made it and last changed it. */
function DatesCard({
  created,
  updated
}: {
  created: KlaviyoDate
  updated: KlaviyoDate
}) {
  const title = 'Dates'
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

/**
 * The email as Klaviyo stores it, sanitized on the server (links off,
 * nothing loads from the web) and shown in a sandboxed frame. The store's
 * own colors and fonts appear only here (BRAND.md rule 11).
 */
function EmailPreview({
  preview,
  title
}: {
  preview: SafePreview | null
  title: string
}) {
  if (!preview)
    return (
      <p className="type-body text-[var(--stone)]">
        A plain-text email: there is no design to show.
      </p>
    )
  return (
    <>
      <iframe
        title={title}
        sandbox=""
        referrerPolicy="no-referrer"
        srcDoc={preview.html}
        className="h-[36rem] w-full max-w-[600px] rounded-[var(--radius-md)] bg-[var(--white)]"
      />
      <p className="type-caption text-[var(--stone)]">
        Links are turned off in this preview, and outside pictures and fonts do
        not load.
      </p>
    </>
  )
}

function IconThumb({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden
      className="gros-thumb flex shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--mist)] text-[var(--stone)]"
    >
      {children}
    </span>
  )
}
