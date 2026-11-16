'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
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
  return (
    <form
      action={dispatch}
      // React empties the field after the action: keep what the owner typed
      // (a refused website stays there to correct).
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
      {state.message ? (
        <p aria-live="polite" className="type-caption text-[var(--ink-soft)]">
          {state.message}
        </p>
      ) : null}
    </form>
  )
}

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className={buttonClasses('main', 'focus')}
    >
      {pending ? 'Following…' : 'Follow'}
    </button>
  )
}
