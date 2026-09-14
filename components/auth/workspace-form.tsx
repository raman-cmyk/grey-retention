'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { TextField } from '@/components/ui/text-field'
import { initialWorkspaceActionState } from '@/features/auth/domain/types'
import { createWorkspace } from '@/features/auth/presentation/actions'

export function WorkspaceForm() {
  const [state, action, pending] = useActionState(
    createWorkspace,
    initialWorkspaceActionState
  )
  return (
    <form action={action} className="mt-9 space-y-5">
      <label className="block">
        <span className="mb-2 block text-sm font-medium text-white/78">
          Workspace name
        </span>
        <TextField name="name" autoComplete="organization" required />
        {state.fieldErrors?.name && (
          <span className="mt-2 block text-sm text-[#ffb4aa]">
            {state.fieldErrors.name[0]}
          </span>
        )}
      </label>
      <label className="block">
        <span className="mb-2 block text-sm font-medium text-white/78">
          Workspace URL
        </span>
        <TextField
          name="slug"
          inputMode="url"
          pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
          placeholder="your-brand"
          required
        />
        {state.fieldErrors?.slug && (
          <span className="mt-2 block text-sm text-[#ffb4aa]">
            {state.fieldErrors.slug[0]}
          </span>
        )}
      </label>
      <label className="block">
        <span className="mb-2 block text-sm font-medium text-white/78">
          Timezone
        </span>
        <TextField
          name="timezone"
          defaultValue="UTC"
          autoComplete="off"
          required
        />
        {state.fieldErrors?.timezone && (
          <span className="mt-2 block text-sm text-[#ffb4aa]">
            {state.fieldErrors.timezone[0]}
          </span>
        )}
      </label>
      {state.message && (
        <p role="alert" className="text-sm text-[#ffb4aa]">
          {state.message}
        </p>
      )}
      <Button className="w-full" type="submit" disabled={pending}>
        {pending ? 'Creating workspace…' : 'Create workspace'}
      </Button>
    </form>
  )
}
