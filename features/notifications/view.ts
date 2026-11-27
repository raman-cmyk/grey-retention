import type { Route } from 'next'
import { formatBrandDateTime } from '@/lib/brand-time'

/**
 * PICK-107: the notices the GROS shell lists. The database writes them
 * (migrations 20260914090108 and 090109: a ready plan, drafts in Klaviyo, first
 * results), one row per person with its own read time; the app only reads
 * them and marks them read.
 */
export const noticeKinds = ['plan_ready', 'drafts_ready', 'results_in'] as const
export type NoticeKind = (typeof noticeKinds)[number]

/** How many notices the list shows (latest change first). */
export const noticeLimit = 30

export type NoticeRow = {
  id: string
  kind: string
  message: string
  href: string | null
  read_at: string | null
  updated_at: string
}

export type Notice = {
  id: string
  kind: NoticeKind
  /** One plain line: "12 of 15 drafts are in Klaviyo". */
  line: string
  href: Route
  unread: boolean
  /** "Nov 27, 2026 · 9:07 AM", store time. */
  at: string
}

/**
 * A notice's link, only to a page of this app: a path of letters, digits,
 * dashes and slashes (the database checks the same), else the plan.
 */
export function safeNoticeHref(href: string | null | undefined): Route {
  return typeof href === 'string' &&
    /^\/[A-Za-z0-9/_-]{0,199}$/.test(href) &&
    !href.includes('//')
    ? (href as Route)
    : '/plan'
}

/** The rows as the list shows them. Pure, for tests. */
export function noticeList(rows: readonly NoticeRow[], timezone: string) {
  const items: Notice[] = rows
    .filter((row): row is NoticeRow & { kind: NoticeKind } =>
      (noticeKinds as readonly string[]).includes(row.kind)
    )
    .map((row) => ({
      id: row.id,
      kind: row.kind,
      line: row.message,
      href: safeNoticeHref(row.href),
      unread: row.read_at === null,
      at: formatBrandDateTime(row.updated_at, timezone) ?? ''
    }))
  return { items, unread: items.filter((item) => item.unread).length }
}
