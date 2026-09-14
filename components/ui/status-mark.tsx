import { cn } from '@/lib/utils'

const tones = {
  neutral: 'bg-[var(--surface-hover)] text-[var(--text-muted)]',
  active: 'bg-[var(--brand-soft)] text-[var(--brand-ink)]',
  warning: 'bg-[var(--warning-soft)] text-[var(--warning-ink)]',
  danger: 'bg-[var(--danger-soft)] text-[var(--danger-ink)]'
} as const

export function StatusMark({
  children,
  tone = 'neutral',
  className
}: {
  children: React.ReactNode
  tone?: keyof typeof tones
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex min-h-6 items-center rounded-full px-2.5 font-[family-name:var(--font-data)] text-[0.68rem] leading-none font-medium tracking-[0.04em] uppercase',
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  )
}
