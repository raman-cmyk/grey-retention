'use client'
import { RefreshCw } from 'lucide-react'
import { Button } from './button'

/**
 * Error state from docs/DESIGN.md: what happened, what was kept, what to do.
 * Server error details stay private; only the opaque digest is shown so
 * support can find the matching log entry. Never put data into a custom
 * `digest` on a thrown error: it is displayed here as-is.
 */
export default function WorkspaceError({
  error,
  retry
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  return (
    <section
      role="alert"
      className="max-w-xl rounded-[var(--radius-panel)] border border-[var(--line)] bg-[var(--surface-raised)] p-6 sm:p-8"
    >
      <p className="tracking-label font-mono text-[0.6875rem] text-[var(--danger-ink)] uppercase">
        Something went wrong
      </p>
      <h1 className="tracking-display mt-3 font-serif text-3xl leading-tight font-normal">
        This page couldn’t load
      </h1>
      <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">
        Anything you saved before is still stored. Try again reloads this page;
        it never repeats a save.
      </p>
      <Button onClick={retry} variant="secondary" className="mt-6">
        <RefreshCw className="size-4" aria-hidden />
        Try again
      </Button>
      {error.digest && (
        <p className="mt-5 font-mono text-[0.6875rem] text-[var(--text-muted)]">
          Reference: {error.digest}
        </p>
      )}
    </section>
  )
}
