import type { Route } from 'next'
import type { ReactNode } from 'react'
import { ButtonLink } from '@/components/gros/button'
import { FocusShell, StepCards } from '@/components/gros/steps'
import type { SetupView } from './flow'
import type { SetupPlace, SetupStepKey } from './flow-model'
import { saveStore } from './setup-actions'
import { SetupError } from './setup-error'
import { StoreForm } from './setup-form'

/**
 * Onboarding (UI-ONBb) on the GROS focused shell: the lime panel shows the
 * five steps (a done step links back, a step ahead does not), the right
 * side the step that is open, with one title and one main button. Only
 * the owner gets the buttons; staff see where setup is.
 */
export function SetupScreen({
  view,
  place
}: {
  view: SetupView
  place: SetupPlace
}) {
  const flow = view.flow
  if (!flow)
    return (
      <FocusShell>
        <SetupError
          title="Setup did not open"
          reason={
            view.state === 'demo'
              ? 'Nothing is kept in the demo. Sign in to set up your store.'
              : 'We could not read your setup just now. What you saved is safe.'
          }
          action={<ButtonLink href={setupPath()} label="Try again" />}
        />
      </FocusShell>
    )
  return (
    <FocusShell
      panel={
        <StepCards
          current={flow.current}
          steps={flow.steps.map((s) => ({
            name: s.name,
            href: s.done ? setupPath(s.key) : undefined
          }))}
        />
      }
    >
      {place === 'store' ? (
        <StoreStep view={view} />
      ) : (
        <LaterStep place={place} />
      )}
    </FocusShell>
  )
}

export const setupPath = (step?: SetupStepKey) =>
  (step ? `/setup?step=${step}` : '/setup') as Route

function Title({ text }: { text: string }) {
  return <h1 className="type-title">{text}</h1>
}

function OwnerOnly() {
  return (
    <p className="type-body text-[var(--stone)]">
      Only the workspace owner can change this.
    </p>
  )
}

function StoreStep({ view }: { view: SetupView }) {
  return (
    <>
      <Title text="Your store" />
      {view.owner ? (
        <StoreForm
          action={saveStore}
          name={view.brand?.name || view.workspaceName}
          website={view.brand?.domain ?? ''}
        />
      ) : (
        <>
          <Facts
            items={[
              ['Store name', view.brand?.name || 'Not saved yet'],
              ['Website', view.brand?.domain || 'Not saved yet']
            ]}
          />
          <OwnerOnly />
        </>
      )}
    </>
  )
}

/** Small mist boxes inside the white shell, a label over each value. */
function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid w-full gap-[var(--space-3)] sm:grid-cols-2">
      {items.map(([label, value]) => (
        <div
          key={label}
          className="gros-tile flex flex-col gap-[var(--space-1)] rounded-[var(--radius-md)] bg-[var(--mist)]"
        >
          <dt className="type-label text-[var(--stone)]">{label}</dt>
          <dd className="type-body-strong">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** The steps still to be built on this screen (UI-ONBc and UI-ONBd). */
const later: Record<Exclude<SetupPlace, 'store'>, [string, string, Route]> = {
  brand: ['Your brand', 'Open brand', '/brand'],
  klaviyo: ['Connect Klaviyo', 'Open connections', '/connections'],
  discount: ['Your discount', 'Open settings', '/settings'],
  rivals: ['Your rivals', 'Open inspiration', '/library/inspirations'],
  finish: ['You are set', 'Go to Home', '/home']
}

function LaterStep({ place }: { place: Exclude<SetupPlace, 'store'> }) {
  const [title, button, href] = later[place]
  return (
    <>
      <Title text={title} />
      <ButtonLink href={href} label={button} size="focus" />
    </>
  )
}
