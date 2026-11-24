'use client'

import { useId, useState } from 'react'
import { Field } from '@/components/gros/input'
import { localTimeCandidates } from '@/lib/local-time'

/**
 * The fields of a draft's copy and notes (UI-OLDc), on the GROS tokens.
 * BRAND.md has no multi-line field yet: the body and a note are plain
 * text boxes on the GROS tokens, like Support's, until design gives them
 * a look. The server action checks every field again.
 */
const box =
  'type-body w-full rounded-[var(--radius-md)] border-2 border-transparent bg-[var(--mist)] px-[var(--space-4)] py-[var(--space-3)] text-[var(--ink)] focus:border-[var(--forest)] focus:bg-[var(--white)] focus:outline-none'

function TextBox({
  name,
  label,
  defaultValue,
  rows,
  maxLength,
  required = true
}: {
  name: string
  label: string
  defaultValue?: string
  rows: number
  maxLength: number
  required?: boolean
}) {
  const id = useId()
  return (
    <div className="flex flex-col gap-[var(--space-2)]">
      <label htmlFor={id} className="gros-field-label text-[var(--ink)]">
        {label}
      </label>
      <textarea
        id={id}
        name={name}
        rows={rows}
        required={required}
        maxLength={maxLength}
        defaultValue={defaultValue}
        className={box}
      />
    </div>
  )
}

export function CopyFields({
  copy
}: {
  copy: {
    subject: string
    preheader: string
    body: string
    cta: string
    url: string
    options: string[]
  }
}) {
  const list = useId()
  return (
    <>
      <Field
        label="Subject"
        name="subject"
        defaultValue={copy.subject}
        required
        maxLength={200}
        list={copy.options.length ? list : undefined}
        autoComplete="off"
      />
      {copy.options.length ? (
        <datalist id={list}>
          {copy.options.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      ) : null}
      <Field
        label="Preview text"
        name="preheader"
        defaultValue={copy.preheader}
        maxLength={300}
        autoComplete="off"
      />
      <TextBox
        name="body"
        label="Words"
        defaultValue={copy.body}
        rows={8}
        maxLength={20000}
      />
      <Field
        label="Button"
        name="cta"
        defaultValue={copy.cta}
        required
        maxLength={200}
        autoComplete="off"
      />
      <Field
        label="Button link"
        name="url"
        type="url"
        defaultValue={copy.url}
        required
        autoComplete="off"
      />
    </>
  )
}

export function NoteField() {
  return <TextBox name="body" label="Add a note" rows={3} maxLength={5000} />
}

const select = `${box} min-h-[var(--control-sm)] py-0`

/**
 * The draft's details (the old campaign editor's fields): name, goal,
 * format, send time in the store's timezone and audience. The product,
 * offer and notes are kept as saved (sent back unchanged), so a save never
 * clears them. The send time is sent as the instant it names there (the
 * first one when the clocks change), as `saveCampaign` reads it.
 */
export function DetailFields({
  draft,
  audiences
}: {
  draft: {
    title: string
    goal: string
    channel: string
    local: string
    timezone: string
    audienceId: string
    productId: string
    offerId: string
    notes: string
  }
  audiences: { id: string; label: string }[]
}) {
  const id = useId()
  const [local, setLocal] = useState(draft.local)
  const at = localTimeCandidates(local, draft.timezone)[0] ?? ''
  return (
    <>
      <input type="hidden" name="planned_at" value={at} />
      <input type="hidden" name="product_id" value={draft.productId} />
      <input type="hidden" name="offer_id" value={draft.offerId} />
      <input type="hidden" name="reference_notes" value={draft.notes} />
      <Field
        label="Name"
        name="title"
        defaultValue={draft.title}
        required
        minLength={2}
        maxLength={200}
        autoComplete="off"
      />
      <TextBox
        name="goal"
        label="What should this email do?"
        defaultValue={draft.goal}
        rows={3}
        maxLength={5000}
        required={false}
      />
      <Field
        label={`Send time (${draft.timezone})`}
        type="datetime-local"
        value={local}
        onChange={(event) => setLocal(event.target.value)}
        required
        error={
          local && !at
            ? 'This time does not exist here. Choose another time.'
            : null
        }
      />
      <div className="flex flex-col gap-[var(--space-2)]">
        <label htmlFor={`${id}-audience`} className="gros-field-label">
          Audience
        </label>
        <select
          id={`${id}-audience`}
          name="audience_id"
          defaultValue={draft.audienceId}
          className={select}
        >
          <option value="">Choose later</option>
          {audiences.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-[var(--space-2)]">
        <label htmlFor={`${id}-channel`} className="gros-field-label">
          Format
        </label>
        <select
          id={`${id}-channel`}
          name="channel"
          defaultValue={draft.channel}
          className={select}
        >
          <option value="email_design">Designed email</option>
          <option value="email_text">Text email</option>
        </select>
      </div>
    </>
  )
}
