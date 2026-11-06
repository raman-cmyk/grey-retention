'use client'
import { useId, useMemo, useState } from 'react'
import {
  localDateTime,
  localTimeCandidates,
  occurrenceField
} from '@/lib/local-time'
import { formatInTimeZone } from '@/lib/time'
import { controlClass } from './control'
import { TextField } from './text-field'

/** Readable name for a workspace timezone, e.g. "Asia/Kathmandu" → "Kathmandu". */
export function timezoneName(timezone: string) {
  if (timezone === 'UTC' || timezone === 'Etc/UTC') return 'UTC'
  return (timezone.split('/').pop() ?? timezone).replaceAll('_', ' ')
}

/** "1:30 AM GMT+11" — tells the two occurrences of a repeated time apart. */
function withOffset(iso: string, timezone: string) {
  return new Intl.DateTimeFormat('en', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'shortOffset'
  }).format(new Date(iso))
}

/**
 * Date-and-time picker in the workspace timezone. Submits the wall time as
 * `name` (`YYYY-MM-DDTHH:mm`); the server converts it with
 * `resolveLocalTimeFields` using the authorized workspace timezone. Times that
 * do not exist (clocks jump forward) are flagged; times that occur twice
 * (clocks go back) ask which one is meant via `${name}Occurrence`.
 */
export function LocalDateTimeField({
  name,
  label,
  timezone,
  defaultValue,
  required = true,
  help
}: {
  name: string
  label: string
  timezone: string
  /** Exact time to start from (ISO or Date); shown in the workspace timezone. */
  defaultValue?: string | Date
  required?: boolean
  help?: string
}) {
  const id = useId()
  const [value, setValue] = useState(() =>
    defaultValue ? localDateTime(defaultValue, timezone) : ''
  )
  const [occurrence, setOccurrence] = useState('')
  const candidates = useMemo(
    () => (value ? localTimeCandidates(value, timezone) : []),
    [value, timezone]
  )
  const zone = timezoneName(timezone)
  const preview =
    candidates.length === 1
      ? formatInTimeZone(candidates[0]!, timezone, {
          dateStyle: 'full',
          timeStyle: 'short'
        })
      : null
  return (
    <div className="min-w-0 space-y-2 text-sm font-medium">
      <label htmlFor={id} className="block">
        {label}
      </label>
      <TextField
        id={id}
        type="datetime-local"
        name={name}
        value={value}
        required={required}
        aria-invalid={value && !candidates.length ? true : undefined}
        aria-describedby={`${id}-help`}
        onChange={(event) => {
          setValue(event.target.value)
          setOccurrence('')
        }}
      />
      <p
        id={`${id}-help`}
        className="text-xs leading-5 font-normal text-[var(--text-muted)]"
      >
        {preview ? `${preview} · ` : ''}
        {`${zone} time (your workspace timezone).`}
        {help ? ` ${help}` : ''}
      </p>
      {value && !candidates.length && (
        <p role="alert" className="text-sm text-[var(--danger-ink)]">
          This time does not exist in {zone} because the clocks change. Choose
          another time.
        </p>
      )}
      {candidates.length > 1 && (
        <div className="space-y-2">
          <label htmlFor={`${id}-occurrence`} className="block">
            This time happens twice when the clocks go back
          </label>
          <select
            id={`${id}-occurrence`}
            name={occurrenceField(name)}
            className={controlClass}
            value={occurrence}
            onChange={(event) => setOccurrence(event.target.value)}
            required
          >
            <option value="">Choose which one</option>
            <option value="earlier">
              The first time ({withOffset(candidates[0]!, timezone)})
            </option>
            <option value="later">
              The second time (
              {withOffset(candidates[candidates.length - 1]!, timezone)})
            </option>
          </select>
        </div>
      )}
    </div>
  )
}
