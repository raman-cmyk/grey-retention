import { z } from 'zod'

/** One of the workspace's own entries, as the page shows it. */
export type OwnEntry = {
  id: string
  name: string
  /** The saved date (YYYY-MM-DD). */
  date: string
  /** The date it next happens: the saved date, or this year's for repeats. */
  nextDate: string
  kind: 'holiday' | 'event'
  repeatsAnnually: boolean
  notes: string
  revision: number
}

/** "YYYY-MM-DD" for `at` in the brand's timezone. */
export function localDate(timezone: string, at: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(at)
}

/**
 * Next date on or after `from` with the same month and day (29 Feb → 28 Feb
 * in other years). Never before the saved date itself, like the database's
 * `private.next_occurrence`.
 */
export function nextOccurrence(date: string, from: string) {
  const [, m, d] = date.split('-').map(Number) as [number, number, number]
  const start = date > from ? date : from
  const year = Number(start.slice(0, 4))
  for (const y of [year, year + 1]) {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
    const candidate = `${y}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
    if (candidate >= start) return candidate
  }
  return date
}

/** "Mar 14" (and the year when it is not this year). */
export function shortDate(date: string, today: string) {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const text = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    ...(String(y) !== today.slice(0, 4) ? { year: 'numeric' } : {})
  }).format(new Date(Date.UTC(y, m - 1, d)))
  return text
}

/** Control characters, as Postgres `[[:cntrl:]]` sees them (C0, DEL, C1). */
const hasControlCharacter = (text: string) =>
  [...text].some((c) => {
    const code = c.codePointAt(0)!
    return code < 32 || (code >= 127 && code <= 159)
  })
/** Characters as the database counts them (an emoji is one, not two). */
const length = (text: string) => [...text].length

/** The add/edit form, with the same limits as `save_holiday`. */
export const entrySchema = z.object({
  id: z.uuid().nullable(),
  revision: z.number().int().min(0, 'Reload the page and try again.'),
  name: z
    .string()
    .trim()
    .refine((v) => length(v) >= 2, 'Name: at least 2 characters.')
    .refine((v) => length(v) <= 200, 'Name: at most 200 characters.')
    .refine((v) => !hasControlCharacter(v), 'Name: use one line of text.'),
  date: z.iso
    .date('Choose a date.')
    .refine(
      (v) => v >= '1900-01-01' && v <= '2999-12-31',
      'Choose a date between 1900 and 2999.'
    ),
  kind: z.enum(['holiday', 'event'], 'Choose Holiday or Event.'),
  repeatsAnnually: z.boolean(),
  notes: z
    .string()
    .refine((v) => length(v) <= 2000, 'Notes: at most 2000 characters.')
})

export function readEntryForm(form: FormData) {
  const text = (key: string) => {
    const value = form.get(key)
    return typeof value === 'string' ? value : ''
  }
  const revision = text('revision')
  return entrySchema.safeParse({
    id: text('id') || null,
    revision: /^\d+$/.test(revision) ? Number(revision) : -1,
    name: text('name'),
    date: text('date'),
    kind: text('kind'),
    repeatsAnnually: form.get('repeats') === 'on',
    notes: text('notes').replace(/\r\n/g, '\n')
  })
}

/**
 * The workspace's own entries, in the order they next happen, for the brand
 * timezone's today. Repeating entries show this year's (or next year's) date.
 */
export function ownEntries(
  rows: {
    id: string
    name: string
    event_date: string
    kind: string
    repeats_annually: boolean
    notes: string
    revision: number
  }[],
  today: string
): OwnEntry[] {
  return rows
    .map((row) => ({
      id: row.id,
      name: row.name,
      date: row.event_date,
      nextDate: row.repeats_annually
        ? nextOccurrence(row.event_date, today)
        : row.event_date,
      kind: row.kind === 'holiday' ? ('holiday' as const) : ('event' as const),
      repeatsAnnually: row.repeats_annually,
      notes: row.notes,
      revision: row.revision
    }))
    .sort(
      (a, b) =>
        Number(a.nextDate < today) - Number(b.nextDate < today) ||
        a.nextDate.localeCompare(b.nextDate) ||
        a.name.localeCompare(b.name)
    )
}
