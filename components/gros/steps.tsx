import type { Route } from 'next'
import Link from 'next/link'
import { Check } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { grosRoot } from './font'
import { Mark } from './mark'

/**
 * StepCard (BRAND.md): the onboarding steps at the bottom of the lime
 * panel: which one the owner is on and which are done. A done step can be
 * clicked to go back; a step ahead cannot. Names are one word.
 */
export const onboardingSteps = [
  'Store',
  'Brand',
  'Klaviyo',
  'Discount',
  'Rivals'
] as const

export type Step = { name: string; href?: Route }

export function StepCards({
  steps,
  current
}: {
  steps: readonly Step[]
  /** The index of the step the owner is on. */
  current: number
}) {
  return (
    <ol
      aria-label="Steps"
      className="gros-steps grid grid-cols-2 sm:grid-cols-5"
    >
      {steps.map((step, i) => {
        const state = i < current ? 'done' : i === current ? 'now' : 'todo'
        const body = (
          <>
            <span
              aria-hidden
              className={cn(
                'gros-step-circle flex items-center justify-center rounded-[var(--radius-pill)]',
                state === 'todo'
                  ? 'gros-step-circle-todo text-[var(--forest)]'
                  : 'bg-[var(--forest)] text-[var(--white)]'
              )}
            >
              {state === 'done' ? <Check size={18} strokeWidth={2} /> : i + 1}
            </span>
            <span className="type-body-strong">{step.name}</span>
            <span className="sr-only">
              {state === 'done'
                ? ', done'
                : state === 'now'
                  ? ', now'
                  : ', to do'}
            </span>
          </>
        )
        const look = cn(
          'gros-step flex h-full flex-col justify-between rounded-[var(--radius-md)]',
          state === 'now'
            ? 'bg-[var(--white)] text-[var(--ink)]'
            : 'bg-[var(--lime-tile)] text-[var(--forest)]'
        )
        return (
          <li
            key={step.name}
            aria-current={state === 'now' ? 'step' : undefined}
          >
            {state === 'done' && step.href ? (
              <Link href={step.href} className={look}>
                {body}
              </Link>
            ) : (
              <div className={look}>{body}</div>
            )}
          </li>
        )
      })}
    </ol>
  )
}

/**
 * A focused screen (onboarding, sign in): one white shell with radius-xl.
 * The lime panel on the left shows where the owner is; the right side has
 * one title, one or two fields and one button. Stacks on a narrow screen.
 */
export function FocusShell({
  panel,
  children
}: {
  /** The lime panel's content under the mark, usually StepCards. */
  panel?: ReactNode
  children: ReactNode
}) {
  return (
    <div
      className={grosRoot(
        'flex min-h-dvh items-center justify-center px-[var(--space-6)] py-[var(--space-12)]'
      )}
    >
      <div className="grid w-full max-w-[var(--page-max)] grid-cols-1 gap-[var(--space-3)] rounded-[var(--radius-xl)] bg-[var(--white)] p-[var(--space-3)] lg:grid-cols-2">
        <div className="relative flex flex-col justify-between gap-[var(--space-10)] overflow-hidden rounded-[var(--radius-lg)] bg-[var(--lime)] p-[var(--space-10)] text-[var(--forest)]">
          <div className="relative flex items-center gap-[var(--space-3)]">
            <Mark size={44} decorative />
            <span className="type-heading">GROS</span>
          </div>
          <div className="relative">{panel}</div>
        </div>
        <main className="flex flex-col justify-center gap-[var(--space-7)] p-[var(--space-8)]">
          {children}
        </main>
      </div>
    </div>
  )
}
