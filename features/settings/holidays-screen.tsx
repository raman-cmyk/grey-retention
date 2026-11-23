import type { Route } from 'next'
import Link from 'next/link'
import { CalendarDays, Gift } from 'lucide-react'
import type { ReactNode } from 'react'
import { ActionAnswers, ActionButton } from '@/components/gros/action'
import { ButtonLink, buttonClasses } from '@/components/gros/button'
import { Card } from '@/components/gros/card'
import { Field } from '@/components/gros/input'
import { ListRow, RowList } from '@/components/gros/list-row'
import { AppPage, CardRow, defaultAssistant } from '@/components/gros/nav'
import {
  deleteHoliday,
  saveHoliday,
  setHolidayCountry
} from '@/features/holidays/actions'
import type { HolidaysPage } from '@/features/holidays/data'
import { shortDate, type OwnEntry } from '@/features/holidays/entries'
import {
  holidayCountries,
  type HolidayCategory
} from '@/features/holidays/platform'

/**
 * Holidays and events (UI-SETd), a GROS page under Settings: the brand's
 * own dates, which the planner plans around when they fall in the next 30
 * days, and the holidays of the store's country. Only the owner adds,
 * edits and deletes dates and picks the country (the actions check
 * again); everyone else reads them. BRAND.md has no select, checkbox or
 * multi-line field: these are plain controls on the GROS tokens until
 * design gives them a look.
 */
/**
 * The date opened with Edit (`?edit=`): the owner's only, and only one of
 * this workspace's own dates; anything else opens nothing.
 */
export function editingEntry(
  own: OwnEntry[] | null,
  owner: boolean,
  edit: string | string[] | undefined
): OwnEntry | null {
  if (!owner || typeof edit !== 'string') return null
  return own?.find((entry) => entry.id === edit) ?? null
}

export function HolidaysScreen({
  page,
  owner,
  editing,
  focusAdd = false,
  assistant = defaultAssistant
}: {
  page: HolidaysPage
  owner: boolean
  /** The date the owner opened with Edit, if any. */
  editing: OwnEntry | null
  /** Back from editing (Stop editing): the cursor goes to Add a date's Name. */
  focusAdd?: boolean
  assistant?: string
}) {
  return (
    <AppPage
      current="settings"
      title="Holidays and events"
      assistant={assistant}
    >
      <div>
        <ButtonLink href="/settings" label="Back to Settings" kind="quiet" />
      </div>
      <CardRow>
        <DatesCard page={page} owner={owner} />
        {owner && page.own ? (
          <EntryCard
            // Adding and editing each start with their own answer line, so
            // Stop editing leaves no Saved. behind.
            key={editing?.id ?? 'new'}
            entry={editing}
            focus={focusAdd && !editing}
            assistant={assistant}
          />
        ) : null}
      </CardRow>
      <PlatformCard page={page} owner={owner && page.state === 'ready'} />
    </AppPage>
  )
}

const unread: Record<HolidaysPage['state'], string> = {
  ready: '',
  demo: 'Your own dates are not kept in the demo.',
  no_database:
    'Your dates could not be read just now. Open this page again in a minute.',
  missing_table: 'Your dates need a database update. Planning still works.',
  load_failed:
    'Your dates could not be read just now. Open this page again in a minute.'
}

/**
 * A note in a row is a preview (the row shows its words whole): its first
 * 140 characters; the whole note is in the date's Edit form.
 */
export const notePreviewLength = 140
export function notePreview(note: string) {
  const text = note.trim()
  return text.length > notePreviewLength
    ? `${text.slice(0, notePreviewLength - 1).trimEnd()}…`
    : text
}

function Thumb({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden
      className="gros-thumb flex shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--mist)] text-[var(--stone)]"
    >
      {children}
    </span>
  )
}

function DatesCard({ page, owner }: { page: HolidaysPage; owner: boolean }) {
  const title = 'Your dates'
  return (
    <Card label={title}>
      <div className="flex flex-col gap-[var(--space-5)]">
        <ActionAnswers>
          <h2 className="type-heading">{title}</h2>
          {!page.own ? (
            <p className="type-body text-[var(--stone)]">
              {unread[page.state]}
            </p>
          ) : page.own.length === 0 ? (
            <p className="type-body text-[var(--stone)]">No dates yet.</p>
          ) : (
            <RowList label={title}>
              {page.own.map((entry) => (
                <ListRow
                  key={entry.id}
                  wrap
                  thumbnail={
                    <Thumb>
                      <CalendarDays size={18} strokeWidth={2} />
                    </Thumb>
                  }
                  title={entry.name}
                  details={[
                    shortDate(entry.nextDate, page.today),
                    entry.kind === 'holiday' ? 'Holiday' : 'Event',
                    entry.repeatsAnnually ? 'Every year' : '',
                    entry.nextDate < page.today ? 'Past' : '',
                    notePreview(entry.notes)
                  ]}
                  end={
                    owner ? (
                      <div className="flex flex-wrap gap-[var(--space-3)]">
                        <Link
                          href={`/settings/holidays?edit=${entry.id}` as Route}
                          aria-label={`Edit: ${entry.name}`}
                          className={buttonClasses('outline', 'row')}
                        >
                          Edit
                        </Link>
                        <ActionButton
                          action={deleteHoliday}
                          label="Delete"
                          spokenLabel={entry.name}
                          kind="quiet"
                          size="row"
                          fields={{
                            id: entry.id,
                            revision: String(entry.revision)
                          }}
                          confirm={`Delete “${entry.name}”? The plan stops using it.`}
                        />
                      </div>
                    ) : null
                  }
                />
              ))}
            </RowList>
          )}
        </ActionAnswers>
      </div>
    </Card>
  )
}

const control =
  'type-body w-full rounded-[var(--radius-md)] border-2 border-transparent bg-[var(--mist)] px-[var(--space-4)] text-[var(--ink)] focus:border-[var(--forest)] focus:bg-[var(--white)] focus:outline-none'

/** Add a date, or edit the one opened with Edit. */
function EntryCard({
  entry,
  focus,
  assistant
}: {
  entry: OwnEntry | null
  focus: boolean
  assistant: string
}) {
  const title = entry ? `Edit ${entry.name}` : 'Add a date'
  return (
    <Card label={title}>
      <div className="flex flex-col gap-[var(--space-5)]">
        <ActionAnswers>
          <h2 className="type-heading break-words">{title}</h2>
          <ActionButton
            // A saved edit opens the form again with the new values; the
            // card keeps its answer, which takes the cursor.
            key={entry ? `${entry.id}-${entry.revision}` : 'new'}
            action={saveHoliday}
            label={entry ? 'Save date' : 'Add date'}
            fields={{
              id: entry?.id ?? '',
              revision: String(entry?.revision ?? 0)
            }}
          >
            <Field
              label="Name"
              name="name"
              autoComplete="off"
              maxLength={200}
              defaultValue={entry?.name}
              // Only when the owner comes back from Edit (Stop editing).
              autoFocus={focus}
              required
            />
            <Field
              label="Date"
              name="date"
              type="date"
              defaultValue={entry?.date}
              required
            />
            <div className="flex flex-col gap-[var(--space-2)]">
              <label
                htmlFor="holiday-kind"
                className="gros-field-label text-[var(--ink)]"
              >
                Type
              </label>
              <select
                id="holiday-kind"
                name="kind"
                defaultValue={entry?.kind ?? 'event'}
                className={`${control} min-h-[var(--control-sm)]`}
              >
                <option value="event">Event</option>
                <option value="holiday">Holiday</option>
              </select>
            </div>
            <div className="type-body flex min-h-[var(--control-sm)] items-center gap-[var(--space-3)]">
              <input
                id="holiday-repeats"
                type="checkbox"
                name="repeats"
                defaultChecked={entry?.repeatsAnnually ?? false}
                className="size-[var(--space-5)] accent-[var(--forest)]"
              />
              <label htmlFor="holiday-repeats">Every year</label>
            </div>
            <div className="flex flex-col gap-[var(--space-2)]">
              <label
                htmlFor="holiday-notes"
                className="gros-field-label text-[var(--ink)]"
              >
                Notes for {assistant} (optional)
              </label>
              <textarea
                id="holiday-notes"
                name="notes"
                rows={3}
                maxLength={2000}
                defaultValue={entry?.notes}
                className={`${control} py-[var(--space-3)]`}
              />
            </div>
          </ActionButton>
          {entry ? (
            <ButtonLink
              href="/settings/holidays?from=edit"
              label="Stop editing"
              kind="quiet"
            />
          ) : null}
        </ActionAnswers>
      </div>
    </Card>
  )
}

const categoryWord: Record<HolidayCategory, string> = {
  civic: 'Public holiday',
  cultural: 'Celebration',
  commercial: 'Shopping day'
}

/** The country's holidays in the next 90 days; the owner picks the country. */
function PlatformCard({ page, owner }: { page: HolidaysPage; owner: boolean }) {
  const title = 'Holidays in the plan'
  const country =
    holidayCountries.find((c) => c.code === page.country)?.label ?? page.country
  return (
    <Card label={title}>
      <div className="flex flex-col gap-[var(--space-5)]">
        <ActionAnswers>
          <h2 className="type-heading">{title}</h2>
          <p className="type-caption text-[var(--stone)]">
            {[
              country,
              page.countrySource === 'guess'
                ? 'Guessed from your timezone'
                : '',
              `The next 90 days, kept up to date by ${page.managedBy}`
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {page.platform.length === 0 ? (
            <p className="type-body text-[var(--stone)]">
              No holidays in the next 90 days.
            </p>
          ) : (
            <RowList label={title}>
              {page.platform.map((holiday) => (
                <ListRow
                  key={`${holiday.date}-${holiday.name}`}
                  wrap
                  thumbnail={
                    <Thumb>
                      <Gift size={18} strokeWidth={2} />
                    </Thumb>
                  }
                  title={holiday.name}
                  details={[
                    shortDate(holiday.date, page.today),
                    categoryWord[holiday.category]
                  ]}
                  end={null}
                />
              ))}
            </RowList>
          )}
          {owner ? (
            <ActionButton
              // A select takes its default only when it mounts: after a save
              // the form remounts with the saved country (the card keeps the
              // answer, and the cursor goes to it).
              key={page.country}
              action={setHolidayCountry}
              label="Save country"
              kind="outline"
            >
              <div className="flex flex-col gap-[var(--space-2)]">
                <label
                  htmlFor="holiday-country"
                  className="gros-field-label text-[var(--ink)]"
                >
                  Country
                </label>
                <select
                  id="holiday-country"
                  name="country"
                  defaultValue={page.country}
                  className={`${control} min-h-[var(--control-sm)]`}
                >
                  {holidayCountries.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            </ActionButton>
          ) : null}
        </ActionAnswers>
      </div>
    </Card>
  )
}
