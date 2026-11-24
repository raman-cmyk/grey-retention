import type { Route } from 'next'
import { ActionButton } from '@/components/gros/action'
import { ButtonLink } from '@/components/gros/button'
import { Card } from '@/components/gros/card'
import { ListRow, RowList, TextThumb } from '@/components/gros/list-row'
import { AppPage, CardRow } from '@/components/gros/nav'
import { EmptyState, ErrorState } from '@/components/gros/states'
import { createEmailFromInspiration } from '@/features/email-build/actions'
import { toSafePreview } from '@/features/email-generation/to-safe-preview'
import { startPlan } from '@/features/strategy/actions'
import type { ChosenEmail, UseEmailView } from './use-view'

/**
 * "Use this design" (UI-USE, owner decision of 24 Nov) on the GROS
 * components: the Inspiration email the owner chose, the planned emails of
 * his current plan that have no email yet, Copy or Remix, and one Create
 * email. It runs Create email on that planned email with this email as the
 * reference (D16, D17) and opens the email's own page. Staff see the email
 * and that only the owner creates emails.
 */
export function UseEmailScreen({
  view,
  timezone
}: {
  view: UseEmailView
  timezone: string
}) {
  return (
    <AppPage current="inspiration" title="Use this design">
      <Body view={view} timezone={timezone} />
    </AppPage>
  )
}

const inspirationHref: Route = '/inspiration'
const planHref: Route = '/plan'

/** Copy or Remix the chosen email (Scratch follows no email). */
export const inspirationModes = [
  { value: 'copy', label: 'Copy this email' },
  { value: 'remix', label: 'Remix this email' }
] as const

/** Why the build cannot follow the chosen email, in one line. */
export const unreadyWords = {
  reading:
    'This email is still being read, so GROS will make the email from scratch.',
  old: 'This email is over a year old, so GROS will make the email from scratch.'
} as const

function Body({ view, timezone }: { view: UseEmailView; timezone: string }) {
  switch (view.kind) {
    case 'error':
      return (
        <ErrorState
          title="This page did not open"
          reason="We could not read this email or your plan just now. Nothing was made. Try again in a minute."
          action={
            <ButtonLink href={inspirationHref} label="Back to Inspiration" />
          }
        />
      )
    case 'missing':
      return (
        <ErrorState
          title="This email is gone"
          reason="The email you chose is no longer in your Inspiration. Choose another one there."
          action={
            <ButtonLink href={inspirationHref} label="Open Inspiration" />
          }
        />
      )
    case 'staff':
      return (
        <CardRow>
          <Chosen email={view.email} timezone={timezone} />
          <Card label="Create email">
            <p className="type-body text-[var(--stone)]">
              Only this workspace’s owner can create emails.
            </p>
          </Card>
        </CardRow>
      )
    case 'no_plan':
      return (
        <CardRow>
          <Chosen email={view.email} timezone={timezone} />
          <EmptyState
            title={view.title}
            action={
              <ActionButton action={startPlan} label="Plan next 15 days" />
            }
          />
        </CardRow>
      )
    case 'not_ready':
      return (
        <CardRow>
          <Chosen email={view.email} timezone={timezone} />
          <EmptyState
            title={view.title}
            action={<ButtonLink href={planHref} label="Open your plan" />}
          />
        </CardRow>
      )
    case 'pick':
      return (
        <CardRow>
          <Chosen email={view.email} timezone={timezone} />
          <Pick view={view} />
        </CardRow>
      )
  }
}

/** The planned emails to choose from, Copy or Remix, and Create email. */
function Pick({ view }: { view: Extract<UseEmailView, { kind: 'pick' }> }) {
  const title = 'Choose a planned email'
  return (
    <Card label={title}>
      <div className="flex flex-col gap-[var(--space-5)]">
        <h2 className="type-heading">{title}</h2>
        {view.email.unready ? (
          <p className="type-body text-[var(--signal-ink)]">
            {unreadyWords[view.email.unready]}
          </p>
        ) : null}
        <ActionButton
          action={createEmailFromInspiration}
          label="Create email"
          fields={{ run: view.runId, reference: view.email.id }}
        >
          <fieldset className="flex flex-col gap-[var(--space-3)]">
            <legend className="sr-only">The planned email</legend>
            <RowList label="Planned emails">
              {view.emails.map((e, i) => (
                <ListRow
                  key={e.slot}
                  thumbnail={<TextThumb />}
                  title={e.title}
                  details={e.details}
                  wrap
                  end={
                    <input
                      type="radio"
                      name="slot"
                      value={String(e.slot)}
                      defaultChecked={i === 0}
                      aria-label={[e.title, ...e.details].join(', ')}
                      className="size-5 accent-[var(--forest)]"
                    />
                  }
                />
              ))}
            </RowList>
          </fieldset>
          <fieldset className="flex flex-col gap-[var(--space-3)]">
            <legend className="gros-field-label mb-[var(--space-2)] text-[var(--ink)]">
              How to make it
            </legend>
            {inspirationModes.map((m) => (
              <label
                key={m.value}
                className="type-body flex items-center gap-[var(--space-3)]"
              >
                <input
                  type="radio"
                  name="mode"
                  value={m.value}
                  // Copy unless the email cannot be followed yet.
                  defaultChecked={
                    m.value === (view.email.unready ? 'remix' : 'copy')
                  }
                  className="size-5 accent-[var(--forest)]"
                />
                {m.label}
              </label>
            ))}
          </fieldset>
        </ActionButton>
      </div>
    </Card>
  )
}

/** The chosen email, in the sandboxed safe preview (links off, no scripts). */
function Chosen({ email, timezone }: { email: ChosenEmail; timezone: string }) {
  return (
    <Card label="The email you chose">
      <div className="flex flex-col gap-[var(--space-5)]">
        <div className="flex flex-col gap-[var(--space-2)]">
          <h2 className="type-heading break-words">{email.subject}</h2>
          <p className="type-caption text-[var(--stone)]">
            {[email.from, day(email.at, timezone)].filter(Boolean).join(' · ')}
          </p>
        </div>
        <iframe
          title={`The email: ${email.subject}`}
          sandbox=""
          referrerPolicy="no-referrer"
          // Sanitized again on the server: links removed, a strict CSP.
          srcDoc={toSafePreview(email.html)?.html ?? ''}
          className="h-[28rem] w-full max-w-[600px] rounded-[var(--radius-md)] bg-[var(--white)]"
        />
      </div>
    </Card>
  )
}

function day(iso: string, timezone: string) {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  try {
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: timezone
    }).format(at)
  } catch {
    return at.toISOString().slice(0, 10)
  }
}
