import type { Route } from 'next'
import { ButtonLink } from '@/components/gros/button'
import { FocusShell, StepCards } from '@/components/gros/steps'
import type { SetupView } from './flow'
import { maxWebsite, type SetupPlace } from './flow-model'
import { saveStore } from './setup-actions'
import { SetupError } from './setup-error'
import { SetupForm } from './setup-form'
import { Facts, OwnerOnly, setupPath, Title } from './setup-parts'

/**
 * Onboarding (UI-ONBb) on the GROS focused shell: the lime panel shows the
 * five steps, each done or not by its own record (a done step before Now
 * links back; a step ahead never does), the right side the step that is
 * open, with one title and one main button. Only the owner gets the
 * buttons; staff see where setup is.
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
  const shown = flow.steps.findIndex((s) => s.key === place)
  return (
    <FocusShell
      panel={
        <StepCards
          current={flow.current}
          shown={shown === -1 ? undefined : shown}
          steps={flow.steps.map((s, i) => ({
            name: s.name,
            done: s.done,
            href: s.done && i < flow.current ? setupPath(s.key) : undefined
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

function StoreStep({ view }: { view: SetupView }) {
  return (
    <>
      <Title text="Your store" />
      {view.owner ? (
        <SetupForm
          action={saveStore}
          label="Save store"
          fields={[
            {
              name: 'name',
              label: 'Store name',
              defaultValue: view.brand?.name || view.workspaceName,
              autoComplete: 'organization',
              maxLength: 120,
              required: true
            },
            {
              name: 'website',
              label: 'Website',
              defaultValue: view.brand?.domain ?? '',
              inputMode: 'url',
              autoComplete: 'url',
              spellCheck: false,
              maxLength: maxWebsite,
              required: true
            }
          ]}
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

/** The steps still to be built on this screen (UI-ONBc to UI-ONBe). */
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
