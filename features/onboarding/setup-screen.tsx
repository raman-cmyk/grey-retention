import type { Route } from 'next'
import type { ReactNode } from 'react'
import { ActionButton } from '@/components/gros/action'
import { ButtonLink } from '@/components/gros/button'
import { Progress, type ProgressStep } from '@/components/gros/progress'
import { FocusShell, StepCards } from '@/components/gros/steps'
import type { SetupView } from './flow'
import type { SetupPlace, SetupStepKey } from './flow-model'
import type { StepKey, StepState } from './progress'
import { confirmBrand, readStoreAgain, saveStore } from './setup-actions'
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
      ) : place === 'brand' ? (
        <BrandStep view={view} />
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

/** The readers' rows in plain words: running, then done. */
const readerWords: Partial<Record<StepKey, [string, string]>> = {
  site: ['Reading your website', 'Read your website'],
  ads: ['Reading your ads', 'Read your ads'],
  reviews: ['Reading your reviews', 'Read your reviews'],
  catalog: ['Reading your products', 'Read your products'],
  history: ['Reading what you sent in Klaviyo', 'Read what you sent in Klaviyo']
}
const skippedWords: Partial<Record<StepKey, string>> = {
  ads: 'No ads to read',
  reviews: 'No reviews to read'
}
const readerState: Record<StepState, ProgressStep['state']> = {
  not_started: 'next',
  waiting: 'next',
  working: 'now',
  needs_you: 'now',
  done: 'done',
  skipped: 'done',
  failed: 'failed'
}

/**
 * The readers as Progress rows: the website's three always, the Klaviyo
 * ones once started. A website never read is a failed row (Try again).
 */
export function readerSteps(view: SetupView): ProgressStep[] {
  return (view.reading?.steps ?? []).flatMap((s): ProgressStep[] => {
    const words = readerWords[s.key]
    if (!words) return []
    const own = s.key === 'site' || s.key === 'ads' || s.key === 'reviews'
    if (!own && s.state === 'not_started') return []
    if (s.key === 'site' && s.state === 'not_started')
      return [
        {
          text: 'Your website is not read yet',
          state: 'failed',
          reason: 'Press Try again to read it.'
        }
      ]
    const state = readerState[s.state]
    return [
      {
        text:
          s.state === 'skipped'
            ? (skippedWords[s.key] ?? words[1])
            : state === 'done'
              ? words[1]
              : state === 'failed'
                ? `${words[0]} stopped`
                : words[0],
        state,
        reason:
          state === 'failed'
            ? 'The store site did not answer. Try again in a minute.'
            : undefined
      }
    ]
  })
}

function BrandStep({ view }: { view: SetupView }) {
  const steps = readerSteps(view)
  const found = view.found
  return (
    <>
      <Title text="Your brand" />
      {steps.some((s) => s.state !== 'done') ? (
        <Progress
          title="Reading your store"
          steps={steps}
          retry={
            view.owner ? (
              <ActionButton
                action={readStoreAgain}
                label="Try again"
                kind="outline"
                size="row"
              />
            ) : undefined
          }
        />
      ) : null}
      {found ? (
        <Facts
          items={[
            ['Name', view.brand?.name || 'Not found'],
            [
              'Logo',
              found.logo ? (
                // eslint-disable-next-line @next/next/no-img-element -- the logo the Site reader kept, shown as is
                <img
                  src={found.logo}
                  alt={`${view.brand?.name ?? 'Your'} logo`}
                  className="max-h-[var(--control-md)] max-w-full object-contain"
                />
              ) : (
                'Not found'
              )
            ],
            ['Colors', <Swatches key="colors" colors={found.colors} />],
            [
              'Fonts',
              found.fonts.length ? found.fonts.join(', ') : 'Not found'
            ],
            [
              'Products',
              found.products.length
                ? found.products.join(', ')
                : 'Read from Klaviyo next'
            ]
          ]}
        />
      ) : (
        <p className="type-body text-[var(--stone)]">
          What we found could not be read just now. Open setup again in a
          minute.
        </p>
      )}
      {view.owner ? (
        <ActionButton
          action={confirmBrand}
          label="Confirm brand"
          size="focus"
        />
      ) : (
        <OwnerOnly />
      )}
    </>
  )
}

/**
 * The store's own colors, only inside these swatches (BRAND rule 11),
 * each with its code in words.
 */
function Swatches({ colors }: { colors: string[] }) {
  if (!colors.length) return 'Not found'
  return (
    <span className="flex flex-wrap gap-[var(--space-2)]">
      {colors.map((color) => (
        <span key={color} className="flex items-center gap-[var(--space-1)]">
          <span
            aria-hidden
            className="inline-block size-[var(--space-6)] rounded-[var(--radius-sm)]"
            style={{ backgroundColor: color }}
          />
          <span className="type-caption">{color.toUpperCase()}</span>
        </span>
      ))}
    </span>
  )
}

/** Klaviyo, Discount, Rivals and the finish, still to be built here (UI-ONBd). */
const later: Record<
  Exclude<SetupPlace, 'store' | 'brand'>,
  [string, string, Route]
> = {
  klaviyo: ['Connect Klaviyo', 'Open connections', '/connections'],
  discount: ['Your discount', 'Open settings', '/settings'],
  rivals: ['Your rivals', 'Open inspiration', '/library/inspirations'],
  finish: ['You are set', 'Go to Home', '/home']
}

function LaterStep({
  place
}: {
  place: Exclude<SetupPlace, 'store' | 'brand'>
}) {
  const [title, button, href] = later[place]
  return (
    <>
      <Title text={title} />
      <ButtonLink href={href} label={button} size="focus" />
    </>
  )
}
