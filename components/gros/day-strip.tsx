import type { Route } from 'next'
import Link from 'next/link'
import { cn } from '@/lib/utils'

/**
 * DayStrip (BRAND.md): the 15 days of a plan in one row, so the owner sees
 * the rhythm of sends at a glance. Always 15 days. A day with an email
 * opens it; a day without one does nothing. Each cell has its own words
 * for screen readers, and the legend says what the colors mean.
 */
export const planDays = 15
export type DayState = 'none' | 'planned' | 'in_klaviyo'
export type Day = { state: DayState; href?: Route }

const looks: Record<DayState, { cell: string; dot: string; word: string }> = {
  none: {
    cell: 'bg-[var(--mist)] text-[var(--stone)]',
    dot: 'bg-[var(--mist)] gros-status-dot-ring',
    word: 'No email'
  },
  planned: {
    cell: 'bg-[var(--lime)] text-[var(--forest)]',
    dot: 'bg-[var(--lime)]',
    word: 'Planned'
  },
  in_klaviyo: {
    cell: 'bg-[var(--forest)] text-[var(--white)]',
    dot: 'bg-[var(--forest)]',
    word: 'In Klaviyo'
  }
}

/** `start` is the plan's first day, YYYY-MM-DD, in the store's own time. */
export function planDates(start: string) {
  const first = Date.parse(`${start}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || Number.isNaN(first))
    throw new RangeError('A plan starts on a YYYY-MM-DD day')
  return Array.from({ length: planDays }, (_, i) => {
    const day = new Date(first + i * 86_400_000)
    const say = (o: Intl.DateTimeFormatOptions) =>
      day.toLocaleDateString('en-US', { ...o, timeZone: 'UTC' })
    return {
      letter: say({ weekday: 'narrow' }),
      number: day.getUTCDate(),
      words: say({ weekday: 'long', month: 'long', day: 'numeric' })
    }
  })
}

export function DayStrip({
  start,
  days
}: {
  start: string
  /** One per day from `start`; missing days have no email, extra are left out. */
  days: readonly Day[]
}) {
  const dates = planDates(start)
  return (
    <div className="flex flex-col gap-[var(--space-3)]">
      <ul
        aria-label="What the colors mean"
        className="flex flex-wrap gap-[var(--space-4)]"
      >
        {(['none', 'planned', 'in_klaviyo'] as const).map((s) => (
          <li
            key={s}
            className="type-caption flex items-center gap-[var(--space-2)] text-[var(--stone)]"
          >
            <span
              aria-hidden
              className={cn(
                'gros-status-dot rounded-[var(--radius-pill)]',
                looks[s].dot
              )}
            />
            {looks[s].word}
          </li>
        ))}
      </ul>
      <ol aria-label="The next 15 days" className="gros-days grid grid-cols-15">
        {dates.map((d, i) => {
          const day = days[i] ?? { state: 'none' }
          const look = looks[day.state]
          const words = `${d.words}: ${look.word}`
          const cell = cn(
            'gros-day flex items-center justify-center rounded-[var(--radius-sm)]',
            look.cell
          )
          return (
            <li
              key={i}
              className="flex min-w-0 flex-col items-center gap-[var(--space-1)]"
            >
              <span aria-hidden className="type-caption text-[var(--stone)]">
                {d.letter}
              </span>
              {day.state !== 'none' && day.href ? (
                <Link
                  href={day.href}
                  aria-label={words}
                  title={words}
                  className={cn(cell, 'w-full')}
                >
                  {d.number}
                </Link>
              ) : (
                <span title={words} className={cn(cell, 'w-full')}>
                  <span aria-hidden>{d.number}</span>
                  <span className="sr-only">{words}</span>
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
