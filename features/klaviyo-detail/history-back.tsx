'use client'

import { ArrowLeft } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

/** `← Back` that goes back in history, or to `fallback` on a fresh tab. */
export function HistoryBack({ fallback }: { fallback: Route }) {
  const router = useRouter()
  return (
    <Link
      href={fallback}
      onClick={(event) => {
        if (window.history.length > 1) {
          event.preventDefault()
          router.back()
        }
      }}
      className="inline-flex min-h-10 items-center gap-2 rounded-[var(--radius-control)] text-sm text-[var(--text-muted)] hover:text-[var(--text)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-hidden"
    >
      <ArrowLeft className="size-4" aria-hidden />
      Back
    </Link>
  )
}
