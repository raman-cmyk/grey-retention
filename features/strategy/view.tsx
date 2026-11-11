import { ActionForm, SubmitButton } from '@/components/ui/action-form'
import { Notice, Panel } from '@/components/ui/workspace'
import { Pill } from '@/components/ui/pill'
import type { EmailBuildView, PlanRun } from './load'
import type { StoredPlan, StoredPulse } from './stored'
import { pickOffers, startPlan } from './actions'
import { PlanProgress } from './progress'
import { CreateEmailButton } from './create-email'

export type { PlanRun }

const day = (iso: string) => {
  const date = new Date(`${iso}T12:00:00Z`)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC'
  }).format(date)
}

function StartButton({ label = 'Plan next 15 days' }: { label?: string }) {
  return (
    <ActionForm action={startPlan}>
      <SubmitButton pendingLabel="Starting…">{label}</SubmitButton>
    </ActionForm>
  )
}

function SampleNotice() {
  return (
    <div className="mb-4">
      <Notice>
        This plan uses a sample store until your own store is connected. The
        offers, products and dates below are examples.
      </Notice>
    </div>
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
  const start = owner ? <StartButton /> : null
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
        {start ?? <Notice>Only this workspace’s owner starts a plan.</Notice>}
      </Panel>
    )
  if (run.stale && run.state !== 'planned')
    return (
      <Panel title="These 15 days have begun">
        <p className="mb-4 text-sm leading-6 text-[var(--text-muted)]">
          This plan was for days that have started. Start a new plan for the
          next 15 days.
        </p>
        {owner ? <StartButton label="Start again" /> : null}
      </Panel>
    )
  if (run.state === 'pulse_queued')
    return <PlanProgress message="Reading your store for the next 15 days…" />
  if (run.state === 'plan_queued')
    return <PlanProgress message="Planning your next 15 days…" />
  if (run.state === 'offers_ready' && run.pulse)
    return <OfferStep run={run} pulse={run.pulse} owner={owner} />
  if (run.state === 'planned' && run.plan)
    return (
      <PlannedDays
        plan={run.plan}
        owner={owner}
        run={run.id}
        builds={run.builds}
      />
    )
  return (
    <Panel title="Your next 15 days">
      <div className="mb-4">
        <Notice error>This plan could not be shown. Start a new one.</Notice>
      </div>
      {start}
    </Panel>
  )
}

function OfferStep({
  run,
  pulse,
  owner
}: {
  run: PlanRun
  pulse: StoredPulse
  owner: boolean
}) {
  return (
    <div className="space-y-6">
      <Panel
        title={`What matters from ${day(pulse.start)} to ${day(pulse.end)}`}
      >
        {pulse.sample && <SampleNotice />}
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
          <ActionForm action={pickOffers} className="space-y-4" preserveValues>
            <input type="hidden" name="run" value={run.id} />
            {pulse.offers.length ? (
              <fieldset className="space-y-2">
                <legend className="mb-2 text-sm font-medium">
                  The offers you can run
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
                  Only the offers I tick
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

/** One planned email's "Create email" state (EML-004 part 2, D17). */
function EmailStatus({
  build,
  owner,
  run,
  slot
}: {
  build: EmailBuildView | undefined
  owner: boolean
  run: string
  slot: number
}) {
  if (!build || build.state === 'failed')
    return (
      <div className="mt-3 space-y-2">
        {build && (
          <p role="alert" className="text-sm text-[var(--danger-ink)]">
            We could not create this email.
          </p>
        )}
        {owner ? (
          <CreateEmailButton
            run={run}
            slot={slot}
            label={build ? 'Try again' : 'Create email'}
          />
        ) : null}
      </div>
    )
  if (build.state !== 'drafted')
    return (
      <div className="mt-3">
        <PlanProgress
          message={
            build.state === 'build_queued'
              ? 'Creating your email…'
              : 'Putting your email into Klaviyo as a draft…'
          }
        />
      </div>
    )
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
      <Pill tone="success">In Klaviyo as a draft</Pill>
      {build.sampleDraft && (
        <span className="text-[var(--text-muted)]">
          Sample draft: Klaviyo is not connected, so nothing was sent to it.
        </span>
      )}
      <a
        className="font-medium underline underline-offset-2"
        href={`/plan/email/${build.id}`}
      >
        See the email
      </a>
    </div>
  )
}

function PlannedDays({
  plan,
  owner,
  run,
  builds
}: {
  plan: StoredPlan
  owner: boolean
  run: string
  builds: Record<number, EmailBuildView>
}) {
  const fromFacts =
    plan.source.brief === 'code' && plan.source.planner === 'code'
  return (
    <div className="space-y-6">
      <Panel title={`Your emails from ${day(plan.start)} to ${day(plan.end)}`}>
        {plan.sample && <SampleNotice />}
        {fromFacts && (
          <p className="mb-4 text-sm text-[var(--text-muted)]">
            Planned from the store’s facts and similar brands’ timing; the AI
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
            {plan.slots.map((s, i) => (
              <li
                key={`${s.date}-${s.time}-${s.audience.id}`}
                className="rounded-lg border border-[var(--line)] p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold">
                    {day(s.date)} · {s.time} store time
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
                <EmailStatus
                  build={builds[i]}
                  owner={owner}
                  run={run}
                  slot={i}
                />
              </li>
            ))}
          </ol>
        ) : (
          <Notice>
            No email fits these 15 days with your current settings.
          </Notice>
        )}
      </Panel>
      {owner && <StartButton label="Plan again" />}
    </div>
  )
}
