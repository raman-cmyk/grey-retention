'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { Route } from 'next'
import { ActionForm, SubmitButton } from '@/components/ui/action-form'
import { TextField } from '@/components/ui/text-field'
import { Field, controlClass } from '@/components/ui/workspace'
import { localTimeCandidates } from '@/lib/local-time'
import { PastedText } from '@/features/references/pasted-text'
import { createFirstDraft } from './actions'

export type DraftReference = {
  id: string
  subject: string
  safe_html: string
  received_at: string
}
export type ImportedDraftReference = {
  id: string
  subject: string
  readable_text: string
  source_description: string
  source_url: string | null
  structure: string[]
  created_at: string
}
export const importedSource = (id: string) => `imported:${id}`
export function FirstDraftForm({
  references,
  imported = [],
  audiences,
  timezone,
  defaultDate,
  requestKey,
  selectedReference,
  selectedImport,
  brandName
}: {
  references: DraftReference[]
  imported?: ImportedDraftReference[]
  audiences: { id: string; label: string }[]
  timezone: string
  defaultDate: string
  requestKey: string
  selectedReference?: string
  selectedImport?: string
  brandName: string
}) {
  const initial = references.find((item) => item.id === selectedReference)
  const initialImport = imported.find((item) => item.id === selectedImport)
  const [source, setSource] = useState(
    initialImport
      ? importedSource(initialImport.id)
      : (initial?.id ?? 'original')
  )
  const [title, setTitle] = useState(`${brandName} · new email`.slice(0, 200))
  const [goal, setGoal] = useState('')
  const [date, setDate] = useState(defaultDate)
  const [occurrence, setOccurrence] = useState('')
  const [audience, setAudience] = useState('')
  const [channel, setChannel] = useState('email_design')
  const reference = references.find((item) => item.id === source)
  const pasted = imported.find((item) => importedSource(item.id) === source)
  const dateLabel = (value: string) =>
    new Intl.DateTimeFormat('en', {
      dateStyle: 'medium',
      timeZone: timezone
    }).format(new Date(value))
  const candidates = localTimeCandidates(date, timezone)
  const occurrenceLabel = (value: string) =>
    new Intl.DateTimeFormat('en', {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'shortOffset'
    }).format(new Date(value))
  return (
    <ActionForm
      preserveValues
      action={createFirstDraft}
      className="mt-7 space-y-6"
    >
      <input type="hidden" name="requestKey" value={requestKey} />
      <Field label="Start with">
        <select
          name="source"
          className={controlClass}
          value={source}
          onChange={(event) => setSource(event.target.value)}
        >
          <option value="original">A new idea from scratch</option>
          {imported.length > 0 && (
            <optgroup label="Emails you added">
              {imported.map((item) => (
                <option key={item.id} value={importedSource(item.id)}>
                  {item.subject} · added by you
                </option>
              ))}
            </optgroup>
          )}
          {references.length > 0 && (
            <optgroup label="Sample references">
              {references.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.subject} · sample reference
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </Field>
      <Link
        href="/import-reference"
        className="-mt-3 block text-xs text-[var(--text-muted)] underline underline-offset-4"
      >
        Have an email to start from? Paste it
      </Link>
      {pasted && (
        <div className="rounded-xl border border-[var(--line)] p-4">
          <p className="text-sm font-semibold break-words">{pasted.subject}</p>
          <p className="mt-1 text-xs leading-5 break-words text-[var(--text-muted)]">
            Added by you · {dateLabel(pasted.created_at)}
            {pasted.source_description && ` · ${pasted.source_description}`}.
            Your draft follows its outline ({pasted.structure.join(' · ')}). Its
            wording, images, links and offers are not copied, and it has not
            been analyzed by AI.
          </p>
          {pasted.source_url && (
            <p className="mt-1 text-xs break-all text-[var(--text-muted)]">
              Source noted: {pasted.source_url}
            </p>
          )}
          <details className="mt-3">
            <summary className="cursor-pointer text-sm">
              See the email you added
            </summary>
            <div className="mt-3">
              <PastedText text={pasted.readable_text} />
            </div>
          </details>
        </div>
      )}
      {reference && (
        <div className="rounded-xl border border-[var(--line)] p-4">
          <p className="text-sm font-semibold">{reference.subject}</p>
          <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
            Sample source · {dateLabel(reference.received_at)}. We reuse its
            section structure; its wording, images and offers are not copied
            into your draft.
          </p>
          <details className="mt-3">
            <summary className="cursor-pointer text-sm">
              See the original email
            </summary>
            <iframe
              title="Selected reference preview"
              sandbox=""
              referrerPolicy="no-referrer"
              srcDoc={reference.safe_html}
              className="mt-3 h-64 w-full rounded-lg border border-[var(--line)]"
            />
          </details>
          <Link
            href={`/email-library/${reference.id}` as Route}
            target="_blank"
            rel="noreferrer"
            className="mt-3 block text-xs underline"
          >
            Open source details
          </Link>
        </div>
      )}
      <Field label="What should this email do?">
        <textarea
          className={controlClass}
          name="goal"
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          rows={3}
          minLength={5}
          maxLength={5000}
          required
          placeholder="Introduce our best-selling product to new subscribers…"
        />
      </Field>
      <details
        open={candidates.length !== 1 ? true : undefined}
        className="rounded-xl border border-[var(--line)] p-4"
      >
        <summary className="cursor-pointer text-sm">
          Plan details · optional
        </summary>
        <div className="mt-4 space-y-4">
          <Field label="Give it a name">
            <TextField
              name="title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              minLength={2}
              maxLength={200}
              required
            />
          </Field>
          <Field label={`Planned date and time · ${timezone}`}>
            <TextField
              type="datetime-local"
              name="plannedLocal"
              value={date}
              onChange={(event) => {
                setDate(event.target.value)
                setOccurrence('')
              }}
              required
              aria-describedby="draft-date-help"
            />
          </Field>
          <p
            id="draft-date-help"
            className="text-xs leading-5 text-[var(--text-muted)]"
          >
            This reserves a place in your calendar. Creating a draft does not
            schedule or send an email.
          </p>
          {date && !candidates.length && (
            <p role="alert" className="text-sm text-[var(--danger-ink)]">
              This local time does not exist. Choose another time.
            </p>
          )}
          {candidates.length > 1 ? (
            <Field label="This time occurs twice when clocks change">
              <select
                name="occurrence"
                className={controlClass}
                value={occurrence}
                onChange={(event) => setOccurrence(event.target.value)}
                required
              >
                <option value="">Choose which occurrence</option>
                <option value="earlier">
                  First occurrence · {occurrenceLabel(candidates[0])}
                </option>
                <option value="later">
                  Second occurrence ·{' '}
                  {occurrenceLabel(candidates[candidates.length - 1])}
                </option>
              </select>
            </Field>
          ) : (
            <input type="hidden" name="occurrence" value="" />
          )}
          <Field label="Audience">
            <select
              name="audience"
              className={controlClass}
              value={audience}
              onChange={(event) => setAudience(event.target.value)}
            >
              <option value="">Choose later</option>
              {audiences.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Email format">
            <select
              name="channel"
              className={controlClass}
              value={channel}
              onChange={(event) => setChannel(event.target.value)}
            >
              <option value="email_design">Design email</option>
              <option value="email_text">Text email</option>
            </select>
          </Field>
        </div>
      </details>
      <p className="text-xs leading-5 text-[var(--text-muted)]">
        You’ll get a saved brief and starting structure. Next, review the plan
        and create copy and design in the workspace. Sample generation and
        delivery remain in use.
      </p>
      <SubmitButton>Create my draft</SubmitButton>
    </ActionForm>
  )
}
