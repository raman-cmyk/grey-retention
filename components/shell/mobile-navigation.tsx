'use client'

import { useId, useRef } from 'react'
import { Menu, X } from 'lucide-react'
import { BrandMark } from '@/components/brand/brand-mark'
import type { BrandPresentation } from '@/lib/branding/presentation'
import type { NavigationItem } from './nav-data'
import { NavigationList } from './navigation-list'
import { signOut } from '@/features/auth/presentation/actions'

export function MobileNavigation({
  navigation,
  contextLabel,
  brand,
  statusDescription
}: {
  navigation: NavigationItem[]
  contextLabel: string
  brand: BrandPresentation
  statusDescription: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const menuId = useId()

  return (
    <div className="lg:hidden">
      <button
        type="button"
        aria-controls={menuId}
        aria-label="Open navigation"
        className="grid size-10 place-items-center rounded-[var(--radius-control)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-none"
        onClick={() => ref.current?.showModal()}
      >
        <Menu className="size-5" aria-hidden />
      </button>
      <dialog
        ref={ref}
        aria-label={`${contextLabel} navigation menu`}
        id={menuId}
        className="fixed inset-y-0 left-0 m-0 h-dvh max-h-dvh w-[min(20rem,calc(100vw-2rem))] max-w-none overflow-y-auto border-0 border-r border-[var(--line)] bg-[var(--nav)] p-0 text-[var(--nav-text)]"
      >
        <div className="flex h-[4.75rem] items-center justify-between border-b border-[var(--line)] px-5">
          <BrandMark brand={brand} />
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => ref.current?.close()}
            className="grid size-10 place-items-center rounded-lg hover:bg-[var(--surface-hover)]"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <NavigationList
          navigation={navigation}
          label={`${contextLabel} mobile navigation`}
          variant="popover"
          onNavigate={() => ref.current?.close()}
        />
        <div className="border-t border-[var(--line)] p-5">
          <p className="text-xs text-[var(--nav-muted)]">{statusDescription}</p>
          <form action={signOut} className="mt-3">
            <button
              type="submit"
              className="min-h-11 text-sm font-semibold underline underline-offset-4"
            >
              Sign out
            </button>
          </form>
        </div>
      </dialog>
    </div>
  )
}
