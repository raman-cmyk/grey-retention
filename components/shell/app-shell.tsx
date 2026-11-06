import { Layers } from 'lucide-react'
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
import { HeaderActions } from './header-actions'

export function AppShell({
  children,
  navigation,
  workspace,
  contextLabel = 'Client workspace',
  workspaceLabel = contextLabel,
  identity = { name: 'Your account', initials: 'YA', role: 'Workspace member' },
  brand = defaultBrandPresentation,
  status = {
    label: 'Your workspace',
    description: 'Emails are saved privately'
  }
}: {
  children: React.ReactNode
  navigation: NavigationItem[]
  workspace?: string
  contextLabel?: string
  /** Visible label above the workspace or store name in the header (UX-002). */
  workspaceLabel?: string
  identity?: { name: string; initials: string; role: string }
  brand?: BrandPresentation
  /** Shown for real signed-in sessions; demo mode always uses the brand's demo copy. */
  status?: { label: string; description: string }
}) {
  const presentation = resolveAccessibleBrandPresentation(brand)
  const shown =
    process.env.AUTH_MODE === 'demo'
      ? {
          label: presentation.demoLabel,
          description: presentation.demoDescription
        }
      : status
  const workspaceName = workspace ?? presentation.workspaceName
  const brandStyle = brandCssVariables(presentation) as React.CSSProperties

  return (
    <div
      className="min-h-screen bg-[var(--surface)] font-sans text-[var(--text)]"
      style={brandStyle}
    >
      <a
        href="#main-content"
        className="fixed top-3 left-3 z-50 -translate-y-20 rounded-[var(--radius-control)] bg-[var(--text)] px-4 py-2 text-sm text-[var(--surface)] focus:translate-y-0"
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
        <div className="border-t border-[var(--line)] px-5 py-4">
          <div className="tracking-label flex items-center gap-2 font-mono text-[0.6875rem] text-[var(--nav-text)] uppercase">
            <span className="size-1.5 bg-[var(--text-faint)]" aria-hidden />
            {shown.label}
          </div>
          <p className="mt-1.5 text-xs text-[var(--nav-muted)]">
            {shown.description}
          </p>
          <form action={signOut} className="mt-3">
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
        <header className="sticky top-0 z-10 flex min-h-[4.75rem] items-center gap-3 border-b border-[var(--line)] bg-[var(--nav)] px-4 sm:px-6 lg:gap-4 lg:px-8">
          <MobileNavigation
            navigation={navigation}
            contextLabel={contextLabel}
            brand={presentation}
            statusDescription={shown.description}
          />
          <Layers
            className="hidden size-4 text-[var(--text-faint)] lg:block"
            aria-hidden
          />
          <div className="min-w-0" data-testid="shell-workspace">
            <p className="tracking-label font-mono text-[0.6875rem] leading-none text-[var(--nav-muted)] uppercase">
              {workspaceLabel}
            </p>
            <p className="mt-1 truncate text-sm font-medium text-[var(--nav-text)]">
              {workspaceName}
            </p>
          </div>
          <HeaderActions
            navigation={navigation}
            identity={identity}
            contextLabel={workspaceLabel}
          />
        </header>
        <main id="main-content" className="px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
          <div className="mx-auto w-full max-w-[var(--gr-content-max)]">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
