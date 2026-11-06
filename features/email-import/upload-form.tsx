'use client'

import { useId, useState } from 'react'
import { ActionForm, SubmitButton } from '@/components/ui/action-form'
import { TextField } from '@/components/ui/text-field'
import { Field } from '@/components/ui/workspace'
import { uploadEmailFile } from './actions'
import { acceptedFiles, fileHint, fileLimits, formatBytes } from './limits'

export function UploadEmailForm({ initialKey }: { initialKey: string }) {
  const [requestKey, setRequestKey] = useState(initialKey)
  const [chosen, setChosen] = useState<{ name: string; size: number } | null>(
    null
  )
  const [title, setTitle] = useState('')
  const hintId = useId()
  const hint = chosen ? fileHint(chosen) : null
  return (
    <ActionForm
      preserveValues
      action={uploadEmailFile}
      className="mt-7 space-y-6"
    >
      {/* One key per chosen file: retrying the same file resumes it; a new file starts fresh. */}
      <input type="hidden" name="requestKey" value={requestKey} />
      <Field label="Email file">
        <input
          type="file"
          name="file"
          required
          accept={acceptedFiles}
          aria-describedby={hintId}
          aria-invalid={hint ? true : undefined}
          onChange={(event) => {
            const file = event.target.files?.[0]
            setChosen(file ? { name: file.name, size: file.size } : null)
            setRequestKey(crypto.randomUUID())
          }}
          className="block w-full cursor-pointer rounded-[var(--radius-control)] border border-[var(--line-strong)] bg-[var(--surface-raised)] p-3 text-sm file:mr-3 file:rounded-[var(--radius-control)] file:border-0 file:bg-[var(--surface-hover)] file:px-3 file:py-1.5 file:text-sm file:font-medium hover:border-[var(--text-muted)] focus-visible:border-[var(--focus)] focus-visible:ring-1 focus-visible:ring-[var(--focus)] focus-visible:outline-none"
        />
      </Field>
      <div
        id={hintId}
        className="-mt-4 space-y-1 text-xs leading-5"
        aria-live="polite"
      >
        {hint ? (
          <p className="text-[var(--danger-ink)]">{hint}</p>
        ) : chosen ? (
          <p className="text-[var(--text-muted)]">
            {chosen.name} · {formatBytes(chosen.size)}
          </p>
        ) : (
          <p className="text-[var(--text-muted)]">
            An email saved as .html, .htm, .txt or .eml, up to 4 MB. Scripts,
            images and links in it are never loaded.
          </p>
        )}
      </div>
      <details className="rounded-xl border border-[var(--line)] p-4">
        <summary className="cursor-pointer text-sm">Name it · optional</summary>
        <div className="mt-4">
          <Field label="Name">
            <TextField
              name="title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={fileLimits.title}
              placeholder="Uses the email’s subject if left blank"
            />
          </Field>
        </div>
      </details>
      <p className="text-xs leading-5 text-[var(--text-muted)]">
        The exact file is kept privately in this workspace as something you
        added, not as a tracked competitor. Next, choose to rewrite it for your
        brand or copy it.
      </p>
      <SubmitButton pendingLabel="Uploading and reading…" disabled={!!hint}>
        Upload and continue
      </SubmitButton>
    </ActionForm>
  )
}
