'use client'

import { X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { AlertDialog } from './alert-dialog'
import { Button } from './button'

export type ModalStep = { current: number; total: number }

/**
 * The shared modal (docs/UI_REBUILD_SPEC.md §2 "Modal"): optional
 * `STEP 1 OF 2` label with a segmented progress bar, title, subtitle and ✕,
 * a scrolling body, and a sticky footer with Cancel on the left and the main
 * action on the right.
 *
 * Fix from docs/OWNER_JOURNEYS.md §1 (Job 1): when the owner has typed
 * something (`dirty`), Escape, the backdrop, ✕ and Cancel first ask
 * "Discard your answers?" instead of silently throwing them away.
 */
export function Modal({
  open,
  title,
  subtitle,
  step,
  size = 'md',
  dirty = false,
  children,
  footer,
  cancelLabel = 'Cancel',
  onClose
}: {
  open: boolean
  title: string
  subtitle?: string
  step?: ModalStep
  /** ~520px (small) or ~760px (medium), as in the old app. */
  size?: 'sm' | 'md'
  dirty?: boolean
  children: ReactNode
  /** The main action(s), shown at the right of the sticky footer. */
  footer?: ReactNode
  cancelLabel?: string
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const id = useId()
  const [confirming, setConfirming] = useState(false)
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  }, [open])
  const requestClose = () => {
    if (dirty) setConfirming(true)
    else onClose()
  }
  const safeStep =
    step && step.total > 1
      ? {
          total: Math.min(Math.max(Math.trunc(step.total), 2), 10),
          current: Math.min(
            Math.max(Math.trunc(step.current), 1),
            Math.min(Math.max(Math.trunc(step.total), 2), 10)
          )
        }
      : null
  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-title`}
      aria-describedby={subtitle ? `${id}-subtitle` : undefined}
      onCancel={(event) => {
        event.preventDefault()
        if (!confirming) requestClose()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) requestClose()
      }}
      className={cn(
        'm-auto max-h-[min(90dvh,56rem)] w-[calc(100%_-_2rem)] flex-col overflow-hidden rounded-[var(--radius-panel)] border border-[var(--line)] bg-[var(--surface-raised)] p-0 text-[var(--text)] backdrop:bg-black/40 open:flex',
        size === 'sm' ? 'max-w-[32.5rem]' : 'max-w-[47.5rem]'
      )}
    >
      <header className="border-b border-[var(--line)] px-6 pt-5 pb-4">
        {safeStep && (
          <div className="mb-3">
            <p
              id={`${id}-step`}
              className="tracking-label font-mono text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase"
            >
              Step {safeStep.current} of {safeStep.total}
            </p>
            <div
              role="progressbar"
              aria-labelledby={`${id}-step`}
              aria-valuemin={1}
              aria-valuemax={safeStep.total}
              aria-valuenow={safeStep.current}
              className="mt-2 flex gap-1.5"
            >
              {Array.from({ length: safeStep.total }, (_, index) => (
                <span
                  key={index}
                  data-done={index < safeStep.current || undefined}
                  className="h-1 flex-1 rounded-full bg-[var(--line)] data-[done]:bg-[var(--brand-secondary)] forced-colors:data-[done]:bg-[Highlight]"
                />
              ))}
            </div>
          </div>
        )}
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <h2
              id={`${id}-title`}
              className="text-xl leading-tight font-semibold break-words"
            >
              {title}
            </h2>
            {subtitle && (
              <p
                id={`${id}-subtitle`}
                className="mt-1 text-sm leading-6 text-[var(--text-muted)]"
              >
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={requestClose}
            className="-mt-1 -mr-2 grid size-9 shrink-0 place-items-center rounded-[var(--radius-control)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-none"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] bg-[var(--surface-raised)] px-6 py-4">
        <Button type="button" variant="quiet" onClick={requestClose}>
          {cancelLabel}
        </Button>
        {footer && (
          <div className="flex flex-wrap items-center gap-2">{footer}</div>
        )}
      </footer>
      <AlertDialog
        open={confirming}
        title="Discard your answers?"
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false)
          onClose()
        }}
      >
        What you typed in “{title}” will be lost.
      </AlertDialog>
    </dialog>
  )
}
