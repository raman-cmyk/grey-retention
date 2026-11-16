import { Check, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Progress (BRAND.md): how every long job is shown: a title, one bar, and
 * the real steps in plain words with the current one marked. The bar moves
 * per finished step and never fakes movement: no spinner, no percentage,
 * no time estimate. A failed step turns into what happened and a way to
 * try again; finished steps stay done.
 */
export type ProgressState = 'done' | 'now' | 'next' | 'failed'
export type ProgressStep = {
  /** Past tense when done, present when running: Wrote the words. */
  text: string
  state: ProgressState
  /** For a failed step: what happened and what to do. */
  reason?: string
}

const words: Record<Exclude<ProgressState, 'failed'>, string> = {
  done: 'Done',
  now: 'Now',
  next: 'Next'
}

export function Progress({
  title,
  steps,
  retry
}: {
  /** What is being made: Creating your email. */
  title: string
  steps: readonly ProgressStep[]
  /** The Try again button, shown on a failed step. */
  retry?: ReactNode
}) {
  const done = steps.filter((s) => s.state === 'done').length
  return (
    <div className="flex flex-col gap-[var(--space-6)]">
      <h2 className="type-heading">{title}</h2>
      <div
        role="progressbar"
        aria-label={title}
        aria-valuemin={0}
        aria-valuemax={steps.length}
        aria-valuenow={done}
        aria-valuetext={`${done} of ${steps.length} steps done`}
        className="gros-bar overflow-hidden rounded-[var(--radius-pill)] bg-[var(--mist)]"
      >
        <div
          className="h-full rounded-[var(--radius-pill)] bg-[var(--forest)]"
          style={{
            width: `${steps.length ? (done / steps.length) * 100 : 0}%`
          }}
        />
      </div>
      <ol className="flex flex-col gap-[var(--space-4)]">
        {steps.map((step, i) =>
          step.state === 'failed' ? (
            <li
              key={i}
              role="alert"
              className="flex items-start gap-[var(--space-4)] rounded-[var(--radius-md)] bg-[var(--signal-soft)] p-[var(--space-4)]"
            >
              <span
                aria-hidden
                className="gros-progress-circle flex shrink-0 items-center justify-center rounded-[var(--radius-pill)] bg-[var(--white)] text-[var(--signal-ink)]"
              >
                <TriangleAlert size={18} strokeWidth={2} />
              </span>
              <div className="flex flex-1 flex-col gap-[var(--space-2)]">
                <p className="type-body-strong text-[var(--signal-ink)]">
                  {step.text}
                </p>
                {step.reason ? (
                  <p className="type-body text-[var(--ink)]">{step.reason}</p>
                ) : null}
                {retry}
              </div>
            </li>
          ) : (
            <li key={i} className="flex items-center gap-[var(--space-4)]">
              <span
                aria-hidden
                className={cn(
                  'gros-progress-circle flex shrink-0 items-center justify-center rounded-[var(--radius-pill)]',
                  step.state === 'done' &&
                    'bg-[var(--lime)] text-[var(--forest)]',
                  step.state === 'now' && 'bg-[var(--forest)]',
                  step.state === 'next' && 'bg-[var(--mist)]'
                )}
              >
                {step.state === 'done' ? (
                  <Check size={18} strokeWidth={2} />
                ) : step.state === 'now' ? (
                  <span className="gros-status-dot rounded-[var(--radius-pill)] bg-[var(--lime)]" />
                ) : null}
              </span>
              <p
                className={cn(
                  'flex-1',
                  step.state === 'now' ? 'type-body-strong' : 'type-body',
                  step.state === 'next' && 'text-[var(--stone)]'
                )}
              >
                {step.text}
              </p>
              <span
                className={cn(
                  'type-caption',
                  step.state === 'now'
                    ? 'text-[var(--forest)]'
                    : 'text-[var(--stone)]'
                )}
              >
                {words[step.state]}
              </span>
            </li>
          )
        )}
      </ol>
    </div>
  )
}
