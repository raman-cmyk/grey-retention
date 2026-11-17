import type { Route } from 'next'
import type { ReactNode } from 'react'
import type { SetupStepKey } from './flow-model'

/** The parts every setup step uses (UI-ONBb). */
export const setupPath = (step?: SetupStepKey) =>
  (step ? `/setup?step=${step}` : '/setup') as Route

/**
 * The step's one `h1`, focusable by script only: `StepFocus` moves the
 * focus to it when the step changes.
 */
export function Title({ text }: { text: string }) {
  return (
    <h1 tabIndex={-1} className="type-title">
      {text}
    </h1>
  )
}

/** What staff see instead of a step's buttons. */
export function OwnerOnly() {
  return (
    <p className="type-body text-[var(--stone)]">
      Only the workspace owner can change this.
    </p>
  )
}

/** Small mist boxes inside the white shell, a label over each value. */
export function Facts({ items }: { items: [string, ReactNode][] }) {
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
