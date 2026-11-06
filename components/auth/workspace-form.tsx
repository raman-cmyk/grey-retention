'use client'

import { useActionState, useState, useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'
import { TextField } from '@/components/ui/text-field'
import { initialWorkspaceActionState } from '@/features/auth/domain/types'
import { createWorkspace } from '@/features/auth/presentation/actions'

export function workspaceSlug(name: string) {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

const subscribeTimezone = () => () => {}
const deviceTimezone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
const serverTimezone = () => 'UTC'

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
    <form action={action} className="mt-8 space-y-6" aria-busy={pending}>
      <label className="block">
        <span className="mb-2 block text-sm font-medium">
          What is your brand called?
        </span>
        <TextField
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="organization"
          placeholder="Your brand name"
          minLength={2}
          maxLength={120}
          required
          aria-invalid={!!errors?.name}
        />
        {errors?.name && (
          <span className="mt-2 block text-sm text-[var(--danger-ink)]">
            {errors.name[0]}
          </span>
        )}
      </label>
      <details
        open={
          errors?.slug || errors?.timezone || state.message ? true : undefined
        }
        className="rounded-xl border border-[var(--line)] p-4"
      >
        <summary className="cursor-pointer text-sm text-[var(--text-muted)]">
          Workspace details{' '}
          <span className="text-[var(--text-faint)]">· optional</span>
        </summary>
        <div className="mt-5 space-y-4">
          <p className="text-xs leading-5 text-[var(--text-muted)]">
            We suggest a workspace address and use your device’s timezone. You
            can change them here.
          </p>
          <label className="block">
            <span className="mb-2 block text-sm font-medium">
              Workspace URL
            </span>
            <TextField
              name="slug"
              value={slug}
              onChange={(e) => setCustomSlug(e.target.value)}
              inputMode="url"
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              placeholder="your-brand"
              aria-invalid={!!errors?.slug}
            />
            {errors?.slug && (
              <span className="mt-2 block text-sm text-[var(--danger-ink)]">
                {errors.slug[0]}
              </span>
            )}
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium">Timezone</span>
            <TextField
              name="timezone"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              autoComplete="off"
              aria-invalid={!!errors?.timezone}
            />
            {errors?.timezone && (
              <span className="mt-2 block text-sm text-[var(--danger-ink)]">
                {errors.timezone[0]}
              </span>
            )}
          </label>
        </div>
      </details>
      {state.message && (
        <p role="alert" className="text-sm text-[var(--danger-ink)]">
          {state.message}
        </p>
      )}
      <Button className="w-full" type="submit" disabled={pending}>
        {pending ? 'Creating workspace…' : 'Continue'}
      </Button>
      <p className="text-center text-xs leading-5 text-[var(--text-faint)]">
        Next, add your store and explore your first email.
      </p>
    </form>
  )
}
