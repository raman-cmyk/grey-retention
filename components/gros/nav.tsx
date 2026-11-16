import type { Route } from 'next'
import Link from 'next/link'
import { MessageCircle, Settings } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { grosRoot } from './font'
import { Mark } from './mark'

/**
 * Nav (BRAND.md): the top bar is the only navigation. The mark and the page
 * title on the left, a white pill menu of five items in the middle, and on
 * the right the wide Ask GROS button and the round Settings button. No
 * sidebar. On a narrow screen the three parts wrap onto their own lines;
 * nothing hides behind a menu icon.
 */
// Typed routes: the addresses of screens not built yet are cast until
// each screen lands (then the cast goes, and the build checks the address).
export const navItems = [
  { key: 'home', label: 'Home', href: '/home' as Route },
  { key: 'plan', label: 'Plan', href: '/plan' as Route },
  { key: 'inspiration', label: 'Inspiration', href: '/inspiration' as Route },
  { key: 'audiences', label: 'Audiences', href: '/audiences' as Route },
  { key: 'results', label: 'Results', href: '/results' as Route }
] as const
export type NavKey = (typeof navItems)[number]['key']
export const settingsHref: Route = '/settings'
export const askHref: Route = '/gros'

export function TopBar({
  current,
  title
}: {
  /** The page's menu item; none for a page outside the five (Settings). */
  current?: NavKey
  /** The page title; on Home it greets the store. */
  title: string
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-[var(--space-4)] py-[var(--space-6)]">
      <div className="flex min-w-0 items-center gap-[var(--space-3)]">
        <Mark size={44} />
        <h1 className="type-page-title truncate">{title}</h1>
      </div>
      <nav aria-label="Main">
        <ul className="gros-menu flex flex-wrap items-center rounded-[var(--radius-pill)] bg-[var(--white)]">
          {navItems.map((item) => {
            const here = item.key === current
            return (
              <li key={item.key}>
                <Link
                  href={item.href}
                  aria-current={here ? 'page' : undefined}
                  className={cn(
                    'gros-menu-item inline-flex items-center rounded-[var(--radius-pill)]',
                    here
                      ? 'bg-[var(--lime)] font-semibold text-[var(--forest)]'
                      : 'font-medium text-[var(--stone)]'
                  )}
                >
                  {item.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
      <div className="flex items-center gap-[var(--space-2)]">
        <Link
          href={askHref}
          className="type-body-strong inline-flex h-[var(--control-md)] items-center gap-[var(--space-2)] rounded-[var(--radius-pill)] bg-[var(--white)] px-[var(--space-6)] text-[var(--ink)]"
        >
          <MessageCircle aria-hidden size={20} strokeWidth={2} />
          Ask GROS
        </Link>
        <Link
          href={settingsHref}
          aria-label="Settings"
          className="inline-flex size-[var(--control-md)] items-center justify-center rounded-[var(--radius-pill)] bg-[var(--white)] text-[var(--ink)]"
        >
          <Settings aria-hidden size={22} strokeWidth={2} />
        </Link>
      </div>
    </header>
  )
}

/**
 * An app page: the mist page, the top bar, then rows of cards 20 px apart,
 * at most 1320 px wide with a 24 px gutter. Cards stack in one column on a
 * narrow screen; nothing scrolls sideways.
 */
export function AppPage({
  current,
  title,
  children
}: {
  current?: NavKey
  title: string
  children: ReactNode
}) {
  return (
    <div className={grosRoot('min-h-dvh')}>
      <div className="mx-auto w-full max-w-[var(--page-max)] px-[var(--space-6)] pb-[var(--space-12)]">
        <TopBar current={current} title={title} />
        <main className="flex flex-col gap-[var(--space-5)]">{children}</main>
      </div>
    </div>
  )
}

/** Cards side by side on a laptop, one column on a narrow screen. */
export function CardRow({
  children,
  columns = 2
}: {
  children: ReactNode
  columns?: 2 | 3
}) {
  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-[var(--space-5)]',
        columns === 3 ? 'lg:grid-cols-3' : 'md:grid-cols-2'
      )}
    >
      {children}
    </div>
  )
}
