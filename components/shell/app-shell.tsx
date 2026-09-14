import { Bell, ChevronDown, Search } from 'lucide-react'
import { BrandMark } from '@/components/brand/brand-mark'
import {
  brandCssVariables,
  defaultBrandPresentation,
  resolveAccessibleBrandPresentation,
  type BrandPresentation
} from '@/lib/branding/presentation'
import type { NavigationItem } from './nav-data'
import { signOut } from '@/features/auth/presentation/actions'
import { MobileNavigation } from './mobile-navigation'
import { NavigationList } from './navigation-list'

export function AppShell({
  children,
  navigation,
  workspace,
  contextLabel = 'Client workspace',
  brand = defaultBrandPresentation
}: {
  children: React.ReactNode
  navigation: NavigationItem[]
  workspace?: string
  contextLabel?: string
  brand?: BrandPresentation
}) {
  const presentation = resolveAccessibleBrandPresentation(brand)
  const workspaceName = workspace ?? presentation.workspaceName
  const brandStyle = brandCssVariables(presentation) as React.CSSProperties

  return (
    <div
      className="min-h-screen bg-[var(--surface)] text-[var(--text)]"
      style={brandStyle}
    >
      <a
        href="#main-content"
        className="fixed top-3 left-3 z-50 -translate-y-20 rounded-md bg-[var(--text)] px-4 py-2 text-sm text-[var(--surface)] focus:translate-y-0"
      >
        Skip to content
      </a>
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-[15.5rem] border-r border-[var(--line)] bg-[var(--nav)] text-[var(--nav-text)] lg:flex lg:flex-col">
        <div className="flex h-[4.75rem] items-center border-b border-[var(--line)] px-5">
          <BrandMark brand={presentation} />
        </div>
        <NavigationList
          navigation={navigation}
          label={`${contextLabel} navigation`}
          variant="sidebar"
        />
        <div className="border-t border-[var(--line)] p-4">
          <p className="font-[family-name:var(--font-data)] text-[0.65rem] tracking-[0.08em] text-[var(--nav-muted)] uppercase">
            {presentation.demoLabel}
          </p>
          <p className="mt-1 text-sm font-semibold text-[var(--nav-text)]">
            {presentation.demoDescription}
          </p>
          <form action={signOut} className="mt-4">
            <button
              type="submit"
              className="text-xs font-semibold text-[var(--nav-muted)] underline underline-offset-4 hover:text-[var(--nav-text)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-none"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="lg:pl-[15.5rem]">
        <header className="sticky top-0 z-10 flex min-h-[4.75rem] items-center gap-3 border-b border-[var(--line)] bg-[color-mix(in_srgb,var(--surface)_94%,transparent)] px-4 backdrop-blur-md sm:px-6 lg:gap-4 lg:px-8">
          <MobileNavigation
            navigation={navigation}
            contextLabel={contextLabel}
            brand={presentation}
          />
          <button
            className="flex min-w-0 items-center gap-2 text-left"
            type="button"
          >
            <span className="truncate text-sm font-semibold">
              {workspaceName}
            </span>
            <ChevronDown
              className="size-4 text-[var(--text-muted)]"
              aria-hidden
            />
          </button>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              className="grid size-10 place-items-center rounded-[var(--radius-control)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-none"
              aria-label="Search"
            >
              <Search className="size-[1.1rem]" aria-hidden />
            </button>
            <button
              type="button"
              className="relative grid size-10 place-items-center rounded-[var(--radius-control)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-none"
              aria-label="Notifications, 1 unread"
            >
              <Bell className="size-[1.1rem]" aria-hidden />
              <span
                className="absolute top-2.5 right-2.5 size-1.5 rounded-full bg-[var(--brand-secondary)]"
                aria-hidden
              />
            </button>
            <button
              type="button"
              aria-label={`Open account menu for ${presentation.userName}`}
              className="grid size-9 place-items-center rounded-full bg-[var(--brand-soft)] text-xs font-bold text-[var(--brand-ink)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-none"
            >
              {presentation.userInitials}
            </button>
          </div>
        </header>
        <main id="main-content" className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  )
}
