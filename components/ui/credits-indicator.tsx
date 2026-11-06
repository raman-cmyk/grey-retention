import { Zap } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Small "AI credits" indicator. It replaces the old token plan strip, whose
 * IN/OUT token counts meant nothing to an owner (docs/OWNER_JOURNEYS.md
 * §18.8). It shows one number (credits left), the plan and renewal date, and
 * says so when the numbers are sample data.
 */
export function CreditsIndicator({
  plan,
  renewsInDays,
  used,
  included,
  sample,
  className
}: {
  plan: string
  renewsInDays: number | null
  used: number
  included: number
  /** True while the numbers come from the fake provider. Required, so fake
   * numbers can never be shown as real by forgetting it. */
  sample: boolean
  className?: string
}) {
  const known =
    Number.isFinite(used) && Number.isFinite(included) && included >= 1
  const total = known ? Math.round(included) : 0
  const left = known ? Math.max(0, Math.round(total - Math.max(0, used))) : null
  const percent = left === null ? null : Math.round((left / total) * 100)
  const empty = left === 0
  const low = percent !== null && percent <= 10 && !empty
  const days =
    renewsInDays === null || !Number.isFinite(renewsInDays)
      ? null
      : Math.round(renewsInDays)
  const renews =
    days === null
      ? null
      : days < 0
        ? 'renewal date has passed'
        : days === 0
          ? 'renews today'
          : `renews in ${days} day${days === 1 ? '' : 's'}`
  return (
    <section
      aria-label="AI credits"
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--surface-raised)] px-4 py-3',
        className
      )}
    >
      <Zap className="size-5 shrink-0 text-[var(--text-muted)]" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">
          AI credits
          {sample && (
            <span className="ml-2 text-xs font-normal text-[var(--text-muted)]">
              (sample numbers)
            </span>
          )}
        </p>
        <p className="text-xs text-[var(--text-muted)]">
          {plan}
          {renews && ` · ${renews}`}
        </p>
      </div>
      {left === null ? (
        <p className="text-sm text-[var(--text-muted)]">
          Usage not available yet
        </p>
      ) : (
        <div className="w-full min-w-40 sm:w-48">
          <p
            className={cn(
              'text-sm',
              (low || empty) && 'font-semibold text-[var(--danger-ink)]'
            )}
          >
            {empty
              ? 'No credits left'
              : `${left.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} left`}
            {low && ' — running low'}
          </p>
          <div
            role="meter"
            aria-label="AI credits left"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent ?? 0}
            aria-valuetext={`${percent}% left`}
            className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--line)]"
          >
            <span
              className={cn(
                'block h-full rounded-full forced-colors:bg-[Highlight]',
                low || empty
                  ? 'bg-[var(--danger)]'
                  : 'bg-[var(--brand-primary)]'
              )}
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      )}
    </section>
  )
}
