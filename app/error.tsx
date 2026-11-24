'use client'

import { useEffect } from 'react'
import { Button } from '@/components/gros/button'
import { grosRoot } from '@/components/gros/font'
import { ErrorState } from '@/components/gros/states'

/**
 * The app's last error page (UI-AUTH), for a page with no error state of
 * its own: the GROS error card on the mist page. What happened, that what
 * was saved is safe, and Try again, which reads the page again and never
 * repeats a save.
 */
export default function ErrorPage({
  error,
  retry
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div
      className={grosRoot(
        'flex min-h-dvh items-center justify-center px-[var(--space-6)] py-[var(--space-12)]'
      )}
    >
      <main className="w-full max-w-[640px]">
        <ErrorState
          title="Page did not open"
          reason="We could not open this page just now. What you saved is safe."
          action={<Button label="Try again" onClick={retry} />}
        />
        {error.digest ? (
          <p className="type-caption mt-[var(--space-3)] px-[var(--space-8)] text-[var(--stone)]">
            Reference: {error.digest}
          </p>
        ) : null}
      </main>
    </div>
  )
}
