'use client'

import { ArrowLeft } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { MouseEvent } from 'react'

/** True when the last page was in this app (so "back" stays in the app). */
export function cameFromThisApp(referrer: string, origin: string) {
  try {
    return referrer !== '' && new URL(referrer).origin === origin
  } catch {
    return false
  }
}

/**
 * `← Back` that goes back in history when the owner came from inside the
 * app in this tab, and otherwise opens `fallback`. Modified clicks (new tab, new
 * window) always follow the link.
 */
export function HistoryBack({ fallback }: { fallback: Route }) {
  const router = useRouter()
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return
    // A new tab has a referrer but no history, so it needs both checks.
    if (
      window.history.length > 1 &&
      cameFromThisApp(document.referrer, window.location.origin)
    ) {
      event.preventDefault()
      router.back()
    }
  }
  return (
    <Link
      href={fallback}
      onClick={onClick}
      className="inline-flex min-h-10 items-center gap-2 rounded-[var(--radius-control)] text-sm text-[var(--text-muted)] hover:text-[var(--text)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-hidden"
    >
      <ArrowLeft className="size-4" aria-hidden />
      Back
    </Link>
  )
}
