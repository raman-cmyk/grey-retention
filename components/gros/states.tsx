import { TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { Card } from './card'

/**
 * EmptyState (BRAND.md): a title of two to four words and exactly one
 * button that fills the screen. Nothing else: no illustration, no text.
 */
export function EmptyState({
  title,
  action
}: {
  title: string
  /** The one forest button (a Button or ButtonLink). */
  action: ReactNode
}) {
  return (
    <Card>
      <div className="flex flex-col items-center gap-[var(--space-7)] py-[var(--space-12)] text-center">
        <h2 className="type-title">{title}</h2>
        {action}
      </div>
    </Card>
  )
}

/**
 * ErrorState: what happened (a heading), one sentence on what it means and
 * what to do, and one button that fixes it (Try again when nothing else
 * can). The real reason in the owner's words, never "Something went wrong".
 */
export function ErrorState({
  title,
  reason,
  action
}: {
  title: string
  reason: string
  action: ReactNode
}) {
  return (
    <Card>
      <div className="flex flex-col items-start gap-[var(--space-5)]">
        <span
          aria-hidden
          className="gros-error-mark flex items-center justify-center rounded-[var(--radius-pill)] bg-[var(--signal-soft)] text-[var(--signal-ink)]"
        >
          <TriangleAlert size={22} strokeWidth={2} />
        </span>
        {/* Only what happened and what to do is read out, not the button. */}
        <div role="alert" className="flex flex-col gap-[var(--space-2)]">
          <h2 className="type-heading">{title}</h2>
          <p className="type-body text-[var(--stone)]">{reason}</p>
        </div>
        {action}
      </div>
    </Card>
  )
}
