import type { Route } from 'next'
import Link from 'next/link'
import { LayoutGrid, LogOut } from 'lucide-react'
import type { ReactNode } from 'react'
import { signOut } from '@/features/auth/presentation/actions'
import {
  LoadingFrame,
  MenuBar,
  PageFrame,
  roundPillClass,
  widePillClass,
  type MenuItem
} from './nav'

/**
 * The platform admin's top bar (UI-ADM): the same bar as the members' one,
 * with the admin's four areas in the pill menu. Prompts and Templates are
 * not built yet, so they are links on Dashboard rather than a fifth and
 * sixth item. No Ask GROS (it answers about one store). On the right:
 * Open workspace when the admin is also a member of a workspace, and the
 * round Log out button the old admin menu had.
 */
export const adminNavItems = [
  { key: 'dashboard', label: 'Dashboard', href: '/admin/dashboard' },
  { key: 'clients', label: 'Clients', href: '/admin/clients' },
  { key: 'inbox', label: 'Inbox', href: '/admin/inbox' },
  { key: 'operations', label: 'Operations', href: '/admin/operations' }
] as const satisfies readonly MenuItem[]
export type AdminNavKey = (typeof adminNavItems)[number]['key']
/** Where Open workspace goes: the member's Home. */
export const workspaceHref: Route = '/home'

export function AdminBar({
  current,
  title,
  member = false
}: {
  current?: AdminNavKey
  title: string
  /** The admin is also a member of a workspace: show Open workspace. */
  member?: boolean
}) {
  return (
    <MenuBar
      title={title}
      items={adminNavItems}
      current={current}
      end={
        <>
          {member ? (
            <Link href={workspaceHref} className={widePillClass}>
              <LayoutGrid aria-hidden size={20} strokeWidth={2} />
              Open workspace
            </Link>
          ) : null}
          <form action={signOut}>
            <button
              type="submit"
              aria-label="Log out"
              className={`${roundPillClass} cursor-pointer`}
            >
              <LogOut aria-hidden size={22} strokeWidth={2} />
            </button>
          </form>
        </>
      }
    />
  )
}

/** An admin page: the admin bar over the GROS page frame. */
export function AdminPage({
  current,
  title,
  member,
  children
}: {
  current?: AdminNavKey
  title: string
  member?: boolean
  children: ReactNode
}) {
  return (
    <PageFrame
      bar={<AdminBar current={current} title={title} member={member} />}
    >
      {children}
    </PageFrame>
  )
}

/** An admin page while its data is read (a route's `loading.tsx`). */
export function AdminLoadingPage({
  current,
  title,
  words
}: {
  current?: AdminNavKey
  title: string
  words: string
}) {
  return (
    <LoadingFrame
      bar={<AdminBar current={current} title={title} />}
      words={words}
    />
  )
}
