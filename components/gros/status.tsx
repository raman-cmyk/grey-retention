import { cn } from '@/lib/utils'

/**
 * Status (BRAND.md): a dot and one or two words in a pill. Only four, and
 * always a word: never a dot alone, never colour alone. A pill is not a
 * button. A new state maps onto one of these four.
 */
export type StatusKind = 'in_klaviyo' | 'planned' | 'working' | 'needs_you'

const looks: Record<StatusKind, { pill: string; dot: string; word: string }> = {
  in_klaviyo: {
    pill: 'bg-[var(--lime-soft)] text-[var(--forest)]',
    dot: 'bg-[var(--forest)]',
    word: 'In Klaviyo'
  },
  planned: {
    pill: 'bg-[var(--mist)] text-[var(--ink)]',
    dot: 'bg-[var(--lime)] gros-status-dot-ring',
    word: 'Planned'
  },
  working: {
    pill: 'bg-[var(--mist)] text-[var(--ink)]',
    dot: 'bg-[var(--stone)]',
    word: 'Working'
  },
  needs_you: {
    pill: 'bg-[var(--signal-soft)] text-[var(--signal-ink)]',
    dot: 'bg-[var(--signal)]',
    word: 'Needs you'
  }
}

export function Status({
  kind,
  word
}: {
  kind: StatusKind
  /** For `working`, the step, for example Designing. */
  word?: string
}) {
  const look = looks[kind]
  return (
    <span
      className={cn(
        'gros-status inline-flex shrink-0 items-center gap-[var(--space-2)] rounded-[var(--radius-pill)]',
        look.pill
      )}
    >
      <span
        aria-hidden
        className={cn('gros-status-dot rounded-[var(--radius-pill)]', look.dot)}
      />
      {kind === 'working' && word ? word : look.word}
    </span>
  )
}
