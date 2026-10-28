'use client'

import { useState } from 'react'
import { ActionForm, SubmitButton } from '@/components/ui/action-form'
import { TextField } from '@/components/ui/text-field'
import { Field, controlClass } from '@/components/ui/workspace'
import { importPastedReference } from './pasted-actions'
import { PastedText } from './pasted-text'
import {
  looksLikeMarkup,
  pastedLimits,
  pastedOutline,
  pastedReadable
} from './pasted'

export function PastedReferenceForm({ requestKey }: { requestKey: string }) {
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [description, setDescription] = useState('')
  const [url, setUrl] = useState('')
  const preview = body.trim()
    ? pastedReadable(body)
    : { text: '', limited: false }
  const readable = preview.text
  const outline = pastedOutline(readable)
  return (
    <ActionForm
      preserveValues
      action={importPastedReference}
      className="mt-7 space-y-6"
    >
      <input type="hidden" name="requestKey" value={requestKey} />
      <Field label="Subject line">
        <TextField
          name="subject"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          maxLength={pastedLimits.subject}
          required
        />
      </Field>
      <Field label="Email text">
        <textarea
          name="body"
          className={controlClass}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={8}
          maxLength={pastedLimits.body}
          required
          aria-describedby="pasted-body-help"
        />
      </Field>
      <p
        id="pasted-body-help"
        className="-mt-4 text-xs leading-5 text-[var(--text-muted)]"
      >
        Paste the words or the HTML source. Scripts, images, links and tracking
        are never loaded.
      </p>
      {body.trim() && (
        <section aria-label="Plain-text preview" className="space-y-2">
          <p className="text-sm font-semibold">Plain-text preview</p>
          {readable ? (
            <PastedText
              text={readable}
              limited={preview.limited}
              saved={false}
            />
          ) : (
            <p className="text-sm text-[var(--danger-ink)]">
              No readable text found yet.
            </p>
          )}
          {looksLikeMarkup(body) && (
            <p className="text-xs leading-5 text-[var(--text-muted)]">
              Code and formatting were removed for this preview.
            </p>
          )}
          {outline.length > 0 && (
            <p className="text-xs leading-5 text-[var(--text-muted)]">
              Outline your draft can follow: {outline.join(' · ')}
            </p>
          )}
        </section>
      )}
      <details className="rounded-xl border border-[var(--line)] p-4">
        <summary className="cursor-pointer text-sm">
          Where is it from? · optional
        </summary>
        <div className="mt-4 space-y-4">
          <Field label="Short description">
            <TextField
              name="sourceDescription"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={pastedLimits.description}
              placeholder="A newsletter I liked"
            />
          </Field>
          <Field label="Web address">
            <TextField
              name="sourceUrl"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              maxLength={pastedLimits.url}
              inputMode="url"
              autoComplete="off"
              placeholder="https://"
              aria-describedby="pasted-url-help"
            />
          </Field>
          <p
            id="pasted-url-help"
            className="text-xs leading-5 text-[var(--text-muted)]"
          >
            Saved as a note only. We don’t visit this address.
          </p>
        </div>
      </details>
      <p className="text-xs leading-5 text-[var(--text-muted)]">
        Saved privately in this workspace exactly as pasted — not as a tracked
        competitor. Next, choose to rewrite it for your brand or copy it.
      </p>
      <SubmitButton>Save and use this email</SubmitButton>
    </ActionForm>
  )
}
