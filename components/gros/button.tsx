import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

/**
 * Button (BRAND.md): a fully round pill in five kinds. One `main` (forest)
 * per card. `round` is the 64 px lime open button with an arrow, and needs
 * its spoken label. Sizes: `app` 52 px, `focus` 60 px (a focused screen),
 * `row` 44 px (inside a list row). While working, keep the label (the card
 * shows progress); disabled says why next to it.
 */
export type ButtonKind = 'main' | 'lime' | 'outline' | 'quiet' | 'round'
export type ButtonSize = 'app' | 'focus' | 'row'

const kinds: Record<Exclude<ButtonKind, 'round'>, string> = {
  main: 'bg-[var(--forest)] text-[var(--white)]',
  lime: 'bg-[var(--lime)] text-[var(--forest)]',
  outline: 'gros-button-outline bg-[var(--white)] text-[var(--forest)]',
  quiet: 'bg-transparent text-[var(--stone)] font-medium'
}
const sizes: Record<ButtonSize, string> = {
  app: 'h-[var(--control-md)] px-[var(--space-7)] type-body-strong',
  focus: 'h-[var(--control-lg)] px-[var(--space-8)] type-body-strong',
  row: 'h-[var(--control-sm)] px-[var(--space-5)] type-body-strong gros-button-row'
}

/** The classes of a button, for a link or a form button that looks like one. */
export function buttonClasses(
  kind: ButtonKind = 'main',
  size: ButtonSize = 'app'
) {
  const base =
    'inline-flex shrink-0 cursor-pointer items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-pill)] disabled:cursor-not-allowed disabled:opacity-40'
  if (kind === 'round')
    return cn(
      base,
      'size-[var(--control-round)] bg-[var(--lime)] text-[var(--forest)]'
    )
  return cn(
    base,
    kinds[kind],
    sizes[size],
    // Quiet actions (Change, Edit) are the small 44 px kind, weight 500.
    kind === 'quiet' &&
      'gros-button-row h-[var(--control-sm)] px-[var(--space-3)]'
  )
}

type Common = { kind?: ButtonKind; size?: ButtonSize; className?: string }

export function Button({
  kind = 'main',
  size = 'app',
  className,
  label,
  type = 'button',
  ...rest
}: Common &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
    /** The words on the button; for `round`, its spoken label. */
    label: string
    children?: never
  }) {
  return (
    <button
      type={type}
      {...rest}
      className={cn(buttonClasses(kind, size), className)}
      aria-label={kind === 'round' ? label : undefined}
    >
      {kind === 'round' ? (
        <ArrowRight aria-hidden size={24} strokeWidth={2} />
      ) : (
        label
      )}
    </button>
  )
}

/** A link that looks like a button: the same kinds and sizes. */
export function ButtonLink({
  href,
  label,
  kind = 'main',
  size = 'app',
  className
}: Common & { href: string; label: string }) {
  return (
    <Link
      href={href}
      className={cn(buttonClasses(kind, size), className)}
      aria-label={kind === 'round' ? label : undefined}
    >
      {kind === 'round' ? (
        <ArrowRight aria-hidden size={24} strokeWidth={2} />
      ) : (
        label
      )}
    </Link>
  )
}
