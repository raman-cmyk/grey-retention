'use client'

import { useActionState, useId, useRef, type InputHTMLAttributes } from 'react'
import { useFormStatus } from 'react-dom'
import { buttonClasses, type ButtonKind } from '@/components/gros/button'
import { Field } from '@/components/gros/input'
import { useHydrated } from '@/components/ui/use-hydrated'
import type { SetupAnswer } from './setup-actions'

type SetupAction = (state: SetupAnswer, form: FormData) => Promise<SetupAnswer>

/** A field of a setup form: its name, label and input attributes. */
export type SetupField = { name: string; label: string } & Pick<
  InputHTMLAttributes<HTMLInputElement>,
  | 'defaultValue'
  | 'type'
  | 'inputMode'
  | 'autoComplete'
  | 'maxLength'
  | 'required'
  | 'spellCheck'
>

/** A key field: a password box the browser and password managers leave alone. */
const secret = { 'data-1p-ignore': true, 'data-lpignore': 'true' } as const

/**
 * A setup step's form (UI-ONBb): GROS fields, each with its own error
 * under it (linked to the field), and one button that keeps its words
 * while it works. A refused answer keeps what was typed, except a key
 * (`keepOnError` false), which never stays on the page.
 */
export function SetupForm({
  action,
  fields,
  hidden = {},
  label,
  kind = 'main',
  keepOnError = true
}: {
  action: SetupAction
  fields: SetupField[]
  /** Values the action reads that the person does not type (a revision). */
  hidden?: Record<string, string>
  /** The button's words. */
  label: string
  kind?: Exclude<ButtonKind, 'round'>
  keepOnError?: boolean
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
  const answerId = useId()
  const shown: SetupAnswer = pending ? {} : state
  return (
    <form
      action={dispatch}
      aria-busy={pending}
      onReset={(event) => {
        if (keepOnError && refused.current) event.preventDefault()
      }}
      className="flex w-full flex-col items-start gap-[var(--space-5)]"
    >
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <div className="flex w-full flex-col gap-[var(--space-4)]">
        {fields.map(({ name, label: text, ...input }) => (
          <Field
            key={name}
            label={text}
            name={name}
            {...input}
            {...(input.type === 'password' ? secret : {})}
            error={shown.fields?.[name]}
          />
        ))}
      </div>
      <Submit
        label={label}
        kind={kind}
        describedBy={shown.error || shown.message ? answerId : undefined}
      />
      <p
        id={answerId}
        aria-live="polite"
        className={
          shown.error
            ? 'type-caption text-[var(--signal-ink)] empty:hidden'
            : 'type-caption text-[var(--ink)] empty:hidden'
        }
      >
        {shown.error ?? shown.message ?? ''}
      </p>
    </form>
  )
}

function Submit({
  label,
  kind,
  describedBy
}: {
  label: string
  kind: Exclude<ButtonKind, 'round'>
  describedBy?: string
}) {
  const { pending } = useFormStatus()
  const hydrated = useHydrated()
  return (
    <button
      type="submit"
      disabled={pending || !hydrated}
      aria-describedby={describedBy}
      className={buttonClasses(kind, 'focus')}
    >
      {label}
    </button>
  )
}
