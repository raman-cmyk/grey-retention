import { TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * The error state on the focused screen: the shell is already the white
 * surface, so what happened, what to do and one button sit in it (as
 * ErrorState does in a card).
 */
export function SetupError({
  title,
  reason,
  action
}: {
  title: string
  reason: string
  action: ReactNode
}) {
  return (
    <div className="flex flex-col items-start gap-[var(--space-5)]">
      <span
        aria-hidden
        className="gros-error-mark flex items-center justify-center rounded-[var(--radius-pill)] bg-[var(--signal-soft)] text-[var(--signal-ink)]"
      >
        <TriangleAlert size={22} strokeWidth={2} />
      </span>
      <div role="alert" className="flex flex-col gap-[var(--space-2)]">
        <h1 className="type-title">{title}</h1>
        <p className="type-body text-[var(--stone)]">{reason}</p>
      </div>
      {action}
    </div>
  )
}
