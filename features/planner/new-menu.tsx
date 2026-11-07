'use client'

import { ChevronDown, Plus } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'

export type NewMenuItem = { label: string; hint: string; href: Route }

const itemClass =
  'block rounded-[var(--radius-small)] px-3 py-2.5 hover:bg-[var(--surface-hover)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-hidden'

function ItemText({ item }: { item: NewMenuItem }) {
  return (
    <>
      <span className="block text-sm font-medium">{item.label}</span>
      <span className="block text-xs text-[var(--text-muted)]">
        {item.hint}
      </span>
    </>
  )
}

/**
 * The one "+ New" menu (docs/OWNER_JOURNEYS.md §18.10) that replaces the
 * old app's row of similar toolbar buttons. Opens with Enter/Space/click,
 * closes on Escape (focus returns), an outside click, or leaving the menu.
 */
export function NewMenu({ items }: { items: NewMenuItem[] }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const box = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const close = useCallback((focus: boolean) => {
    setOpen(false)
    if (focus) trigger.current?.focus()
  }, [])
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close(true)
    }
    const onPointer = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) close(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [open, close])
  return (
    <div
      ref={box}
      className="relative"
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null
        if (open && next && !box.current?.contains(next)) close(false)
      }}
    >
      <Button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <Plus className="size-4" aria-hidden />
        New
        <ChevronDown className="size-4" aria-hidden />
      </Button>
      {open && (
        <ul
          id={`${id}-menu`}
          aria-label="Create"
          className="absolute right-0 z-30 mt-2 w-72 rounded-[var(--radius-control)] border border-[var(--line-strong)] bg-[var(--surface-raised)] p-1.5 shadow-[0_8px_24px_-12px_rgb(17_17_17/0.25)]"
        >
          {items.map((item) => (
            <li key={item.label}>
              {item.href.startsWith('#') ? (
                // A section on this page: a plain jump, no navigation.
                <a
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={itemClass}
                >
                  <ItemText item={item} />
                </a>
              ) : (
                <Link
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={itemClass}
                >
                  <ItemText item={item} />
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
