import Link, { type LinkProps } from 'next/link'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Tertiary action from docs/DESIGN.md: ink text with a trailing arrow and an
 * underline on hover, for navigation-like actions ("View all captures →").
 */
export function TextLink<Href extends string>({
  children,
  className,
  arrow = true,
  ...props
}: LinkProps<Href> &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps<Href>> & {
    children: ReactNode
    arrow?: boolean
  }) {
  return (
    <Link
      className={cn(
        'group inline-flex items-center gap-1.5 rounded-[var(--radius-control)] text-sm font-medium text-[var(--text)] underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-2 focus-visible:outline-hidden',
        className
      )}
      {...props}
    >
      {children}
      {arrow && (
        <span
          aria-hidden
          className="transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none"
        >
          →
        </span>
      )}
    </Link>
  )
}
