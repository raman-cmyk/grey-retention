'use client'

import type { Route } from 'next'
import Link from 'next/link'
import { Bell } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

export const noticesHref: Route = '/notifications'
/** Where the button asks how many notices are new. */
export const unreadUrl = '/api/v1/notifications'

/** "Notifications, 3 new": the button's spoken label. */
export function noticesLabel(unread: number) {
  return unread > 0
    ? `Notifications, ${unread > 99 ? '99+' : unread} new`
    : 'Notifications'
}

/**
 * PICK-107: the round Notifications button in the top bar, beside Settings.
 * It asks how many of the person's notices are new when the page opens and
 * when the window comes back into view, and shows the number beside the
 * bell (the button widens to hold it). Until it knows, or when the answer
 * does not come, it is the plain bell: never a wrong number.
 */
export function NoticesButton({
  current = false,
  className
}: {
  current?: boolean
  /** The round white pill of the bar (`roundPillClass`). */
  className: string
}) {
  const [unread, setUnread] = useState(0)
  useEffect(() => {
    let live = true
    const ask = () => {
      if (document.visibilityState === 'hidden') return
      fetch(unreadUrl, { cache: 'no-store', credentials: 'same-origin' })
        .then((response) => (response.ok ? response.json() : null))
        .then((body: { data?: { unread?: unknown } } | null) => {
          const count = body?.data?.unread
          if (live && typeof count === 'number' && Number.isInteger(count))
            setUnread(Math.max(0, count))
        })
        .catch(() => {})
    }
    ask()
    document.addEventListener('visibilitychange', ask)
    return () => {
      live = false
      document.removeEventListener('visibilitychange', ask)
    }
  }, [])
  return (
    <Link
      href={noticesHref}
      aria-label={noticesLabel(unread)}
      aria-current={current ? 'page' : undefined}
      className={cn(
        className,
        unread > 0 &&
          'h-[var(--control-md)] w-auto gap-[var(--space-2)] px-[var(--space-4)]'
      )}
    >
      <Bell aria-hidden size={22} strokeWidth={2} />
      {unread > 0 ? (
        <span aria-hidden className="type-body-strong">
          {unread > 99 ? '99+' : unread}
        </span>
      ) : null}
    </Link>
  )
}
