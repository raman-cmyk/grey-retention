import type { Route } from 'next'
import Link from 'next/link'
import { MessageCircle, Settings } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Card } from './card'
import { grosRoot } from './font'
import { Mark } from './mark'

/**
 * Nav (BRAND.md): the top bar is the only navigation. The mark and the page
 * title on the left, a white pill menu of five items in the middle, and on
 * the right the wide Ask GROS button and the round Settings button. No
 * sidebar. On a narrow screen the three parts wrap onto their own lines;
 * nothing hides behind a menu icon.
 */
// Until each GROS screen lands, an item opens the old screen that does its
// job today (typed routes check every address), and an item with no screen
// at all yet is left out of the bar rather than leading nowhere.
export const navItems = [
  { key: 'home', label: 'Home', href: '/home' },
  { key: 'plan', label: 'Plan', href: '/plan' },
  { key: 'inspiration', label: 'Inspiration', href: '/library/inspirations' },
  { key: 'audiences', label: 'Audiences', href: null },
  { key: 'results', label: 'Results', href: '/reports' }
] as const satisfies readonly {
  key: string
  label: string
  href: Route | null
}[]
export type NavKey = (typeof navItems)[number]['key']
/** The page's place in the bar: a menu item, or one of the two buttons. */
export type NavPlace = NavKey | 'settings' | 'ask'
export const settingsHref: Route = '/settings'
export const askHref: Route = '/gros'
/** The assistant's name (the white label may rename it). */
export const defaultAssistant = 'GROS'

export function TopBar({
  current,
  title,
  assistant = defaultAssistant
}: {
  current?: NavPlace
  /** The page title; on Home it greets the store. */
  title: string
  assistant?: string
}) {
  const here = (place: NavPlace) => (place === current ? 'page' : undefined)
  return (
    <header className="flex flex-wrap items-center justify-between gap-[var(--space-4)] py-[var(--space-6)]">
      <div className="flex min-w-0 items-center gap-[var(--space-3)]">
        <Mark size={44} />
        {/* The whole title wraps rather than losing the store's name. */}
        <h1 className="type-page-title min-w-0 break-words">{title}</h1>
      </div>
      <nav aria-label="Main">
        <ul className="gros-menu flex flex-wrap items-center rounded-[var(--radius-pill)] bg-[var(--white)]">
          {navItems
            .flatMap((item) =>
              item.href ? [{ ...item, href: item.href }] : []
            )
            .map((item) => (
              <li key={item.key}>
                <Link
                  href={item.href}
                  aria-current={here(item.key)}
                  className={cn(
                    'gros-menu-item gros-mark inline-flex items-center rounded-[var(--radius-pill)]',
                    item.key === current
                      ? 'bg-[var(--lime)] font-semibold text-[var(--forest)]'
                      : 'font-medium text-[var(--stone)]'
                  )}
                >
                  {item.label}
                </Link>
              </li>
            ))}
        </ul>
      </nav>
      <div className="flex items-center gap-[var(--space-2)]">
        <Link
          href={askHref}
          aria-current={here('ask')}
          className="type-body-strong inline-flex h-[var(--control-md)] items-center gap-[var(--space-2)] rounded-[var(--radius-pill)] bg-[var(--white)] px-[var(--space-6)] text-[var(--ink)]"
        >
          <MessageCircle aria-hidden size={20} strokeWidth={2} />
          Ask {assistant}
        </Link>
        <Link
          href={settingsHref}
          aria-label="Settings"
          aria-current={here('settings')}
          className="inline-flex size-[var(--control-md)] items-center justify-center rounded-[var(--radius-pill)] bg-[var(--white)] text-[var(--ink)]"
        >
          <Settings aria-hidden size={22} strokeWidth={2} />
        </Link>
      </div>
    </header>
  )
}

/**
 * An app page: the mist page, a skip link, the top bar, then rows of cards
 * 20 px apart; the content at most 1320 px wide inside a 24 px gutter.
 * Cards stack in one column on a narrow screen; nothing scrolls sideways.
 * GROS screens live in their own route group (no old AppShell around them).
 */
export function AppPage({
  current,
  title,
  assistant,
  children
}: {
  current?: NavPlace
  title: string
  assistant?: string
  children: ReactNode
}) {
  return (
    <div className={grosRoot('min-h-dvh')}>
      <a
        href="#main-content"
        className="type-body-strong sr-only rounded-[var(--radius-pill)] bg-[var(--forest)] px-[var(--space-6)] py-[var(--space-3)] text-[var(--white)] focus:not-sr-only focus:absolute focus:top-[var(--space-4)] focus:left-[var(--space-4)]"
      >
        Skip to content
      </a>
      <div className="mx-auto w-full max-w-[calc(var(--page-max)+var(--space-6)*2)] px-[var(--space-6)] pb-[var(--space-12)]">
        <TopBar current={current} title={title} assistant={assistant} />
        <main
          id="main-content"
          tabIndex={-1}
          className="flex flex-col gap-[var(--space-5)] outline-none"
        >
          {children}
        </main>
      </div>
    </div>
  )
}

/**
 * A GROS page while its data is read (a route's `loading.tsx`): the bar at
 * once and one card saying what opens. It draws no `<main>` and no skip
 * link: while the page streams in, Next keeps the page hidden beside this
 * fallback, and the page alone holds the one `main#main-content` (two
 * would confuse screen readers and the browser tests).
 */
export function LoadingPage({
  current,
  title,
  words,
  assistant
}: {
  current?: NavPlace
  title: string
  /** What is opening, in the owner's words: "Opening Home". */
  words: string
  assistant?: string
}) {
  return (
    <div className={grosRoot('min-h-dvh')}>
      <div className="mx-auto w-full max-w-[calc(var(--page-max)+var(--space-6)*2)] px-[var(--space-6)] pb-[var(--space-12)]">
        <TopBar current={current} title={title} assistant={assistant} />
        <div aria-busy="true" className="flex flex-col gap-[var(--space-5)]">
          <Card>
            <p aria-live="polite" className="type-heading">
              {words}
            </p>
          </Card>
        </div>
      </div>
    </div>
  )
}

/** Cards side by side on a laptop, one column below it. */
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
        columns === 3 ? 'xl:grid-cols-3' : 'lg:grid-cols-2'
      )}
    >
      {children}
    </div>
  )
}
