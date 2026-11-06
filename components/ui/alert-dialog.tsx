'use client'

import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Button } from './button'

/**
 * The "are you sure?" dialog (docs/UI_REBUILD_SPEC.md §2 "Confirm dialog"):
 * a large "!" circle, a bold title, body text, and a secondary button next to
 * the danger (or primary) action. Focus starts on the safe choice; Escape
 * and the backdrop cancel. Use it for yes/no questions; `ConfirmDialog` is
 * the older wrapper for a form that needs a confirming step.
 *
 * The native dialog follows `open` on every render, and a close the browser
 * forces (for example a repeated Escape) is reported as a cancel, or undone
 * while the action is still running, so `open` and the screen never disagree.
 */
export function AlertDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'danger',
  pending = false,
  onConfirm,
  onCancel
}: {
  open: boolean
  title: string
  children: ReactNode
  confirmLabel: string
  cancelLabel?: string
  tone?: 'danger' | 'primary'
  /** While true the action is running: both buttons are disabled. */
  pending?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const id = useId()
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      cancel.current?.focus()
    } else if (!open && dialog.open) dialog.close()
  })
  return (
    <dialog
      ref={ref}
      role="alertdialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-body`}
      onCancel={(event) => {
        if (event.target !== event.currentTarget) return
        event.stopPropagation()
        // A cancel the browser won't let us stop ends in `close` below.
        if (!event.cancelable) return
        event.preventDefault()
        if (!pending) onCancel()
      }}
      onClose={(event) => {
        if (event.target !== event.currentTarget) return
        event.stopPropagation()
        if (!open) return
        if (pending) event.currentTarget.showModal()
        else onCancel()
      }}
      onClick={(event) => {
        event.stopPropagation()
        if (event.target === event.currentTarget && !pending) onCancel()
      }}
      className="m-auto w-[min(28rem,calc(100%_-_2rem))] rounded-[var(--radius-panel)] border border-[var(--line)] bg-[var(--surface-raised)] p-0 text-[var(--text)] backdrop:bg-black/40"
    >
      <div className="p-6 text-center">
        <span
          aria-hidden
          className={
            tone === 'danger'
              ? 'mx-auto grid size-12 place-items-center rounded-full bg-[var(--danger-soft)] text-2xl font-semibold text-[var(--danger-ink)]'
              : 'mx-auto grid size-12 place-items-center rounded-full bg-[var(--warning-soft)] text-2xl font-semibold text-[var(--warning-ink)]'
          }
        >
          !
        </span>
        <h2 id={`${id}-title`} className="mt-4 text-lg font-semibold">
          {title}
        </h2>
        <div
          id={`${id}-body`}
          className="mt-2 text-sm leading-6 text-[var(--text-muted)]"
        >
          {children}
        </div>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-center">
          <Button
            ref={cancel}
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={onCancel}
            className="self-stretch sm:self-auto"
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={tone}
            disabled={pending}
            onClick={onConfirm}
            className="self-stretch sm:self-auto"
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  )
}
