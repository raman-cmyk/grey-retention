import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export const TextField = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(function TextField({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        'min-h-11 w-full rounded-[var(--radius-control)] bg-[var(--surface-raised)] px-3.5 text-sm text-[var(--text)] ring-1 ring-[var(--line-strong)] transition-[box-shadow,background-color] outline-none ring-inset placeholder:text-[var(--text-faint)] hover:bg-[var(--surface-hover)] focus:ring-2 focus:ring-[var(--focus)] disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
})
