import { ActionButton } from '@/components/gros/action'
import { ButtonLink } from '@/components/gros/button'
import { Progress, type ProgressStep } from '@/components/gros/progress'
import { FocusShell, StepCards } from '@/components/gros/steps'
import { KeepFresh } from '@/features/strategy/refresh'
import type { SetupView } from './flow'
import { maxBrandWords, maxWebsite, type SetupPlace } from './flow-model'
import type { StepKey, StepState } from './progress'
import { confirmBrand, readStoreAgain, saveStore } from './setup-actions'
import { SetupError } from './setup-error'
import { SetupForm } from './setup-form'
import { Facts, OwnerOnly, setupPath, Title } from './setup-parts'
import type { SetupRivals } from './rivals'
import {
  DiscountStep,
  FinishStep,
  KlaviyoStep,
  RivalsStep
} from './setup-steps'

/**
 * Onboarding (UI-ONBb) on the GROS focused shell: the lime panel shows the
 * five steps, each done or not by its own record (a done step before Now
 * links back; a step ahead never does), the right side the step that is
 * open, with one title and one main button. Only the owner gets the
 * buttons; staff see where setup is.
 */
export function SetupScreen({
  view,
  place,
  rivals = null
}: {
  view: SetupView
  place: SetupPlace
  /** The Rivals step's read, when it is open. */
  rivals?: SetupRivals | null
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
      ) : place === 'brand' ? (
        <BrandStep view={view} />
      ) : place === 'klaviyo' ? (
        <KlaviyoStep view={view} />
      ) : place === 'discount' ? (
        <DiscountStep view={view} />
      ) : place === 'rivals' ? (
        <RivalsStep view={view} rivals={rivals} />
      ) : (
        <FinishStep view={view} />
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
/** Where each reader reads, for its reason. */
const sourceWords: Partial<Record<StepKey, string>> = {
  site: 'Your website',
  ads: 'The ad library',
  reviews: 'Your reviews',
  catalog: 'Klaviyo',
  history: 'Klaviyo'
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

/** Why a read failed, from its failure class, in the owner's words. */
export function readerReason(key: StepKey, failure?: string): string {
  const source = sourceWords[key] ?? 'The source'
  if (failure === 'auth')
    return key === 'catalog' || key === 'history'
      ? 'Klaviyo refused the key. Reconnect Klaviyo, then try again.'
      : `${source} refused us. Try again later.`
  if (failure === 'rate_limit')
    return `${source} asked us to slow down. Try again in a few minutes.`
  if (failure === 'transient')
    return `${source} did not answer. Try again in a minute.`
  return `${source} could not be read. Try again.`
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
        reason: state === 'failed' ? readerReason(s.key, s.failure) : undefined
      }
    ]
  })
}

function BrandStep({ view }: { view: SetupView }) {
  const steps = readerSteps(view)
  const found = view.found
  const running = steps.some((s) => s.state === 'now' || s.state === 'next')
  // Never while the website is being read, nor without what was found.
  const siteReading =
    view.reading?.steps.find((s) => s.key === 'site')?.state === 'working'
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
      {running ? <KeepFresh /> : null}
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
      {!view.owner ? (
        <OwnerOnly />
      ) : found && !siteReading ? (
        <SetupForm
          action={confirmBrand}
          label="Confirm brand"
          hidden={{ site: view.brand?.domain ?? '' }}
          fields={[
            {
              name: 'voice',
              label: 'How should your emails sound? (optional)',
              defaultValue: view.brand?.voice ?? '',
              autoComplete: 'off',
              maxLength: maxBrandWords
            },
            {
              name: 'prohibitions',
              label: 'Anything we should avoid? (optional)',
              defaultValue: view.brand?.prohibitions ?? '',
              autoComplete: 'off',
              maxLength: maxBrandWords
            }
          ]}
        />
      ) : null}
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
