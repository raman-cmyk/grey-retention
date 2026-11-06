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
      <div className="max-w-lg text-center">
        <h1 className="tracking-display font-[family-name:var(--font-display)] text-4xl font-normal">
          Proof could not be opened.
        </h1>
        <p className="mt-4 text-[var(--text-muted)]">
          Retry now. If this continues, report request reference.
        </p>
        <Button className="mt-7" onClick={reset}>
          Retry
        </Button>
      </div>
    </main>
  )
}
