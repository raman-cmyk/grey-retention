import type { Route } from 'next'
import { ImageIcon } from 'lucide-react'
import { ActionButton } from '@/components/gros/action'
import { ButtonLink } from '@/components/gros/button'
import { Card, Tile } from '@/components/gros/card'
import { DayStrip } from '@/components/gros/day-strip'
import { ListRow, RowList, TextThumb } from '@/components/gros/list-row'
import { AppPage, CardRow, defaultAssistant } from '@/components/gros/nav'
import { Status } from '@/components/gros/status'
import { createEmail } from '@/features/email-build/actions'
import { startPlan } from '@/features/strategy/actions'
import type { HomeSlot, HomeView } from './read-model'

/**
 * Home (UI-HOMEb): the store's numbers, its next 15 days, the next emails,
 * what the agents learned and the offers, on the GROS components. Plan next
 * 15 days and Create email are the owner's clicks (D17); staff see the
 * same screen without them.
 */
export function HomeScreen({
  view,
  assistant = defaultAssistant
}: {
  view: HomeView
  /** The assistant's name (the white label may rename it). */
  assistant?: string
}) {
  return (
    <AppPage current="home" title={view.greeting} assistant={assistant}>
      <CardRow>
        <NumbersCard view={view} />
        <PlanCard view={view} />
      </CardRow>
      <CardRow>
        <NextCard view={view} />
        <div className="flex flex-col gap-[var(--space-5)]">
          <LearnedCard view={view} assistant={assistant} />
          <OffersCard view={view} />
        </div>
      </CardRow>
    </AppPage>
  )
}

/** 20 November → Fri 20 (the plan's days are store days, no clock). */
export function dayWords(date: string) {
  const day = new Date(`${date}T00:00:00Z`)
  return `${day.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })} ${day.getUTCDate()}`
}

/** 18:00 → 6:00 pm. */
export function timeWords(time: string) {
  const [h, m] = time.split(':').map(Number) as [number, number]
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`
}

export function money(value: number, currency: string | null) {
  return currency
    ? new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
        maximumFractionDigits: 0
      }).format(value)
    : new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)
}

const count = (n: number) => new Intl.NumberFormat('en-US').format(n)

function NumbersCard({ view }: { view: HomeView }) {
  const n = view.numbers
  const label = 'Email revenue, last 30 days'
  if (view.unread.includes('numbers'))
    return (
      <Card tone="lime" label={label}>
        <p className="type-label">{label}</p>
        <p className="type-heading mt-[var(--space-3)]">
          The numbers could not be read. Open Home again in a minute.
        </p>
      </Card>
    )
  if (!n)
    return (
      <Card tone="lime" label={label}>
        <p className="type-label">{label}</p>
        <p className="type-title mt-[var(--space-3)]">
          No emails sent in 30 days
        </p>
      </Card>
    )
  return (
    <Card tone="lime" label={label}>
      <div className="flex flex-col gap-[var(--space-6)]">
        <div className="flex flex-col gap-[var(--space-2)]">
          <p className="type-label">{label}</p>
          <p className="type-number-xl">
            {n.revenue === null ? 'Not read yet' : money(n.revenue, n.currency)}
          </p>
          {n.sample || (n.revenue !== null && !n.complete) ? (
            <p className="type-caption">
              {n.sample
                ? 'Sample numbers'
                : `From ${n.revenueEmails} of ${n.emails} emails so far`}
            </p>
          ) : null}
        </div>
        <div className="grid grid-cols-3 gap-[var(--space-3)]">
          <Tile onLime label="Emails" value={count(n.emails)} />
          <Tile onLime label="Opens" value={count(n.opens)} />
          <Tile onLime label="Clicks" value={count(n.clicks)} />
        </div>
      </div>
    </Card>
  )
}

const planHref = '/plan' as Route

function PlanCard({ view }: { view: HomeView }) {
  const plan = view.plan
  const title = 'Your next 15 days'
  if (!plan)
    return (
      <Card label={title}>
        <h2 className="type-heading">{title}</h2>
        <p className="type-body mt-[var(--space-3)] text-[var(--stone)]">
          The plan could not be read. Open it to see where it is.
        </p>
        <div className="mt-[var(--space-6)]">
          <ButtonLink href={planHref} label="Open plan" kind="outline" />
        </div>
      </Card>
    )
  const canPlan =
    view.owner &&
    (plan.state === 'none' ||
      plan.state === 'failed' ||
      plan.state === 'unreadable' ||
      plan.outOfDate ||
      plan.ended)
  // Only the owner can plan again, so only the owner is told to.
  const again = view.owner ? ' Plan the next 15 days again.' : ''
  const note =
    plan.state === 'failed'
      ? (plan.reason ?? 'The plan could not be made.')
      : plan.state === 'unreadable'
        ? `This plan could not be shown.${again}`
        : plan.outOfDate
          ? `These 15 days have begun.${again}`
          : plan.ended
            ? 'These 15 days are over.'
            : null
  return (
    <Card label={title}>
      <div className="flex flex-col gap-[var(--space-6)]">
        <div className="flex flex-wrap items-center justify-between gap-[var(--space-3)]">
          <h2 className="type-heading">{title}</h2>
          {plan.state === 'working' ? (
            <Status kind="working" word="Planning" />
          ) : plan.state === 'offers_ready' ? (
            <Status kind="needs_you" />
          ) : null}
        </div>
        <DayStrip
          start={plan.start}
          days={plan.days.map((d) => ({
            state: d.state,
            href:
              d.state === 'none'
                ? undefined
                : d.buildId
                  ? (`/plan/email/${d.buildId}` as Route)
                  : planHref
          }))}
        />
        {note ? (
          <p
            className={
              plan.state === 'failed' || plan.state === 'unreadable'
                ? 'type-body text-[var(--signal-ink)]'
                : 'type-body text-[var(--stone)]'
            }
          >
            {note}
          </p>
        ) : null}
        {canPlan ? (
          <ActionButton action={startPlan} label="Plan next 15 days" />
        ) : plan.state === 'offers_ready' && view.owner ? (
          <ButtonLink href={planHref} label="Pick the offers" />
        ) : plan.state !== 'none' ? (
          <ButtonLink href={planHref} label="Open plan" kind="outline" />
        ) : null}
      </div>
    </Card>
  )
}

function Thumb({ slot }: { slot: HomeSlot }) {
  if (slot.format === 'text') return <TextThumb />
  // A designed email has no picture until it is made.
  return (
    <span
      aria-hidden
      className="gros-thumb flex shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--mist)] text-[var(--stone)]"
    >
      <ImageIcon size={18} strokeWidth={2} />
    </span>
  )
}

function SlotEnd({
  slot,
  runId,
  next
}: {
  slot: HomeSlot
  runId: string
  next: boolean
}) {
  if (slot.canCreate)
    return (
      <ActionButton
        action={createEmail}
        label={slot.status === 'failed' ? 'Try again' : 'Create email'}
        kind={next ? 'main' : 'outline'}
        size="row"
        fields={{ run: runId, slot: String(slot.slot) }}
      />
    )
  if (slot.status === 'working')
    return <Status kind="working" word={slot.stepWords ?? 'Working'} />
  if (slot.status === 'failed') return <Status kind="needs_you" />
  return <Status kind="planned" />
}

function NextCard({ view }: { view: HomeView }) {
  const plan = view.plan
  const title = 'Next emails'
  const next = plan?.next ?? []
  // The first email the owner can make now is the one that is next.
  const nextSlot = next.find((s) => s.canCreate)?.slot
  return (
    <Card label={title}>
      <div className="flex flex-col gap-[var(--space-5)]">
        <h2 className="type-heading">{title}</h2>
        {next.length === 0 || !plan?.runId ? (
          <p className="type-body text-[var(--stone)]">
            {!plan
              ? 'The plan could not be read. Open Home again in a minute.'
              : plan.state === 'planned'
                ? 'Every planned email is in Klaviyo or its day has passed.'
                : 'No emails planned yet.'}
          </p>
        ) : (
          <RowList label={title}>
            {next.map((slot) => (
              <ListRow
                key={slot.slot}
                next={slot.slot === nextSlot}
                thumbnail={<Thumb slot={slot} />}
                title={slot.title}
                details={[
                  `${dayWords(slot.date)}, ${timeWords(slot.time)}`,
                  slot.audience,
                  slot.status === 'sample_draft' ? 'Sample draft' : '',
                  slot.status === 'failed' ? (slot.reason ?? '') : ''
                ]}
                end={
                  <SlotEnd
                    slot={slot}
                    runId={plan.runId!}
                    next={slot.slot === nextSlot}
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

function LearnedCard({
  view,
  assistant
}: {
  view: HomeView
  assistant: string
}) {
  const title = `What ${assistant} learned`
  return (
    <Card size="small" label={title}>
      <div className="flex flex-col gap-[var(--space-4)]">
        <div className="flex items-center justify-between gap-[var(--space-3)]">
          <h2 className="type-heading">{title}</h2>
          <ButtonLink
            href="/learned"
            label={`Open what ${assistant} learned`}
            kind="round"
          />
        </div>
        {view.unread.includes('learned') ? (
          <p className="type-body text-[var(--stone)]">
            What it learned could not be read just now.
          </p>
        ) : view.learned.length === 0 ? (
          <p className="type-body text-[var(--stone)]">
            Nothing yet. It learns from your emails’ results.
          </p>
        ) : (
          <ul className="flex flex-col gap-[var(--space-2)]">
            {view.learned.map((item) => (
              <li
                key={item.id}
                className="gros-tile flex flex-col gap-[var(--space-1)] rounded-[var(--radius-md)] bg-[var(--mist)]"
              >
                <span
                  className={
                    item.kind === 'dont'
                      ? 'type-label text-[var(--signal-ink)]'
                      : 'type-label text-[var(--stone)]'
                  }
                >
                  {item.kind === 'dont' ? 'Avoid' : 'Do'}
                </span>
                <span className="type-body">{item.rule}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}

const settingsHref = '/settings' as Route

function OffersCard({ view }: { view: HomeView }) {
  const label = 'Biggest discount'
  const o = view.offers
  if (view.unread.includes('offers') || !o)
    return (
      <Card size="small" label={label}>
        <p className="type-label text-[var(--stone)]">{label}</p>
        <p className="type-body mt-[var(--space-2)] text-[var(--stone)]">
          The offers could not be read just now.
        </p>
      </Card>
    )
  return (
    <Card size="small" label={label}>
      <div className="flex flex-wrap items-end justify-between gap-[var(--space-4)]">
        <div className="flex flex-col gap-[var(--space-1)]">
          <p className="type-label text-[var(--stone)]">{label}</p>
          <p className="type-number-lg">
            {o.maxDiscountPercent === null
              ? 'Not set'
              : `${o.maxDiscountPercent}%`}
          </p>
          <p className="type-caption text-[var(--stone)]">
            {o.activeCodes === 1
              ? '1 code running'
              : `${o.activeCodes} codes running`}
          </p>
        </div>
        {view.owner ? (
          o.maxDiscountPercent === null ? (
            <ButtonLink href={settingsHref} label="Set biggest discount" />
          ) : (
            <ButtonLink
              href={settingsHref}
              label="Change"
              kind="quiet"
              size="row"
            />
          )
        ) : null}
      </div>
    </Card>
  )
}
