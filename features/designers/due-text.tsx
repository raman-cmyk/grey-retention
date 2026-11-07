import { cn } from '@/lib/utils'
import type { DueLine } from './model'

/** "Due in 3 hours · Nov 7, 2026 · 3:00 PM UTC", urgency in colour and words. */
export function DueText({ due }: { due: DueLine }) {
  return (
    <span className="text-[var(--text-muted)]">
      <span
        className={cn(
          due.tone === 'danger' && 'font-semibold text-[var(--danger-ink)]',
          due.tone === 'warning' && 'font-semibold text-[var(--warning-ink)]'
        )}
      >
        {due.text}
      </span>{' '}
      <span aria-hidden>·</span> <time dateTime={due.iso}>{due.exact}</time>
    </span>
  )
}
