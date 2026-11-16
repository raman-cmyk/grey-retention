'use client'

import { useActionState, useId, useRef } from 'react'
import { useFormStatus } from 'react-dom'
import { buttonClasses } from '@/components/gros/button'
import { Field } from '@/components/gros/input'
import { useHydrated } from '@/components/ui/use-hydrated'
import type { SetupAnswer } from './setup-actions'

type SetupAction = (state: SetupAnswer, form: FormData) => Promise<SetupAnswer>

/**
 * The Store step's form (UI-ONBb): the store's name and website, each
 * with its own error under it (linked to the field), and one main button
 * that keeps its words while it saves. A refused save keeps what was typed.
 */
export function StoreForm({
  action,
  name,
  website
}: {
  action: SetupAction
  name: string
  website: string
}) {
  const refused = useRef(false)
  const [state, dispatch, pending] = useActionState(
    async (previous: SetupAnswer, form: FormData) => {
      const answer = await action(previous, form)
      refused.current = !!(answer.error || answer.fields)
      return answer
    },
    {}
  )
  const errorId = useId()
  const shown = pending ? {} : state
  return (
    <form
      action={dispatch}
      aria-busy={pending}
      onReset={(event) => {
        if (refused.current) event.preventDefault()
      }}
      className="flex flex-col items-start gap-[var(--space-5)]"
    >
      <div className="flex w-full flex-col gap-[var(--space-4)]">
        <Field
          label="Store name"
          name="name"
          defaultValue={name}
          autoComplete="organization"
          maxLength={120}
          required
          error={shown.fields?.name}
        />
        <Field
          label="Website"
          name="website"
          defaultValue={website}
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          maxLength={300}
          required
          error={shown.fields?.website}
        />
      </div>
      <Submit
        label="Save store"
        describedBy={shown.error ? errorId : undefined}
      />
      <p
        id={errorId}
        aria-live="polite"
        className="type-caption text-[var(--signal-ink)] empty:hidden"
      >
        {shown.error ?? ''}
      </p>
    </form>
  )
}

function Submit({
  label,
  describedBy
}: {
  label: string
  describedBy?: string
}) {
  const { pending } = useFormStatus()
  const hydrated = useHydrated()
  return (
    <button
      type="submit"
      disabled={pending || !hydrated}
      aria-describedby={describedBy}
      className={buttonClasses('main', 'focus')}
    >
      {label}
    </button>
  )
}
