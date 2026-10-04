'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { Search, X, ChevronDown, LogOut, CircleHelp } from 'lucide-react'
import { signOut } from '@/features/auth/presentation/actions'
import { NavigationList } from './navigation-list'
import type { NavigationItem } from './nav-data'

export function HeaderActions({
  navigation,
  identity,
  contextLabel
}: {
  navigation: NavigationItem[]
  identity: { name: string; initials: string; role: string }
  contextLabel: string
}) {
  const search = useRef<HTMLDialogElement>(null)
  const account = useRef<HTMLDetailsElement>(null)
  const [query, setQuery] = useState('')
  const openSearch = () => {
    search.current?.showModal()
    search.current?.querySelector('input')?.focus()
  }
  const help = navigation.find(
    (item) => item.icon === 'support' || item.icon === 'help'
  )
  const settings = navigation.find((item) => item.href === '/settings')
  const matches = navigation.filter((item) =>
    item.label.toLowerCase().includes(query.trim().toLowerCase())
  )

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        openSearch()
      }
      if (event.key === 'Escape' && search.current?.open) {
        event.preventDefault()
        search.current.close()
        return
      }
      if (event.key === 'Escape' && account.current?.open) {
        account.current.open = false
        account.current.querySelector('summary')?.focus()
      }
    }
    function onPointer(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        account.current?.open &&
        !account.current.contains(event.target)
      )
        account.current.open = false
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [])

  return (
    <div className="ml-auto flex items-center gap-2 sm:gap-3">
      <button
        type="button"
        onClick={openSearch}
        aria-label="Search workspace"
        className="flex min-h-10 items-center gap-2 rounded-lg px-2.5 text-sm text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-none sm:border sm:border-[var(--line)] sm:bg-[var(--surface-raised)]"
      >
        <Search className="size-4" aria-hidden />
        <span className="hidden sm:inline">Find a page</span>
        <kbd className="ml-5 hidden rounded border border-[var(--line)] px-1.5 py-0.5 font-sans text-xs text-[var(--text-faint)] xl:inline">
          ⌘ K / Ctrl K
        </kbd>
      </button>
      {help && (
        <Link
          href={help.href}
          aria-label={help.label}
          className="hidden size-10 place-items-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface-hover)] sm:grid"
        >
          <CircleHelp className="size-[1.125rem]" aria-hidden />
        </Link>
      )}
      <details ref={account} className="relative">
        <summary
          aria-label={`Open account menu for ${identity.name}`}
          className="flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-lg p-1 [&::-webkit-details-marker]:hidden"
        >
          <span className="grid size-8 place-items-center rounded-full border border-[var(--line)] bg-[var(--surface-hover)] text-[0.6875rem] font-semibold">
            {identity.initials}
          </span>
          <ChevronDown
            className="hidden size-3.5 text-[var(--text-faint)] sm:block"
            aria-hidden
          />
        </summary>
        <div className="absolute top-12 right-0 z-30 w-60 rounded-xl bg-[var(--surface-raised)] p-2 shadow-[0_8px_35px_-8px_rgba(29,29,31,0.22)]">
          <div className="border-b border-[var(--line)] px-3 py-3">
            <p className="text-sm font-semibold break-words">{identity.name}</p>
            <p className="mt-1 text-xs text-[var(--text-muted)] capitalize">
              {identity.role} · {contextLabel}
            </p>
          </div>
          {settings && (
            <Link
              href={settings.href}
              onClick={() => {
                if (account.current) account.current.open = false
              }}
              className="mt-1 block rounded-lg px-3 py-2.5 text-sm hover:bg-[var(--surface-hover)]"
            >
              Workspace settings
            </Link>
          )}
          {help && (
            <Link
              href={help.href}
              onClick={() => {
                if (account.current) account.current.open = false
              }}
              className="block rounded-lg px-3 py-2.5 text-sm hover:bg-[var(--surface-hover)]"
            >
              {help.label}
            </Link>
          )}
          <form action={signOut}>
            <button
              type="submit"
              className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-sm text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
            >
              <LogOut className="size-4" aria-hidden />
              Sign out
            </button>
          </form>
        </div>
      </details>
      <dialog
        ref={search}
        onClose={() => setQuery('')}
        aria-labelledby="workspace-search-title"
        className="m-auto max-h-[80dvh] w-[min(32rem,calc(100%_-_2rem))] overflow-y-auto rounded-2xl border border-[var(--line)] bg-[var(--surface-raised)] text-[var(--text)]"
      >
        <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-4">
          <h2 id="workspace-search-title" className="font-semibold">
            Find a page
          </h2>
          <button
            type="button"
            aria-label="Close search"
            onClick={() => search.current?.close()}
            className="grid size-9 place-items-center rounded-lg hover:bg-[var(--surface-hover)]"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
        <div className="px-5 pt-4">
          <label htmlFor="workspace-search" className="sr-only">
            Search pages
          </label>
          <input
            id="workspace-search"
            type="search"
            autoFocus
            placeholder="Campaigns, assets, settings…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-h-11 w-full rounded-lg border border-[var(--line-strong)] bg-[var(--surface-raised)] px-3 text-sm outline-none focus:ring-2 focus:ring-[var(--focus)]"
          />
        </div>
        {matches.length ? (
          <NavigationList
            navigation={matches}
            label="Search results"
            variant="popover"
            onNavigate={() => search.current?.close()}
          />
        ) : (
          <p role="status" className="p-5 text-sm text-[var(--text-muted)]">
            No pages match “{query}”. Try another name.
          </p>
        )}
      </dialog>
    </div>
  )
}
