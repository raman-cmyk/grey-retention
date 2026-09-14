'use client'

import { useId, useState } from 'react'
import { Menu, X } from 'lucide-react'
import { BrandMark } from '@/components/brand/brand-mark'
import type { BrandPresentation } from '@/lib/branding/presentation'
import type { NavigationItem } from './nav-data'
import { NavigationList } from './navigation-list'

export function MobileNavigation({
  navigation,
  contextLabel,
  brand
}: {
  navigation: NavigationItem[]
  contextLabel: string
  brand: BrandPresentation
}) {
  const [open, setOpen] = useState(false)
  const menuId = useId()

  return (
    <div className="relative lg:hidden">
      <button
        type="button"
        aria-controls={menuId}
        aria-expanded={open}
        aria-label={open ? 'Close navigation' : 'Open navigation'}
        className="grid size-10 place-items-center rounded-[var(--radius-control)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-none"
        onClick={() => setOpen((current) => !current)}
      >
        {open ? (
          <X className="size-5" aria-hidden />
        ) : (
          <Menu className="size-5" aria-hidden />
        )}
      </button>
      {open && (
        <div
          id={menuId}
          className="absolute top-12 left-0 w-[min(18rem,calc(100vw-2rem))] overflow-hidden rounded-[var(--radius-panel)] border border-[var(--line)] bg-[var(--nav)] text-[var(--nav-text)] shadow-[0_18px_45px_-28px_rgba(29,29,31,.35)]"
        >
          <div className="border-b border-[var(--line)] px-4 py-4">
            <BrandMark brand={brand} />
          </div>
          <NavigationList
            navigation={navigation}
            label={`${contextLabel} mobile navigation`}
            variant="popover"
            onNavigate={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  )
}
