'use client'

import type { Route } from 'next'
import Link from 'next/link'
import { Bell } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

export const noticesHref: Route = '/notifications'
/** Where the button asks how many notices are new. */
export const unreadUrl = '/api/v1/notifications'

/**
 * How the bell knows the number: `ask` (it asks when the page opens and
 * when the window comes back), `wait` (a loading frame: the page that
 * follows asks, so a navigation asks once), or the number itself, read by
 * the page on the server (Notifications, which re-reads it after Open or
 * Mark all read).
 */
export type NoticeCount = 'ask' | 'wait' | number

/** "Notifications, 3 new": the button's spoken label. */
export function noticesLabel(unread: number) {
  return unread > 0
    ? `Notifications, ${unread > 99 ? '99+' : unread} new`
    : 'Notifications'
}

/**
 * PICK-107: the round Notifications button in the top bar, beside Settings,
 * with how many of the person's notices are new beside the bell (the
 * button widens to hold it). Until it knows, or when the answer is not a
 * count, it is the plain bell: never a wrong or an old number.
 */
export function NoticesButton({
  current = false,
  className,
  count = 'ask'
}: {
  current?: boolean
  /** The round white pill of the bar (`roundPillClass`). */
  className: string
  count?: NoticeCount
}) {
  const [asked, setAsked] = useState(0)
  const ask = count === 'ask'
  useEffect(() => {
    if (!ask) return
    let live = true
    const read = () => {
      if (document.visibilityState === 'hidden') return
      fetch(unreadUrl, { cache: 'no-store', credentials: 'same-origin' })
        .then((response) => (response.ok ? response.json() : null))
        .then((body: { data?: { unread?: unknown } } | null) => {
          const n = body?.data?.unread
          if (live)
            setAsked(
              typeof n === 'number' && Number.isInteger(n) ? Math.max(0, n) : 0
            )
        })
        .catch(() => {
          if (live) setAsked(0)
        })
    }
    read()
    document.addEventListener('visibilitychange', read)
    return () => {
      live = false
      document.removeEventListener('visibilitychange', read)
    }
  }, [ask])
  const unread =
    typeof count === 'number' ? Math.max(0, count) : ask ? asked : 0
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
