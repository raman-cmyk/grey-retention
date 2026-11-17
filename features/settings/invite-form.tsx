'use client'

import { useActionState, useEffect, useId, useRef } from 'react'
import { useFormStatus } from 'react-dom'
import { useCardAnswer } from '@/components/gros/action'
import { Button } from '@/components/gros/button'
import { Field } from '@/components/gros/input'
import { useHydrated } from '@/components/ui/use-hydrated'
import { inviteTeammate, type InviteResult } from '@/features/team/actions'
import { ownerOnlyNote, roleHelp } from '@/features/team/rules'

/**
 * Invite a teammate on the Team card (UI-SETb): their email, then Invite as
 * Staff or Invite as Manager (BRAND.md has no select, so the two roles are
 * two buttons; Enter invites as Staff), each described by what the role
 * may do. The action checks again that this person may manage the team.
 * A refusal about the address is the Email field's own error and keeps
 * what was typed; every other answer (a saved invite, no right, signed
 * out) shows in the card's one line, so the card never shows two. A saved
 * invite empties Email for the next one. No email is sent yet.
 */
export function InviteForm() {
  const id = useId()
  const card = useCardAnswer()
  const tell = card?.tell
  const [state, dispatch, pending] = useActionState<InviteResult, FormData>(
    async (previous, data) => {
      const result = await inviteTeammate(previous, data)
      tell?.(result.field === 'email' ? {} : result)
      return result
    },
    {}
  )
  // A new try hides the card's last answer until its own arrives.
  useEffect(() => {
    if (pending) tell?.({})
  }, [pending, tell])
  const form = useRef<HTMLFormElement>(null)
  useEffect(() => {
    const field = form.current?.elements.namedItem('email')
    if (!(field instanceof HTMLInputElement)) return
    if (state.message && !state.error) field.value = ''
    // Back to Email for the next invite, or to fix the address.
    if (state.message || state.field === 'email') field.focus()
  }, [state])
  // A refusal about the address, until another button of the card answers.
  const fieldError =
    !pending && state.field === 'email' && !card?.othersAnswered
      ? (state.error ?? null)
      : null
  const answer = pending || state.field === 'email' ? null : state
  return (
    <form
      ref={form}
      action={dispatch}
      aria-busy={pending}
      // The server says what is wrong in plain words, not the browser.
      noValidate
      // React empties the field after every action: the effect above decides.
      onReset={(event) => event.preventDefault()}
      className="flex flex-col gap-[var(--space-4)]"
    >
      <div className="flex flex-col gap-[var(--space-2)]">
        <Field
          label="Email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="off"
          spellCheck={false}
          maxLength={254}
          required
          aria-describedby={`${id}-sent`}
          error={fieldError}
        />
        <p id={`${id}-sent`} className="type-caption text-[var(--stone)]">
          No email is sent yet. Ask them to sign up with this address.
        </p>
      </div>
      <Buttons id={id} />
      <p className="type-caption text-[var(--stone)]">
        <span id={`${id}-staff`}>{roleHelp.staff}</span>{' '}
        <span id={`${id}-admin`}>{roleHelp.admin}</span>{' '}
        <span id={`${id}-owner`}>{ownerOnlyNote}</span>
      </p>
      {card ? null : (
        // Alone (outside a card's answers), the form answers here.
        <p
          aria-live="polite"
          className={
            answer?.error
              ? 'type-caption text-[var(--signal-ink)]'
              : 'type-caption text-[var(--ink)]'
          }
        >
          {answer?.error ?? answer?.message ?? ''}
        </p>
      )}
    </form>
  )
}

function Buttons({ id }: { id: string }) {
  // Keep their words while working, and wait for the page's JavaScript.
  const { pending } = useFormStatus()
  const hydrated = useHydrated()
  const off = pending || !hydrated
  return (
    <div className="flex flex-wrap gap-[var(--space-3)]">
      <Button
        type="submit"
        name="role"
        value="staff"
        label="Invite as Staff"
        disabled={off}
        aria-describedby={`${id}-staff`}
      />
      <Button
        type="submit"
        name="role"
        value="admin"
        label="Invite as Manager"
        kind="outline"
        disabled={off}
        aria-describedby={`${id}-admin ${id}-owner`}
      />
    </div>
  )
}
