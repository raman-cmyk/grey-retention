import { CheckCircle2, Circle } from 'lucide-react'
import { Panel } from '@/components/ui/workspace'
import {
  approvalSteps,
  deliveryStarted,
  type ReadinessInput
} from './schedule-readiness'

/**
 * "Approve, then schedule" (UIR-016, docs/OWNER_JOURNEYS.md Job 4 and
 * §18.4): one checklist at the top of the campaign page. Each step links to
 * where it is done; Schedule is offered only when every step is done and the
 * delivery package is current. The database checks the same things again.
 */
export function ApproveStep({
  campaign,
  owner,
  hasCurrentPackage,
  now = new Date()
}: {
  campaign: ReadinessInput
  owner: boolean
  /** A delivery package exists for the current versions. */
  hasCurrentPackage: boolean
  now?: Date
}) {
  const steps = approvalSteps(campaign, now)
  const started = deliveryStarted(campaign)
  const ready = steps.every((s) => s.done)
  return (
    <Panel id="approve" title="Approve, then schedule">
      <p className="mb-4 text-sm leading-6 text-[var(--text-muted)]">
        Only the brand owner can approve and schedule. Each approval is for one
        exact version: changing the copy or design asks for approval again.
      </p>
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
      <p
        role="status"
        className="mt-4 border-t border-[var(--line)] pt-3 text-sm font-medium"
      >
        {started
          ? 'Scheduling has started. Delivery shows its progress below.'
          : !ready
            ? 'Schedule stays off until every step above is done.'
            : !owner
              ? 'Ready. Waiting for the brand owner to schedule it.'
              : hasCurrentPackage
                ? 'Ready. Check the summary and confirm Schedule below.'
                : 'Ready. Make the delivery package below, then schedule it.'}
      </p>
      {owner && ready && !started && (
        <a
          href={hasCurrentPackage ? '#schedule' : '#package'}
          className="mt-2 inline-block text-sm font-semibold text-[var(--brand-secondary)] underline-offset-4 hover:underline"
        >
          {hasCurrentPackage ? 'Go to Schedule' : 'Go to the delivery package'}
        </a>
      )}
    </Panel>
  )
}
