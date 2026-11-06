import { cn } from '@/lib/utils'
import {
  operatorStatuses,
  type OperatorStatus,
  type StatusTone
} from '@/lib/status-vocabulary'

/** Text first, colour second: a mono uppercase label with a 6px square dot. */
const tones: Record<StatusTone | 'active', { text: string; dot: string }> = {
  neutral: {
    text: 'text-[var(--text-muted)]',
    dot: 'bg-[var(--text-muted)]'
  },
  info: {
    text: 'text-[var(--brand-secondary)]',
    dot: 'bg-[var(--brand-secondary)]'
  },
  // Older callers use "active" for the informational blue.
  active: {
    text: 'text-[var(--brand-secondary)]',
    dot: 'bg-[var(--brand-secondary)]'
  },
  success: { text: 'text-success', dot: 'bg-success' },
  warning: {
    text: 'text-[var(--warning-ink)]',
    dot: 'bg-[var(--warning-ink)]'
  },
  danger: { text: 'text-[var(--danger-ink)]', dot: 'bg-[var(--danger-ink)]' }
}

export function StatusMark({
  children,
  tone,
  status,
  className
}: {
  children?: React.ReactNode
  tone?: keyof typeof tones
  /** Use the shared vocabulary (UX-012): sets the label, tone and meaning. */
  status?: OperatorStatus
  className?: string
}) {
  const entry = status ? operatorStatuses[status] : undefined
  const resolvedTone = tones[tone ?? entry?.tone ?? 'neutral']
  return (
    <span
      title={entry?.meaning}
      className={cn(
        'tracking-label inline-flex min-h-6 items-center gap-1.5 font-mono text-[0.6875rem] leading-none font-medium uppercase',
        resolvedTone.text,
        className
      )}
    >
      <span
        aria-hidden
        className={cn(
          'size-1.5 shrink-0 forced-colors:bg-[CanvasText]',
          resolvedTone.dot
        )}
      />
      {children ?? entry?.label}
    </span>
  )
}
