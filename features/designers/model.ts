import type { PillTone } from '@/lib/campaign-status'
import { formatBrandDateTime, relativeTime } from '@/lib/brand-time'

/**
 * Plain words for the designer desk (UIR-025). The owner sees the campaign
 * as "With designer" or "Needs your approval" (UIR-015); the designer sees
 * the same assignment from their side: what is theirs to do and what waits
 * for the owner.
 */
export const deskFilters = ['todo', 'waiting', 'approved', 'all'] as const
export type DeskFilter = (typeof deskFilters)[number]

export type AssignmentStatus = {
  label: string
  tone: PillTone
  /** One sentence: what this means and what to do next. */
  meaning: string
  group: Exclude<DeskFilter, 'all'> | null
}

const statuses: Record<string, AssignmentStatus> = {
  assigned: {
    label: 'To do',
    tone: 'warning',
    meaning: 'Make the first design for this brief and submit it.',
    group: 'todo'
  },
  revisions_requested: {
    label: 'Redo requested',
    tone: 'accent-2',
    meaning:
      'The brand owner asked for changes. Read their feedback, then submit a new version.',
    group: 'todo'
  },
  submitted: {
    label: 'Waiting for owner',
    tone: 'info',
    meaning:
      'You submitted a version. The brand owner reviews it and approves it or asks for a redo.',
    group: 'waiting'
  },
  approved: {
    label: 'Approved',
    tone: 'success',
    meaning:
      'The brand owner approved this exact version. Nothing more to do here.',
    group: 'approved'
  },
  cancelled: {
    label: 'Cancelled',
    tone: 'neutral',
    meaning: 'Platform admin took this brief off your desk.',
    group: null
  }
}

const changedBrief: AssignmentStatus = {
  label: 'Brief changed',
  tone: 'warning',
  meaning:
    'The approved copy changed after you were assigned. Platform admin must assign the new version before you can submit.',
  group: 'todo'
}

/** The designer-facing status; an unknown state never reads as done. */
export function assignmentStatus(
  state: string,
  stale = false
): AssignmentStatus {
  const known = statuses[state]
  if (stale && (!known || known.group === 'todo')) return changedBrief
  return (
    known ?? {
      label: 'Unknown',
      tone: 'neutral',
      meaning: 'This assignment is in a state the desk does not know.',
      group: null
    }
  )
}

/** Submitting is open only while the brief is current and it is the designer's turn. */
export function canSubmit(state: string, stale: boolean) {
  return !stale && (state === 'assigned' || state === 'revisions_requested')
}

/** Why the submit form is closed, or null while it is open. */
export function closedReason(state: string, stale: boolean) {
  if (canSubmit(state, stale)) return null
  if (state === 'submitted')
    return 'Nothing to submit now: the owner is reviewing your latest version.'
  if (state === 'approved')
    return 'Nothing to submit: the owner approved this design.'
  if (state === 'cancelled')
    return 'Submitting is closed: this brief was taken off your desk.'
  return 'Submitting is closed until platform admin assigns the current brief.'
}

export type DueLine = {
  /** "Due in 3 hours", "Was due 2 hours ago", or "Due" when not urgent. */
  text: string
  tone: PillTone
  /** Always shown next to the text: "Nov 7, 2026 · 9:30 AM UTC". */
  exact: string
  /** For `<time dateTime>`. */
  iso: string
}

/**
 * "Due in 3 hours", "Was due 2 hours ago" (danger) or "Due in 4 days",
 * always next to the exact time. Only work the designer can act on now is
 * urgent; waiting, approved or changed briefs show the time plainly.
 * Times are UTC: designers work across many brands.
 */
export function dueLine(
  dueAt: string,
  state: string,
  now: Date = new Date(),
  stale = false
): DueLine | null {
  const exact = formatBrandDateTime(dueAt, 'UTC')
  const relative = relativeTime(dueAt, now)
  if (!exact || !relative) return null
  const at = `${exact} UTC`
  const iso = new Date(dueAt).toISOString()
  if (!canSubmit(state, stale))
    return { text: 'Due', tone: 'neutral', exact: at, iso }
  const left = new Date(dueAt).getTime() - now.getTime()
  if (relative === 'just now')
    return { text: 'Due now', tone: 'danger', exact: at, iso }
  if (left < 0)
    return { text: `Was due ${relative}`, tone: 'danger', exact: at, iso }
  return {
    text: `Due ${relative}`,
    tone: left <= 6 * 3600_000 ? 'warning' : 'neutral',
    exact: at,
    iso
  }
}

export type DeskAssignment = {
  id: string
  state: string
  due_at: string
  copy_revision: number
  brief: unknown
}

function briefText(brief: unknown, key: 'title' | 'brandName') {
  if (!brief || typeof brief !== 'object') return null
  const value = (brief as Record<string, unknown>)[key]
  return typeof value === 'string' && value.trim() ? value : null
}

export function parseDeskFilter(raw: string | string[] | undefined) {
  const value = Array.isArray(raw) ? raw[0] : raw
  return deskFilters.find((f) => f === value) ?? null
}

/**
 * Rows, counts and the chosen tab. Without a choice the desk opens on
 * "To do" when there is something to do, otherwise on "All".
 * Overdue to-dos come first, then the nearest due time.
 */
export function deskModel(
  assignments: DeskAssignment[],
  chosen: DeskFilter | null,
  now: Date = new Date()
) {
  const rows = assignments
    .map((a) => ({
      id: a.id,
      title: briefText(a.brief, 'title') ?? 'Approved campaign brief',
      brand: briefText(a.brief, 'brandName'),
      copyRevision: a.copy_revision,
      status: assignmentStatus(a.state),
      due: dueLine(a.due_at, a.state, now),
      dueAt: new Date(a.due_at).getTime()
    }))
    .filter((r) => r.status.group !== null)
  const counts: Record<DeskFilter, number> = {
    todo: 0,
    waiting: 0,
    approved: 0,
    all: rows.length
  }
  for (const r of rows) counts[r.status.group!] += 1
  const filter = chosen ?? (counts.todo > 0 ? 'todo' : 'all')
  const order = (r: (typeof rows)[number]) =>
    r.status.group === 'todo' ? 0 : r.status.group === 'waiting' ? 1 : 2
  const shown = rows
    .filter((r) => filter === 'all' || r.status.group === filter)
    .sort(
      (a, b) =>
        order(a) - order(b) ||
        (order(a) === 2 ? b.dueAt - a.dueAt : a.dueAt - b.dueAt)
    )
  return { filter, counts, rows: shown }
}

export const deskFilterLabels: Record<DeskFilter, string> = {
  todo: 'To do',
  waiting: 'Waiting for owner',
  approved: 'Approved',
  all: 'All'
}

export const emptyDeskWords: Record<
  DeskFilter,
  { title: string; description: string }
> = {
  todo: {
    title: 'Nothing to do right now',
    description:
      'New briefs appear here when platform admin assigns you approved copy.'
  },
  waiting: {
    title: 'Nothing waiting for the owner',
    description:
      'Designs you submit wait here until the brand owner reviews them.'
  },
  approved: {
    title: 'No approved designs yet',
    description: 'Designs the brand owner approves are listed here.'
  },
  all: {
    title: 'No briefs assigned yet',
    description:
      'Platform admin assigns you approved copy. Each brief then appears here with its due time.'
  }
}

/** The section a review names; an approval covers the whole design. */
export function reviewSection(section: string) {
  return section === 'whole_design' ? 'Whole design' : section
}

/** Owner review rows, newest first, in the designer's words. */
export function reviewWords(decision: string) {
  return decision === 'approved'
    ? { label: 'Approved', tone: 'success' as PillTone }
    : { label: 'Redo requested', tone: 'accent-2' as PillTone }
}
