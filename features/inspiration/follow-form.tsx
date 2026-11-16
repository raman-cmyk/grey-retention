'use client'

import { useActionState, useEffect, useRef } from 'react'
import { useFormStatus } from 'react-dom'
import { useHydrated } from '@/components/ui/use-hydrated'
import type { ActionResult } from '@/components/gros/action'
import { buttonClasses } from '@/components/gros/button'
import { Field } from '@/components/gros/input'
import { trackDomain } from '@/features/library/inspirations/actions'

/**
 * Follow a brand by its website (the old "+ Track"). The action decides
 * which brands this workspace may follow and says why it refuses one; a
 * success says what happens next.
 */
export function FollowForm() {
  const [state, dispatch] = useActionState<ActionResult, FormData>(
    trackDomain,
    {}
  )
  const form = useRef<HTMLFormElement>(null)
  // A followed brand empties the field; a refused one stays to correct.
  useEffect(() => {
    if (!state.message || state.error) return
    const field = form.current?.elements.namedItem('domain')
    if (field instanceof HTMLInputElement) field.value = ''
  }, [state])
  return (
    <form
      ref={form}
      action={dispatch}
      // React empties the field after every action: the effect above
      // decides instead.
      onReset={(event) => event.preventDefault()}
      className="flex flex-col gap-[var(--space-3)]"
    >
      <div className="flex flex-wrap items-end gap-[var(--space-3)]">
        <Field
          label="Brand website"
          name="domain"
          placeholder="northwind.example"
          autoComplete="off"
          error={state.error ?? null}
          className="min-w-0 flex-1"
        />
        <Submit />
      </div>
      {/* Always in the page, so screen readers hear each answer. */}
      <p
        aria-live="polite"
        className="type-caption text-[var(--ink-soft)] empty:hidden"
      >
        {state.message ?? ''}
      </p>
      <p aria-live="assertive" className="sr-only">
        {state.error ?? ''}
      </p>
    </form>
  )
}

function Submit() {
  // Keeps its word while working, and waits for the page's JavaScript.
  const { pending } = useFormStatus()
  const hydrated = useHydrated()
  return (
    <button
      type="submit"
      disabled={pending || !hydrated}
      className={buttonClasses('main', 'app')}
    >
      Follow
    </button>
  )
}
