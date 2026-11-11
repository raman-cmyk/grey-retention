import { ActionForm, SubmitButton } from '@/components/ui/action-form'
import { Notice, Panel } from '@/components/ui/workspace'
import { Pill } from '@/components/ui/pill'
import type { FifteenDayPlan } from './plan'
import type { Pulse } from './pulse'
import { pickOffers, startPlan } from './actions'
import { PlanProgress } from './progress'

export type PlanRun = {
  id: string
  state: 'pulse_queued' | 'offers_ready' | 'plan_queued' | 'planned' | 'failed'
  startOn: string
  pulse: Pulse | null
  plan: FifteenDayPlan | null
}

const day = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC'
  }).format(new Date(`${iso}T12:00:00Z`))

function StartButton({ again }: { again?: boolean }) {
  return (
    <ActionForm action={startPlan}>
      <SubmitButton>{again ? 'Plan again' : 'Plan next 15 days'}</SubmitButton>
    </ActionForm>
  )
}

/**
 * "Plan next 15 days" (D17, D20): the owner starts it, optionally picks the
 * offers, and gets a plan with a reason and its facts for every email. No
 * approval step. Staff see the same plan without the buttons.
 */
export function PlanView({
  run,
  owner
}: {
  run: PlanRun | null
  owner: boolean
}) {
  if (!run || run.state === 'failed')
    return (
      <Panel title="Your next 15 days">
        {run?.state === 'failed' && (
          <div className="mb-4">
            <Notice error>We could not plan these days. Try again.</Notice>
          </div>
        )}
        <p className="mb-4 text-sm leading-6 text-[var(--text-muted)]">
          We read your store and what similar brands sent, then plan your emails
          for the next 15 days. You can choose which offers to run.
        </p>
        {owner ? (
          <StartButton />
        ) : (
          <Notice>Only this workspace’s owner starts a plan.</Notice>
        )}
      </Panel>
    )
  if (run.state === 'pulse_queued')
    return <PlanProgress message="Reading your store for the next 15 days…" />
  if (run.state === 'plan_queued')
    return <PlanProgress message="Planning your next 15 days…" />
  if (run.state === 'offers_ready' && run.pulse)
    return <OfferStep run={run} pulse={run.pulse} owner={owner} />
  if (run.state === 'planned' && run.plan)
    return <PlannedDays plan={run.plan} owner={owner} />
  return <Notice error>This plan could not be shown. Reload the page.</Notice>
}

function OfferStep({
  run,
  pulse,
  owner
}: {
  run: PlanRun
  pulse: Pulse
  owner: boolean
}) {
  return (
    <div className="space-y-6">
      <Panel
        title={`What matters from ${day(pulse.start)} to ${day(pulse.end)}`}
      >
        <p className="mb-4 text-sm leading-6">{pulse.summary}</p>
        <ul className="space-y-3 text-sm">
          {pulse.highlights.map((h) => (
            <li key={h.id}>
              <p className="font-medium break-words">{h.fact}</p>
              <p className="text-[var(--text-muted)]">{h.why}</p>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Which offers should we run?">
        {pulse.leftOut.length > 0 && (
          <ul className="mb-4 space-y-1 text-sm text-[var(--text-muted)]">
            {pulse.leftOut.map((l) => (
              <li key={l.code}>
                {l.code} is not offered: {l.why}
              </li>
            ))}
          </ul>
        )}
        {!owner ? (
          <Notice>Only this workspace’s owner chooses the offers.</Notice>
        ) : (
          <ActionForm action={pickOffers} className="space-y-4">
            <input type="hidden" name="run" value={run.id} />
            {pulse.offers.length ? (
              <fieldset className="space-y-2">
                <legend className="mb-2 text-sm font-medium">
                  Tick the offers to run, or let us choose
                </legend>
                {pulse.offers.map((o) => (
                  <label key={o.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="offers" value={o.id} />
                    {o.percent}% off with {o.code}
                    {o.until ? `, until ${day(o.until)}` : ''}
                  </label>
                ))}
              </fieldset>
            ) : (
              <Notice>No offers can run in these days.</Notice>
            )}
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-medium">
                How should we use them?
              </legend>
              {pulse.offers.length > 0 && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" name="mode" value="picked" />
                  Run the offers I ticked
                </label>
              )}
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="mode" value="auto" defaultChecked />
                You choose
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="mode" value="none" />
                No offers this time
              </label>
            </fieldset>
            <SubmitButton pendingLabel="Planning…">
              Plan the 15 days
            </SubmitButton>
          </ActionForm>
        )}
      </Panel>
    </div>
  )
}

function PlannedDays({
  plan,
  owner
}: {
  plan: FifteenDayPlan
  owner: boolean
}) {
  const fromFacts =
    plan.source.brief === 'code' && plan.source.planner === 'code'
  return (
    <div className="space-y-6">
      <Panel title={`Your emails from ${day(plan.start)} to ${day(plan.end)}`}>
        {fromFacts && (
          <p className="mb-4 text-sm text-[var(--text-muted)]">
            Planned from your store’s facts and similar brands’ timing; the AI
            was not used for this plan.
          </p>
        )}
        {plan.notes.map((note) => (
          <div key={note} className="mb-4">
            <Notice>{note}</Notice>
          </div>
        ))}
        {plan.slots.length ? (
          <ol className="space-y-4">
            {plan.slots.map((s) => (
              <li
                key={`${s.date}-${s.time}-${s.audience.id}`}
                className="rounded-lg border border-[var(--line)] p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold">
                    {day(s.date)} · {s.time}
                  </p>
                  <Pill>{s.emailType}</Pill>
                  {s.offer && (
                    <Pill tone="info">
                      {s.offer.percent}% off with {s.offer.code}
                    </Pill>
                  )}
                </div>
                <p className="mt-2 text-sm break-words">{s.angle}</p>
                <dl className="mt-2 grid gap-1 text-sm text-[var(--text-muted)]">
                  {s.products.length > 0 && (
                    <div>
                      <dt className="inline font-medium">Products: </dt>
                      <dd className="inline">
                        {s.products.map((p) => p.title).join(', ')}
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt className="inline font-medium">Sends to: </dt>
                    <dd className="inline">{s.audience.label}</dd>
                  </div>
                  <div>
                    <dt className="inline font-medium">Why: </dt>
                    <dd className="inline">{s.why}</dd>
                  </div>
                </dl>
                {s.evidence.length > 0 && (
                  <ul className="mt-2 list-disc pl-5 text-xs text-[var(--text-muted)]">
                    {s.evidence.map((e) => (
                      <li key={e.id} className="break-words">
                        {e.fact}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <Notice>
            No email fits these 15 days with your current settings.
          </Notice>
        )}
      </Panel>
      {owner && <StartButton again />}
    </div>
  )
}
