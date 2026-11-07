'use client'
import { useRef, type ReactNode } from 'react'
import { Button } from './button'
import { useHydrated } from './use-hydrated'
export function ConfirmDialog({
  label,
  title,
  description,
  children,
  danger = false
}: {
  label: string
  title: string
  description: string
  children: ReactNode
  danger?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  // A click before the page is interactive would do nothing.
  const hydrated = useHydrated()
  return (
    <>
      <Button
        type="button"
        variant={danger ? 'danger' : 'primary'}
        disabled={!hydrated}
        onClick={() => ref.current?.showModal()}
      >
        {label}
      </Button>
      <dialog
        ref={ref}
        aria-label={title}
        className="m-auto max-h-[90dvh] w-[min(38rem,calc(100%_-_2rem))] overflow-auto rounded-2xl border border-[var(--line)] bg-[var(--surface-raised)] p-6 text-[var(--text)] backdrop:bg-black/30"
      >
        <h2 className="tracking-display font-serif text-2xl font-normal">
          {title}
        </h2>
        <p className="my-4 text-sm leading-6 text-[var(--text-muted)]">
          {description}
        </p>
        {children}
        <Button
          type="button"
          variant="secondary"
          className="mt-4"
          onClick={() => ref.current?.close()}
        >
          Close
        </Button>
      </dialog>
    </>
  )
}
