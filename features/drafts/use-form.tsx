'use client'

import { useId, useState } from 'react'
import { ActionButton } from '@/components/gros/action'
import { Field } from '@/components/gros/input'
import { localTimeCandidates } from '@/lib/local-time'
import { createFirstDraft } from './actions'

/**
 * The fields of "Use this design" (UI-OLDc), on the GROS tokens: what the
 * email should do, its name, when, the audience and the format. It sends
 * the same `createFirstDraft` action the old first-draft page sent, with
 * the chosen email as its `source`; the action checks the owner, the
 * fields and the email again on the server. BRAND.md has no select or
 * multi-line field yet: these are plain controls on the GROS tokens, like
 * the Holidays page's, until design gives them a look.
 */
const control =
  'type-body w-full rounded-[var(--radius-md)] border-2 border-transparent bg-[var(--mist)] px-[var(--space-4)] text-[var(--ink)] focus:border-[var(--forest)] focus:bg-[var(--white)] focus:outline-none'

export function UseDesignForm({
  requestKey,
  source,
  defaultTitle,
  defaultDate,
  timezone,
  audiences
}: {
  requestKey: string
  /** `original`, a competitor email's id, or `imported:<id>`. */
  source: string
  defaultTitle: string
  defaultDate: string
  timezone: string
  audiences: { id: string; label: string }[]
}) {
  const id = useId()
  const [date, setDate] = useState(defaultDate)
  const candidates = localTimeCandidates(date, timezone)
  const at = (iso: string) =>
    new Intl.DateTimeFormat('en', {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'shortOffset'
    }).format(new Date(iso))
  return (
    <ActionButton
      action={createFirstDraft}
      label="Create draft"
      fields={{ requestKey, source }}
    >
      <div className="flex flex-col gap-[var(--space-2)]">
        <label htmlFor={`${id}-goal`} className="gros-field-label">
          What should this email do?
        </label>
        <textarea
          id={`${id}-goal`}
          name="goal"
          rows={3}
          minLength={5}
          maxLength={5000}
          required
          className={`${control} py-[var(--space-3)]`}
        />
      </div>
      <Field
        label="Name"
        name="title"
        defaultValue={defaultTitle}
        minLength={2}
        maxLength={200}
        required
        autoComplete="off"
      />
      <Field
        label={`Send time (${timezone})`}
        name="plannedLocal"
        type="datetime-local"
        value={date}
        onChange={(event) => setDate(event.target.value)}
        required
        error={
          date && !candidates.length
            ? 'This time does not exist here. Choose another time.'
            : null
        }
      />
      {candidates.length > 1 ? (
        <div className="flex flex-col gap-[var(--space-2)]">
          <label htmlFor={`${id}-occurrence`} className="gros-field-label">
            This time happens twice when the clocks change
          </label>
          <select
            id={`${id}-occurrence`}
            name="occurrence"
            required
            defaultValue=""
            className={`${control} min-h-[var(--control-sm)]`}
          >
            <option value="">Choose one</option>
            <option value="earlier">First · {at(candidates[0])}</option>
            <option value="later">
              Second · {at(candidates[candidates.length - 1])}
            </option>
          </select>
        </div>
      ) : (
        <input type="hidden" name="occurrence" value="" />
      )}
      <div className="flex flex-col gap-[var(--space-2)]">
        <label htmlFor={`${id}-audience`} className="gros-field-label">
          Audience
        </label>
        <select
          id={`${id}-audience`}
          name="audience"
          defaultValue=""
          className={`${control} min-h-[var(--control-sm)]`}
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
          defaultValue="email_design"
          className={`${control} min-h-[var(--control-sm)]`}
        >
          <option value="email_design">Designed email</option>
          <option value="email_text">Text email</option>
        </select>
      </div>
    </ActionButton>
  )
}
