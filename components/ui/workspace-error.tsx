'use client'
import { RefreshCw } from 'lucide-react'
import { Button } from './button'

export default function WorkspaceError({
  retry
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  return (
    <section className="mx-auto max-w-6xl">
      <div
        role="alert"
        className="max-w-xl rounded-2xl border border-[var(--line)] bg-[var(--surface-raised)] p-6"
      >
        <h1 className="text-xl font-semibold">This workspace couldn’t load</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">
          Try loading it again. If the problem continues, check your connection
          and return to the workspace later.
        </p>
        <Button onClick={retry} variant="secondary" className="mt-5">
          <RefreshCw className="size-4" aria-hidden />
          Try again
        </Button>
      </div>
    </section>
  )
}
