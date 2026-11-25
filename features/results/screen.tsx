import { ButtonLink } from '@/components/gros/button'
import { Card, Tile } from '@/components/gros/card'
import { ListRow, RowList, TextThumb } from '@/components/gros/list-row'
import { AppPage, CardRow } from '@/components/gros/nav'
import { Status, type StatusKind } from '@/components/gros/status'
import { EmptyState, ErrorState } from '@/components/gros/states'
import type { KlaviyoResults, KlaviyoRow } from './klaviyo'
import type { ResultEmail, ResultsScreen as View } from './results-screen'

/**
 * Results (UI-RES-b): every email GROS put into Klaviyo with its numbers
 * and its A versus B result, drawn from the read model (UI-RES-a) on the
 * GROS components. A read, no commands (master handoff section 11).
 */
export function ResultsScreen({
  view,
  klaviyo = null
}: {
  view: View
  /**
   * Klaviyo's own campaigns, flows and metrics (UI-KLV), or null when
   * Klaviyo cannot be read (Settings says why).
   */
  klaviyo?: KlaviyoResults | null
}) {
  return (
    <AppPage current="results" title="Results">
      {view.kind === 'error' ? (
        <ErrorState
          title="Results did not open"
          reason="We could not read your results just now. Your emails are safe in Klaviyo."
          action={<ButtonLink href="/results" label="Try again" />}
        />
      ) : view.kind === 'empty' ? (
        <EmptyState
          title="No results yet"
          action={<ButtonLink href="/plan" label="Plan next 15 days" />}
        />
      ) : (
        <>
          <CardRow>
            <CountsCard view={view} />
            <TestsCard emails={view.emails} />
          </CardRow>
          <EmailsCard view={view} />
        </>
      )}
      {klaviyo ? <InKlaviyo klaviyo={klaviyo} /> : null}
    </AppPage>
  )
}

/**
 * What Klaviyo itself has (UI-KLV): its campaigns, flows and metrics, each
 * row opening its own page under Results.
 */
function InKlaviyo({ klaviyo }: { klaviyo: KlaviyoResults }) {
  return (
    <>
      <KlaviyoCard
        title="Klaviyo campaigns"
        empty="No campaigns in Klaviyo yet."
        source={klaviyo.source}
        rows={klaviyo.campaigns}
      />
      <CardRow>
        <KlaviyoCard
          title="Flows"
          empty="No flows in Klaviyo yet."
          source={klaviyo.source}
          rows={klaviyo.flows}
        />
        <KlaviyoCard
          title="Metrics"
          empty="No metrics in Klaviyo yet."
          source={klaviyo.source}
          rows={klaviyo.metrics}
        />
      </CardRow>
    </>
  )
}

function KlaviyoCard({
  title,
  empty,
  source,
  rows
}: {
  title: string
  empty: string
  /** Where its numbers come from (sample data today), on the card. */
  source: string
  rows: KlaviyoRow[]
}) {
  return (
    <Card label={title}>
      <div className="flex flex-col gap-[var(--space-5)]">
        <div className="flex flex-col gap-[var(--space-1)]">
          <h2 className="type-heading">{title}</h2>
          <p className="type-caption text-[var(--stone)]">{source}</p>
        </div>
        {rows.length ? (
          <RowList label={title}>
            {rows.map((row) => (
              <ListRow
                key={row.key}
                thumbnail={<TextThumb />}
                title={row.title}
                // A long name and its details show whole, on a phone too.
                wrap
                details={row.details}
                end={
                  <ButtonLink
                    href={row.href}
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

type Results = Extract<View, { kind: 'results' }>

/** The emails by state, the one number on the lime card; samples apart. */
function CountsCard({ view }: { view: Results }) {
  const label = 'Your emails'
  const { sent, scheduled, draft, sample, other } = view.counts
  return (
    <Card tone="lime" label={label}>
      <h2 className="type-label">{label}</h2>
      <p className="type-number-xl">{sent}</p>
      <p className="type-caption">
        {sent === 1 ? 'email sent' : 'emails sent'}
      </p>
      <div className="mt-[var(--space-6)] grid grid-cols-3 gap-[var(--space-4)]">
        <Tile onLime label="Scheduled" value={scheduled} />
        <Tile onLime label="Drafts" value={draft} />
        <Tile onLime label="Not sent" value={other} />
      </div>
      {sample > 0 && (
        <p className="type-caption mt-[var(--space-5)]">
          {view.sample
            ? 'These are the sample store’s emails: none was sent, and their numbers are examples.'
            : `${sample === 1 ? 'One sample email' : `${sample} sample emails`} below ${sample === 1 ? 'was' : 'were'} never sent: ${sample === 1 ? 'its' : 'their'} numbers are examples.`}
        </p>
      )}
    </Card>
  )
}

/** Each A versus B test and which version won, in words. */
function TestsCard({ emails }: { emails: readonly ResultEmail[] }) {
  const title = 'A versus B'
  const tests = emails.filter((e) => e.ab)
  return (
    <Card label={title}>
      <h2 className="type-heading">{title}</h2>
      {tests.length ? (
        <ul className="mt-[var(--space-5)] flex flex-col gap-[var(--space-4)]">
          {tests.map((e) => (
            <li key={e.buildId} className="flex flex-col gap-[var(--space-1)]">
              <p className="type-body-strong truncate">{e.title}</p>
              <p className="type-body text-[var(--stone)]">
                {e.sample ? `An example: ${e.ab!.verdict}` : e.ab!.verdict}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="type-body mt-[var(--space-3)] text-[var(--stone)]">
          No email has two versions yet.
        </p>
      )}
    </Card>
  )
}

/**
 * A Results row's pill, one of BRAND.md's four: sent, scheduled, a draft
 * and a cancelled email are in Klaviyo; a sample is Planned (as on Home,
 * never In Klaviyo). A deleted email or one not sent has no pill (nothing
 * to do, and none of the four is true): its status is in its words.
 */
export function pillOf(e: ResultEmail): StatusKind | null {
  if (e.state === 'sample') return 'planned'
  if (e.state !== 'other') return 'in_klaviyo'
  return e.status === 'cancelled' ? 'in_klaviyo' : null
}

/**
 * The row's one line: its day and status, then how sure the numbers are
 * (before the numbers, so a cut line keeps it), then the numbers. A
 * sample says first that it was never sent, and shows no sales.
 */
export function rowDetails(e: ResultEmail): string[] {
  const n = e.numbers
  if (e.sample)
    return [
      e.day ?? '',
      'Sample, never sent: example numbers',
      ...(n
        ? [
            `${n.sent} people`,
            n.opened ? `${n.opened} opened` : '',
            n.clicked ? `${n.clicked} clicked` : ''
          ]
        : [])
    ].filter(Boolean)
  return [
    e.day ?? '',
    e.statusText,
    e.note ?? '',
    ...(n
      ? [
          `${n.sent} sent`,
          n.opened ? `${n.opened} opened` : '',
          n.clicked ? `${n.clicked} clicked` : '',
          n.sales
            ? n.orders
              ? `${n.sales} from ${n.orders} ${n.orders === '1' ? 'order' : 'orders'}`
              : `${n.sales} in sales`
            : ''
        ]
      : []),
    e.topSection ?? ''
  ].filter(Boolean)
}

/** The row's pill, or an empty end when none of the four is true. */
function Pill({ email }: { email: ResultEmail }) {
  const kind = pillOf(email)
  return kind ? <Status kind={kind} /> : <span aria-hidden />
}

function EmailsCard({ view }: { view: Results }) {
  const title = 'Every email'
  return (
    <Card label={title}>
      <h2 className="type-heading">{title}</h2>
      <div className="mt-[var(--space-5)]">
        <RowList label={title}>
          {view.emails.map((e) => (
            <ListRow
              key={e.buildId}
              thumbnail={<TextThumb />}
              title={e.title}
              details={rowDetails(e)}
              end={<Pill email={e} />}
            />
          ))}
        </RowList>
      </div>
    </Card>
  )
}
