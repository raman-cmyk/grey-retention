'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'

export default function ErrorPage({
  error,
  reset
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <main className="grid min-h-screen place-items-center px-6">
      <div className="max-w-lg">
        <p className="tracking-label font-mono text-[0.6875rem] text-[var(--danger-ink)] uppercase">
          Something went wrong
        </p>
        <h1 className="tracking-display mt-3 font-serif text-4xl font-normal">
          This page couldn’t load
        </h1>
        <p className="mt-4 text-[var(--text-muted)]">
          Anything you saved before is still stored. Try again reloads this
          page; it never repeats a save.
        </p>
        <Button className="mt-7" variant="secondary" onClick={reset}>
          Try again
        </Button>
        {error.digest && (
          <p className="mt-5 font-mono text-[0.6875rem] text-[var(--text-muted)]">
            Reference: {error.digest}
          </p>
        )}
      </div>
    </main>
  )
}
