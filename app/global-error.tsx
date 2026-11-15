'use client'

import { useEffect } from 'react'
import { defaultBrandPresentation } from '@/lib/branding/presentation'

/**
 * The last-resort page (BAS-007): shown when the root layout itself fails,
 * in place of it, so the app's styles and fonts are not loaded here. Same
 * words as the app's error page; plain on purpose (no new design).
 */
export default function GlobalError({
  error,
  retry
}: {
  error?: (Error & { digest?: string }) | null
  retry: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <html lang="en" style={{ colorScheme: 'light dark' }}>
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          padding: '0 24px',
          fontFamily: 'system-ui, sans-serif',
          lineHeight: 1.5
        }}
      >
        <title>{`Something went wrong · ${defaultBrandPresentation.productName}`}</title>
        <main style={{ maxWidth: '32rem' }}>
          <p>Something went wrong</p>
          <h1 style={{ fontWeight: 400 }}>This page couldn’t load</h1>
          <p>
            Anything you saved before is still stored. Try again reloads this
            page; it never repeats a save.
          </p>
          <button type="button" onClick={() => retry()}>
            Try again
          </button>
          {error?.digest && (
            <p style={{ fontFamily: 'ui-monospace, monospace' }}>
              Reference: {error.digest}
            </p>
          )}
        </main>
      </body>
    </html>
  )
}
