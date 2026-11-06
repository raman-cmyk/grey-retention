import { CheckCircle2, Circle } from 'lucide-react'
import { Panel } from '@/components/ui/workspace'
import {
  approvalSteps,
  readinessLine,
  type ReadinessInput
} from './schedule-readiness'

/**
 * "Approve, then schedule" (UIR-016, docs/OWNER_JOURNEYS.md Job 4 and
 * §18.4): one checklist above the workflow on the campaign page. Each open
 * step links to where it is done; the owner is pointed to Schedule only when
 * every step is done. The database checks the same things again.
 */
export function ApproveStep({
  campaign,
  owner,
  hasCurrentPackage,
  standingPolicy = false,
  now = new Date()
}: {
  campaign: ReadinessInput
  owner: boolean
  /** A delivery package exists for the current versions. */
  hasCurrentPackage: boolean
  standingPolicy?: boolean
  now?: Date
}) {
  const steps = approvalSteps(campaign, now, owner)
  const line = readinessLine({
    campaign,
    owner,
    ready: steps.every((s) => s.done),
    hasCurrentPackage,
    standingPolicy
  })
  return (
    <Panel id="approve" title="Approve, then schedule">
      <p className="mb-4 text-sm leading-6 text-[var(--text-muted)]">
        Only the brand owner can approve and schedule. Each approval is for one
        exact version: changing the copy or design asks for approval again.
      </p>
      {!campaign.superseded_by_plan && (
        <ol className="space-y-2" aria-label="Approval steps">
          {steps.map((step) => (
            <li key={step.key} className="flex items-start gap-2 text-sm">
              {step.done ? (
                <CheckCircle2
                  className="mt-0.5 size-4 shrink-0 text-[var(--success-ink)]"
                  aria-hidden
                />
              ) : (
                <Circle
                  className="mt-0.5 size-4 shrink-0 text-[var(--text-muted)]"
                  aria-hidden
                />
              )}
              <span className="min-w-0">
                <span className="font-medium">{step.label}:</span>{' '}
                <span className="sr-only">
                  {step.done ? 'done. ' : 'not done. '}
                </span>
                {step.done ? (
                  step.detail
                ) : (
                  <a
                    href={step.href}
                    className="underline underline-offset-4 hover:text-[var(--text)]"
                  >
                    {step.detail}
                  </a>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
      <p
        role="status"
        className="mt-4 border-t border-[var(--line)] pt-3 text-sm font-medium"
      >
        {line.text}
      </p>
      {line.next && (
        <a
          href={line.next}
          className="mt-2 inline-block text-sm font-semibold text-[var(--brand-secondary)] underline-offset-4 hover:underline"
        >
          {line.next === '#schedule'
            ? 'Go to Schedule'
            : 'Go to the delivery package'}
        </a>
      )}
    </Panel>
  )
}
