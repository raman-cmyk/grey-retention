'use client'

import { useActionState, useEffect, useRef } from 'react'
import { useFormStatus } from 'react-dom'
import type { ActionResult } from '@/components/gros/action'
import { Button } from '@/components/gros/button'
import { Field } from '@/components/gros/input'
import { useHydrated } from '@/components/ui/use-hydrated'
import { inviteTeammate } from '@/features/team/actions'

/**
 * Invite a teammate on the Team card (UI-SETb): their email, then Invite as
 * Staff or Invite as Manager (BRAND.md has no select, so the two roles are
 * two buttons; Enter invites as Staff). The action checks again that this
 * person may manage the team. A refusal is the email field's own error and
 * keeps what was typed; a saved invite empties the field for the next one
 * and says so in a live region. Either way the cursor goes back to Email.
 */
export function InviteForm() {
  const [state, dispatch, pending] = useActionState<ActionResult, FormData>(
    inviteTeammate,
    {}
  )
  const form = useRef<HTMLFormElement>(null)
  useEffect(() => {
    const field = form.current?.elements.namedItem('email')
    if (!(field instanceof HTMLInputElement)) return
    if (state.message && !state.error) field.value = ''
    if (state.message || state.error) field.focus()
  }, [state])
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
      <Field
        label="Email"
        name="email"
        type="email"
        inputMode="email"
        autoComplete="off"
        spellCheck={false}
        maxLength={254}
        required
        error={pending ? null : (state.error ?? null)}
      />
      <Buttons />
      <p className="type-caption text-[var(--stone)]">
        No email is sent yet. Ask them to sign up with this address.
      </p>
      {/* Always on the page, so screen readers hear a saved invite. */}
      <p aria-live="polite" className="type-caption text-[var(--ink)]">
        {pending ? '' : (state.message ?? '')}
      </p>
    </form>
  )
}

function Buttons() {
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
      />
      <Button
        type="submit"
        name="role"
        value="admin"
        label="Invite as Manager"
        kind="outline"
        disabled={off}
      />
    </div>
  )
}
