import type { Route } from 'next'
import { ActionButton } from '@/components/gros/action'
import { ButtonLink } from '@/components/gros/button'
import { Card } from '@/components/gros/card'
import { DayStrip, type Day } from '@/components/gros/day-strip'
import { ListRow, RowList, TextThumb } from '@/components/gros/list-row'
import { AppPage, CardRow } from '@/components/gros/nav'
import { Progress } from '@/components/gros/progress'
import { Status } from '@/components/gros/status'
import { EmptyState, ErrorState } from '@/components/gros/states'
import { createEmail } from '@/features/email-build/actions'
import { startPlan } from './actions'
import { OfferPick } from './offer-pick'
import type { PlanEmail, PlanScreen as View } from './plan-screen'
import { KeepFresh } from './refresh'

/**
 * Plan (UI-PLAN-b): the plan read model (UI-PLAN-a) on the GROS
 * components. Plan next 15 days, the offer pick and Create email are the
 * owner's clicks (D17); staff see the same screen without them.
 */
export function PlanScreen({ view }: { view: View }) {
  return (
    <AppPage current="plan" title="Plan">
      <Body view={view} />
    </AppPage>
  )
}

const ownerOnly = (
  <p className="type-body text-[var(--stone)]">
    Only this workspace’s owner can plan.
  </p>
)
const planButton = (label: string, kind: 'main' | 'outline' = 'main') => (
  <ActionButton action={startPlan} label={label} kind={kind} />
)

function Body({ view }: { view: View }) {
  switch (view.kind) {
    case 'empty':
      return (
        <EmptyState
          title="No plan yet"
          action={view.canPlan ? planButton('Plan next 15 days') : ownerOnly}
        />
      )
    case 'planning':
      return (
        <Card>
          <Progress
            title="Planning your next 15 days"
            steps={view.steps.map((s) => ({ text: s.label, state: s.state }))}
          />
          <KeepFresh />
        </Card>
      )
    case 'failed':
      return (
        <ErrorState
          title="The plan was not made"
          reason={view.reason}
          action={view.canPlan ? planButton('Try again') : ownerOnly}
        />
      )
    case 'restart':
      return (
        <ErrorState
          title="These 15 days have begun"
          reason={view.reason}
          action={view.canPlan ? planButton('Plan next 15 days') : ownerOnly}
        />
      )
    case 'offers':
      return <Offers view={view} />
    case 'plan':
      return <Plan view={view} />
  }
}

function Offers({ view }: { view: Extract<View, { kind: 'offers' }> }) {
  const title = `What matters from ${view.days}`
  return (
    <CardRow>
      <Card label={title}>
        <h2 className="type-heading">{title}</h2>
        {view.sample && (
          <p className="type-caption mt-[var(--space-3)] text-[var(--stone)]">
            Made from the sample store until your own store is connected.
          </p>
        )}
        <p className="type-body mt-[var(--space-4)]">{view.summary}</p>
        <ul className="mt-[var(--space-5)] flex flex-col gap-[var(--space-4)]">
          {view.highlights.map((h) => (
            <li key={h.fact} className="flex flex-col gap-[var(--space-1)]">
              <p className="type-body-strong">{h.fact}</p>
              <p className="type-body text-[var(--stone)]">{h.why}</p>
            </li>
          ))}
        </ul>
      </Card>
      <Card label="Which offers should we run?">
        <h2 className="type-heading">Which offers should we run?</h2>
        {view.leftOut.length > 0 && (
          <ul className="mt-[var(--space-3)] flex flex-col gap-[var(--space-1)]">
            {view.leftOut.map((l) => (
              <li key={l} className="type-caption text-[var(--stone)]">
                {l}
              </li>
            ))}
          </ul>
        )}
        {view.none && (
          <p className="type-body mt-[var(--space-3)]">{view.none}</p>
        )}
        <div className="mt-[var(--space-6)]">
          {view.canPick ? (
            <OfferPick runId={view.runId} offers={view.offers} />
          ) : (
            <p className="type-body text-[var(--stone)]">
              Only this workspace’s owner chooses the offers.
            </p>
          )}
        </div>
      </Card>
    </CardRow>
  )
}

/** A day of the strip: a sample draft looks planned (BRAND.md’s four). */
const dayOf = (d: Extract<View, { kind: 'plan' }>['days'][number]): Day => ({
  state: d.state === 'sample_draft' ? 'planned' : d.state
})

function Plan({ view }: { view: Extract<View, { kind: 'plan' }> }) {
  const working = view.emails
    .filter((e) => e.status.kind === 'working')
    .map((e) => e.slot)
  const needsYou = view.emails.filter((e) => e.status.kind === 'needs_you')
  const counts = [
    `${view.counts.inKlaviyo} in Klaviyo`,
    ...(view.counts.sampleDrafts
      ? [
          `${view.counts.sampleDrafts} sample ${view.counts.sampleDrafts === 1 ? 'draft' : 'drafts'}`
        ]
      : []),
    `${view.counts.planned} planned`
  ].join(' · ')
  return (
    <>
      <Card label="Your next 15 days">
        <div className="flex flex-wrap items-start justify-between gap-[var(--space-4)]">
          <div>
            <h2 className="type-heading">Your next 15 days</h2>
            <p
              aria-live="polite"
              className="type-caption mt-[var(--space-2)] text-[var(--stone)]"
            >
              {counts}
            </p>
          </div>
          {view.canPlan && planButton('Plan again', 'outline')}
        </div>
        <div className="mt-[var(--space-6)]">
          <DayStrip start={view.startOn} days={view.days.map(dayOf)} />
        </div>
        {
          <ul className="mt-[var(--space-5)] flex flex-col gap-[var(--space-2)]">
            {view.sample && (
              <li className="type-caption text-[var(--stone)]">
                Planned from the sample store until your own store is connected:
                the products and offers are examples.
              </li>
            )}
            <li className="type-caption text-[var(--stone)]">
              Send times are your store’s time.
            </li>
            {view.noAi && (
              <li className="type-caption text-[var(--stone)]">
                Planned from the store’s facts and similar brands’ timing: the
                AI was not used for this plan.
              </li>
            )}
            {view.notes.map((n) => (
              <li key={n} className="type-caption text-[var(--stone)]">
                {n}
              </li>
            ))}
          </ul>
        }
      </Card>
      <Card label="The emails">
        <h2 className="type-heading">The emails</h2>
        {view.none ? (
          <p className="type-body mt-[var(--space-3)]">{view.none}</p>
        ) : (
          <div className="mt-[var(--space-5)]">
            <RowList label="The emails">
              {view.emails.map((e) => (
                <ListRow
                  key={e.slot}
                  thumbnail={<TextThumb />}
                  title={e.title}
                  details={emailDetails(e)}
                  next={e.next}
                  end={<EmailEnd email={e} runId={view.runId} />}
                />
              ))}
            </RowList>
          </div>
        )}
        {needsYou.length > 0 && (
          <ul
            aria-label="What needs you"
            className="mt-[var(--space-5)] flex flex-col gap-[var(--space-2)]"
          >
            {needsYou.map((e) => (
              <li key={e.slot} className="type-body text-[var(--signal-ink)]">
                {`${e.day}, ${e.title}: ${e.status.kind === 'needs_you' ? e.status.reason : ''}`}
              </li>
            ))}
          </ul>
        )}
        {working.length > 0 && <KeepFresh key={working.join(',')} />}
      </Card>
    </>
  )
}

/** The row's line: its day, time, audience and offer, then what to know. */
export function emailDetails(e: PlanEmail): string[] {
  return [
    ...e.details,
    ...(e.status.kind === 'sample_draft'
      ? ['Sample draft, not in Klaviyo']
      : []),
    ...(e.status.kind === 'in_klaviyo' ? ['In Klaviyo as a draft'] : []),
    ...(e.status.kind === 'needs_you' ? [e.status.reason] : []),
    e.why
  ]
}

/** The row's one action, else its status (a sample draft looks planned). */
function EmailEnd({ email: e, runId }: { email: PlanEmail; runId: string }) {
  const action = e.action
  if (action?.kind === 'create')
    return (
      <ActionButton
        action={createEmail}
        label={action.label}
        size="row"
        kind={e.next ? 'main' : 'outline'}
        fields={{ run: runId, slot: String(e.slot) }}
      />
    )
  if (action?.kind === 'open' && e.status.kind !== 'working')
    return (
      <ButtonLink
        href={`/plan/email/${action.buildId}` as Route}
        label="Open"
        kind="outline"
        size="row"
      />
    )
  const s = e.status
  if (s.kind === 'working') return <Status kind="working" word={s.word} />
  if (s.kind === 'needs_you') return <Status kind="needs_you" />
  if (s.kind === 'in_klaviyo') return <Status kind="in_klaviyo" />
  return <Status kind="planned" />
}
