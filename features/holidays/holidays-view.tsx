'use client'
import {
  startTransition,
  useActionState,
  useEffect,
  useId,
  useState
} from 'react'
import {
  Landmark,
  Pencil,
  Repeat,
  ShoppingBag,
  Sparkles,
  Trash2,
  type LucideIcon
} from 'lucide-react'
import { AlertDialog } from '@/components/ui/alert-dialog'
import { SubmitButton, type FormResult } from '@/components/ui/action-form'
import { Button } from '@/components/ui/button'
import { Pill } from '@/components/ui/pill'
import { TextField } from '@/components/ui/text-field'
import { controlClass } from '@/components/ui/control'
import { cn } from '@/lib/utils'
import { deleteHoliday, saveHoliday, setHolidayCountry } from './actions'
import { shortDate, type OwnEntry } from './entries'
import {
  holidayCountries,
  type HolidayCategory,
  type HolidayCountry,
  type PlatformHoliday
} from './platform'

const labelClass =
  'tracking-label block font-mono text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase'
const cardClass =
  'space-y-5 rounded-[var(--radius-panel)] border border-[var(--line)] bg-[var(--surface-raised)] p-6'

/** Moves keyboard focus to an element once it is on the page. */
function useFocus() {
  const [target, setTarget] = useState<{ id: string } | null>(null)
  useEffect(() => {
    if (target) document.getElementById(target.id)?.focus()
  }, [target])
  return (id: string) => setTarget({ id })
}

function Status({ state, pending }: { state: FormResult; pending: boolean }) {
  return (
    <p
      aria-live="polite"
      className={cn(
        'text-sm empty:hidden',
        !pending && (state.error || state.message) && 'rounded-lg px-3 py-2',
        state.error
          ? 'bg-[var(--danger-soft)] text-[var(--danger-ink)]'
          : 'bg-[var(--brand-soft)] text-[var(--brand-ink)]'
      )}
    >
      {pending ? '' : (state.error ?? state.message ?? '')}
    </p>
  )
}

/** Name, date + type, repeats, notes: used to add and to edit an entry. */
function EntryFields({ entry, idBase }: { entry?: OwnEntry; idBase: string }) {
  return (
    <>
      <div className="space-y-2">
        <label htmlFor={`${idBase}-name`} className={labelClass}>
          Name
        </label>
        <TextField
          id={`${idBase}-name`}
          name="name"
          defaultValue={entry?.name ?? ''}
          placeholder="e.g. Brand anniversary, Summer drop"
          maxLength={200}
          required
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <label htmlFor={`${idBase}-date`} className={labelClass}>
            Date
          </label>
          <TextField
            id={`${idBase}-date`}
            name="date"
            type="date"
            defaultValue={entry?.date ?? ''}
            required
          />
        </div>
        <div className="space-y-2">
          <label htmlFor={`${idBase}-kind`} className={labelClass}>
            Type
          </label>
          <select
            id={`${idBase}-kind`}
            name="kind"
            defaultValue={entry?.kind ?? 'holiday'}
            className={controlClass}
          >
            <option value="holiday">Holiday</option>
            <option value="event">Event</option>
          </select>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="repeats"
          defaultChecked={entry?.repeatsAnnually ?? false}
        />
        Repeats annually (same date)
      </label>
      <div className="space-y-2">
        <label htmlFor={`${idBase}-notes`} className={labelClass}>
          Notes for the AI strategist (optional)
        </label>
        <textarea
          id={`${idBase}-notes`}
          name="notes"
          rows={3}
          maxLength={2000}
          defaultValue={entry?.notes ?? ''}
          placeholder="e.g. Our biggest drop of the year — tease it early."
          className={controlClass}
        />
      </div>
    </>
  )
}

/** Left card: "Add an entry". */
export function AddEntryCard() {
  // A new, empty form after each successful add; typed values stay on error.
  const [round, setRound] = useState(0)
  const idBase = useId()
  const [state, dispatch, pending] = useActionState(
    async (previous: FormResult, form: FormData) => {
      const result = await saveHoliday(previous, form)
      if (result.message) setRound((n) => n + 1)
      return result
    },
    {}
  )
  // After an add, the cursor waits in the new form's Name field.
  useEffect(() => {
    if (round > 0) document.getElementById(`${idBase}-${round}-name`)?.focus()
  }, [round, idBase])
  return (
    <section aria-labelledby={`${idBase}-title`} className={cardClass}>
      <h2 id={`${idBase}-title`} className="text-lg font-semibold">
        Add an entry
      </h2>
      <form
        key={round}
        action={dispatch}
        noValidate
        onReset={(event) => event.preventDefault()}
        className="space-y-4"
      >
        <input type="hidden" name="revision" value="0" />
        <EntryFields idBase={`${idBase}-${round}`} />
        <div className="[&>button]:w-full">
          <SubmitButton pendingLabel="Adding…">Add entry</SubmitButton>
        </div>
      </form>
      <Status state={state} pending={pending} />
    </section>
  )
}

/** The inline edit form; a fresh one (no old error) each time it opens. */
function EditForm({
  entry,
  onSaved,
  onCancel
}: {
  entry: OwnEntry
  onSaved: (message: string) => void
  onCancel: () => void
}) {
  const idBase = useId()
  const [state, dispatch, pending] = useActionState(
    async (previous: FormResult, form: FormData) => {
      const result = await saveHoliday(previous, form)
      if (result.message) onSaved(result.message)
      return result
    },
    {}
  )
  useEffect(() => {
    document.getElementById(`${idBase}-name`)?.focus()
  }, [idBase])
  return (
    <form
      action={dispatch}
      noValidate
      onReset={(event) => event.preventDefault()}
      className="space-y-4"
      aria-label={`Edit ${entry.name}`}
    >
      <input type="hidden" name="id" value={entry.id} />
      <input type="hidden" name="revision" value={entry.revision} />
      <EntryFields entry={entry} idBase={idBase} />
      <div className="flex flex-wrap gap-3">
        <SubmitButton>Save</SubmitButton>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <Status state={state} pending={pending} />
    </form>
  )
}

function EntryRow({
  entry,
  today,
  owner,
  editId,
  editing,
  onEdit,
  onSaved,
  onCancel,
  onDelete,
  deleting
}: {
  entry: OwnEntry
  today: string
  owner: boolean
  /** The id of this row's Edit button (focus returns to it). */
  editId: string
  editing: number | null
  onEdit: () => void
  onSaved: (message: string) => void
  onCancel: () => void
  onDelete: () => void
  deleting: boolean
}) {
  const [confirming, setConfirming] = useState(false)
  const past = entry.nextDate < today
  return (
    <li className="space-y-3 border-b border-[var(--line)] py-4 last:border-b-0">
      {editing !== null ? (
        <EditForm
          key={editing}
          entry={entry}
          onSaved={onSaved}
          onCancel={onCancel}
        />
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-[var(--text-muted)]">
                {shortDate(entry.nextDate, today)}
              </span>
              <span className="font-semibold break-words">{entry.name}</span>
              <Pill tone={entry.kind === 'holiday' ? 'info' : 'neutral'}>
                {entry.kind === 'holiday' ? 'Holiday' : 'Event'}
              </Pill>
              {entry.repeatsAnnually && (
                <span className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)]">
                  <Repeat className="size-3" aria-hidden="true" />
                  Every year
                </span>
              )}
              {past && (
                <span className="text-xs text-[var(--text-muted)]">
                  (already passed)
                </span>
              )}
            </p>
            {entry.notes && (
              <p className="text-sm break-words whitespace-pre-wrap text-[var(--text-muted)]">
                {entry.notes}
              </p>
            )}
          </div>
          {owner && (
            <div className="flex gap-2">
              <Button
                id={editId}
                type="button"
                variant="secondary"
                size="sm"
                aria-label={`Edit ${entry.name}`}
                onClick={onEdit}
              >
                <Pencil className="size-3.5" aria-hidden="true" />
                Edit
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                aria-label={`Delete ${entry.name}`}
                disabled={deleting}
                onClick={() => setConfirming(true)}
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
                Delete
              </Button>
            </div>
          )}
        </div>
      )}
      {owner && (
        <AlertDialog
          open={confirming}
          title={`Delete “${entry.name}”?`}
          confirmLabel="Delete"
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false)
            onDelete()
          }}
        >
          The AI strategist will no longer plan around it. This cannot be
          undone.
        </AlertDialog>
      )}
    </li>
  )
}

/** Right card: "Yours · N total". */
export function YoursCard({
  entries,
  today,
  owner
}: {
  entries: OwnEntry[]
  today: string
  owner: boolean
}) {
  const id = useId()
  const focus = useFocus()
  const editButton = (entryId: string) => `${id}-edit-${entryId}`
  // Which entry is open for editing, and a new number for each opening.
  const [editing, setEditing] = useState<{ id: string; n: number } | null>(null)
  // "Saved." and "Deleted." stay here after the row's form or the row goes.
  const [notice, setNotice] = useState<FormResult>({})
  const [, remove, removing] = useActionState(
    async (previous: FormResult, form: FormData) => {
      const result = await deleteHoliday(previous, form)
      setNotice(result)
      if (result.message) focus(`${id}-title`)
      return result
    },
    {}
  )
  const close = (entryId: string) => {
    setEditing(null)
    focus(editButton(entryId))
  }
  return (
    <section aria-labelledby={`${id}-title`} className={cardClass}>
      <div className="flex items-baseline justify-between gap-3">
        <h2
          id={`${id}-title`}
          tabIndex={-1}
          className="text-lg font-semibold outline-none"
        >
          Yours
        </h2>
        <p className="text-sm text-[var(--text-muted)]">
          {entries.length} total
        </p>
      </div>
      <Status state={notice} pending={removing} />
      {entries.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">
          {owner
            ? 'Nothing yet — add your first on the left.'
            : 'Nothing yet. The workspace owner can add entries.'}
        </p>
      ) : (
        <ul>
          {entries.map((entry) => (
            <EntryRow
              key={entry.id}
              entry={entry}
              today={today}
              owner={owner}
              editId={editButton(entry.id)}
              editing={editing?.id === entry.id ? editing.n : null}
              onEdit={() => {
                setNotice({})
                setEditing({ id: entry.id, n: (editing?.n ?? 0) + 1 })
              }}
              onSaved={(message) => {
                setNotice({ message })
                close(entry.id)
              }}
              onCancel={() => close(entry.id)}
              deleting={removing}
              onDelete={() => {
                const data = new FormData()
                data.set('id', entry.id)
                data.set('revision', String(entry.revision))
                setNotice({})
                startTransition(() => remove(data))
              }}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

const categories: {
  key: HolidayCategory
  label: string
  icon: LucideIcon
  className: string
}[] = [
  {
    key: 'civic',
    label: 'Public holiday',
    icon: Landmark,
    className: 'text-[var(--brand-ink)]'
  },
  {
    key: 'cultural',
    label: 'Celebration',
    icon: Sparkles,
    className: 'text-accent-2'
  },
  {
    key: 'commercial',
    label: 'Shopping day',
    icon: ShoppingBag,
    className: 'text-[var(--danger-ink)]'
  }
]
const category = Object.fromEntries(
  categories.map((c) => [c.key, c])
) as Record<HolidayCategory, (typeof categories)[number]>

/** Platform list: next 90 days, for the workspace's country. */
export function PlatformCard({
  holidays,
  today,
  managedBy,
  country,
  countrySource,
  owner
}: {
  holidays: PlatformHoliday[]
  today: string
  managedBy: string
  country: HolidayCountry
  countrySource: 'saved' | 'guess' | 'unknown'
  owner: boolean
}) {
  const [state, dispatch, pending] = useActionState(setHolidayCountry, {})
  const id = useId()
  const label =
    holidayCountries.find((c) => c.code === country)?.label ?? country
  return (
    <section aria-labelledby={id} className={cardClass}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2 id={id} className="text-lg font-semibold">
          Platform holidays &amp; events ·{' '}
          <span className="font-normal">next 90 days</span> ·{' '}
          <span className="font-normal text-[var(--text-muted)]">
            managed by {managedBy}
          </span>
        </h2>
        {owner ? (
          // A new form when the saved country changes, and no reset back to
          // the old choice after saving (or when saving fails).
          <form
            key={country}
            action={dispatch}
            onReset={(event) => event.preventDefault()}
            className="flex flex-wrap items-end gap-2"
          >
            <div className="space-y-1">
              <label htmlFor={`${id}-country`} className={labelClass}>
                Country
              </label>
              <select
                id={`${id}-country`}
                name="country"
                defaultValue={country}
                className={controlClass}
              >
                {holidayCountries.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <SubmitButton variant="secondary" pendingLabel="Saving…">
              Save country
            </SubmitButton>
          </form>
        ) : (
          <p className="text-sm text-[var(--text-muted)]">
            Holidays for {label}
          </p>
        )}
      </div>
      {countrySource === 'guess' && (
        <p className="text-xs text-[var(--text-muted)]">
          Guessed from your timezone: {label}.
          {owner ? ' Choose your country if this is wrong.' : ''}
        </p>
      )}
      <Status state={state} pending={pending} />
      <ul
        aria-label="Key"
        className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--text-muted)]"
      >
        {categories.map(({ key, label, icon: Icon, className }) => (
          <li key={key} className="inline-flex items-center gap-1">
            <Icon className={cn('size-3.5', className)} aria-hidden="true" />
            {label}
          </li>
        ))}
      </ul>
      {holidays.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">
          No platform holidays in the next 90 days.
        </p>
      ) : (
        <ul aria-label="Platform holidays" className="flex flex-wrap gap-2">
          {holidays.map((h) => {
            const { icon: Icon, label, className } = category[h.category]
            return (
              <li
                key={`${h.date}-${h.name}`}
                title={label}
                className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] px-3 py-1 text-sm"
              >
                <span className="font-mono text-xs text-[var(--text-muted)]">
                  {shortDate(h.date, today)}
                </span>
                <Icon
                  className={cn('size-3.5 shrink-0', className)}
                  aria-hidden="true"
                />
                <span className={cn('font-semibold', className)}>{h.name}</span>
                <span className="sr-only">({label})</span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
