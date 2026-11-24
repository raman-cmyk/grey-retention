'use client'

import { useActionState, useState, useSyncExternalStore } from 'react'
import { Button } from '@/components/gros/button'
import { Field } from '@/components/gros/input'
import { initialWorkspaceActionState } from '@/features/auth/domain/types'
import { createWorkspace } from '@/features/auth/presentation/actions'

export function workspaceSlug(name: string) {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

const subscribeTimezone = () => () => {}
const deviceTimezone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
const serverTimezone = () => 'UTC'

/**
 * Create a workspace (UI-AUTH): the brand's name, and behind Workspace
 * details (a mist tile, open when one of its fields is refused) the
 * suggested address and the device's timezone, both changeable. One
 * Create workspace button; the server's answer under it.
 */
export function WorkspaceForm() {
  const [state, action, pending] = useActionState(
    createWorkspace,
    initialWorkspaceActionState
  )
  const [name, setName] = useState('')
  const [customSlug, setCustomSlug] = useState<string | null>(null)
  const detectedTimezone = useSyncExternalStore(
    subscribeTimezone,
    deviceTimezone,
    serverTimezone
  )
  const [customTimezone, setTimezone] = useState<string | null>(null)
  const timezone = customTimezone ?? detectedTimezone
  const slug = customSlug ?? workspaceSlug(name)
  const errors = state.fieldErrors
  return (
    <form
      action={action}
      aria-busy={pending}
      className="flex w-full flex-col items-start gap-[var(--space-5)]"
    >
      <div className="flex w-full flex-col gap-[var(--space-4)]">
        <Field
          label="What is your brand called?"
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="organization"
          minLength={2}
          maxLength={120}
          required
          error={errors?.name?.[0]}
        />
        <details
          open={
            errors?.slug || errors?.timezone || state.message ? true : undefined
          }
          className="gros-tile rounded-[var(--radius-md)] bg-[var(--mist)]"
        >
          <summary className="type-body-strong cursor-pointer">
            Workspace details
          </summary>
          <div className="mt-[var(--space-4)] flex flex-col gap-[var(--space-4)]">
            <Field
              onPage
              label="Workspace URL"
              name="slug"
              value={slug}
              onChange={(e) => setCustomSlug(e.target.value)}
              inputMode="url"
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              error={errors?.slug?.[0]}
            />
            <Field
              onPage
              label="Timezone"
              name="timezone"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              autoComplete="off"
              error={errors?.timezone?.[0]}
            />
          </div>
        </details>
      </div>
      <Button
        type="submit"
        label="Create workspace"
        size="focus"
        disabled={pending}
      />
      {state.message ? (
        <p role="alert" className="type-caption text-[var(--signal-ink)]">
          {state.message}
        </p>
      ) : null}
    </form>
  )
}
