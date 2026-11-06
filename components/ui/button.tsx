import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

/**
 * Buttons from docs/DESIGN.md:
 * - primary: solid ink (black) — the main action of a section;
 * - accent: solid electric blue — the ONE key action on a screen;
 * - secondary: light grey fill — alternatives such as Cancel or Preview;
 * - quiet: text-only with a hover fill — low-emphasis actions;
 * - danger: muted red — destructive actions that confirm their exact scope.
 * For navigation-like actions use `TextLink` (text with an arrow).
 */
export const buttonVariants = cva(
  'inline-flex min-h-10 self-start items-center justify-center gap-2 rounded-[var(--radius-control)] px-4 text-sm font-medium transition-[background-color,color,box-shadow] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)] disabled:pointer-events-none disabled:opacity-45',
  {
    variants: {
      variant: {
        primary:
          'bg-[var(--brand-primary)] text-[var(--on-brand)] hover:bg-[var(--brand-primary-strong)]',
        accent:
          'bg-[var(--brand-secondary)] text-[var(--on-brand-secondary)] hover:bg-[var(--brand-ink)]',
        secondary:
          'bg-[var(--surface-hover)] text-[var(--text)] hover:bg-[var(--line)]',
        quiet:
          'text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]',
        danger:
          'bg-[var(--danger)] text-[var(--on-danger)] hover:bg-[var(--danger-strong)]'
      },
      size: {
        sm: 'min-h-8 px-3 text-xs',
        md: 'min-h-10 px-4',
        lg: 'min-h-12 px-5 text-base'
      }
    },
    defaultVariants: { variant: 'primary', size: 'md' }
  }
)

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }

export function Button({
  className,
  variant,
  size,
  asChild,
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot : 'button'
  return (
    <Component
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
}
