import type { EmailBuildView, PlanRun } from './load'

/**
 * UI-PLAN-a (the owner's request of 16 November: a basic working UI on
 * docs/design/BRAND.md): what the Plan screen shows, from the plan run the
 * page already reads (`latestPlanRun`). Pure: the page draws it with the
 * GROS components (DayStrip, ListRow, Status, Progress, EmptyState), and
 * this file decides every word and state, so the screen has no logic of
 * its own.
 *
 * The screen is one of four:
 * - `empty`: no plan yet, one button (Plan next 15 days);
 * - `planning`: what the planner is doing, step by step;
 * - `failed`: what happened, in the owner's words, and Try again;
 * - `plan`: the 15 days, and each planned email with its one action.
 */
export type PlanScreen =
  | { kind: 'empty' }
  | { kind: 'planning'; steps: PlanStep[] }
  | { kind: 'failed'; reason: string }
  | {
      kind: 'plan'
      /** The 15 days have begun: only a new plan helps. */
      stale: boolean
      /** Made from the sample store: the screen says so. */
      sample: boolean
      startOn: string
      days: PlanDay[]
      emails: PlanEmail[]
      /** "3 in Klaviyo · 5 planned", for the card's label. */
      counts: { inKlaviyo: number; planned: number }
    }

export type PlanStep = {
  label: string
  state: 'done' | 'now' | 'next'
}

export type PlanDay = {
  date: string
  state: 'none' | 'planned' | 'in_klaviyo'
  /** The planned email of that day (its slot), the first when several. */
  slot: number | null
}

export type EmailStatus =
  | { kind: 'planned' }
  /** Agents are on it: the word is the step. */
  | { kind: 'working'; word: string }
  | { kind: 'in_klaviyo' }
  /** The owner must act: why, in his words. */
  | { kind: 'needs_you'; reason: string }

export type EmailAction =
  /** Create email (or Try again after a failure). */
  | { kind: 'create'; label: 'Create email' | 'Try again' }
  /** The email's own page: its preview, its run log, Open in Klaviyo. */
  | { kind: 'open'; buildId: string }

export type PlanEmail = {
  slot: number
  date: string
  /** "Fri 20". */
  day: string
  title: string
  /** Joined with a middle dot on the row: "Fri 20 · 6:00 pm · Past buyers". */
  details: string[]
  format: 'designed' | 'text'
  status: EmailStatus
  /** At most one action; none when there is nothing to do (a day passed). */
  action: EmailAction | null
  /** The one email that is next: lime-soft row with the forest button. */
  next: boolean
  /** The draft is a sample (Klaviyo not connected): nothing was sent to it. */
  sampleDraft: boolean
}

/** A build step in the owner's words, as the Working pill shows it. */
export const stepWords: Record<EmailBuildView['step'], string> = {
  sections: 'Planning',
  content: 'Choosing',
  copy: 'Writing',
  design: 'Designing',
  push: 'Drafting'
}

/** What an email is about, in a few words, when it has no title yet. */
const typeWords: Record<string, string> = {
  launch: 'New arrival',
  bestseller: 'Bestseller',
  offer: 'Offer',
  story: 'Story',
  'gift guide': 'Gift guide',
  restock: 'Back in stock',
  reminder: 'Reminder',
  education: 'How to'
}

const dayOf = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  day: 'numeric',
  timeZone: 'UTC'
})
/** "Fri 20" for 2026-11-20 (a plan's dates are the store's own days). */
export function dayLabel(date: string) {
  const t = Date.parse(`${date}T00:00:00Z`)
  if (Number.isNaN(t)) return date
  const parts = dayOf.formatToParts(new Date(t))
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? ''
  const day = parts.find((p) => p.type === 'day')?.value ?? ''
  return `${weekday} ${day}`.trim()
}

/** "6:00 pm" for "18:00". */
export function timeLabel(time: string) {
  const m = /^(\d{2}):(\d{2})$/.exec(time)
  if (!m) return time
  const h = Number(m[1])
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? 'am' : 'pm'}`
}

/** The 15 days from the plan's first one, YYYY-MM-DD. */
export function fifteenDays(start: string): string[] {
  const first = Date.parse(`${start}T00:00:00Z`)
  if (Number.isNaN(first)) return []
  return Array.from({ length: 15 }, (_, i) =>
    new Date(first + i * 86_400_000).toISOString().slice(0, 10)
  )
}

/** The planner's steps, as the run's state shows how far it got. */
function planningSteps(state: PlanRun['state']): PlanStep[] {
  const labels = [
    'Read your store and your discounts',
    'Planned 15 days of emails'
  ]
  const at = state === 'pulse_queued' ? 0 : 1
  return labels.map((label, i) => ({
    label:
      i === at
        ? i === 0
          ? 'Reading your store and your discounts'
          : 'Planning 15 days of emails'
        : label,
    state: i < at ? 'done' : i === at ? 'now' : 'next'
  }))
}

/** One planned email's status and action, from its latest build. */
function emailState(
  build: EmailBuildView | undefined,
  passed: boolean
): { status: EmailStatus; action: EmailAction | null } {
  if (!build)
    return passed
      ? {
          status: { kind: 'needs_you', reason: 'Its send time has passed.' },
          action: null
        }
      : {
          status: { kind: 'planned' },
          action: { kind: 'create', label: 'Create email' }
        }
  if (build.state === 'failed')
    return {
      status: {
        kind: 'needs_you',
        reason: build.reason ?? 'We could not create this email.'
      },
      action: passed ? null : { kind: 'create', label: 'Try again' }
    }
  if (build.state === 'drafted')
    return {
      status: { kind: 'in_klaviyo' },
      action: { kind: 'open', buildId: build.id }
    }
  return {
    status: { kind: 'working', word: stepWords[build.step] ?? 'Working' },
    action: { kind: 'open', buildId: build.id }
  }
}

/** The Plan screen from the latest plan run (see above). */
export function planScreen(run: PlanRun | null): PlanScreen {
  if (!run) return { kind: 'empty' }
  if (run.state === 'failed')
    return {
      kind: 'failed',
      reason: run.reason ?? 'The plan could not be made. Try again.'
    }
  if (run.state !== 'planned' || !run.plan)
    return run.state === 'planned'
      ? { kind: 'failed', reason: 'The plan could not be read. Try again.' }
      : { kind: 'planning', steps: planningSteps(run.state) }

  const slots = run.plan.slots
  const emails: PlanEmail[] = slots
    .map((s, slot) => {
      const passed = run.sendPassed?.[slot] ?? false
      const { status, action } = emailState(run.builds[slot], passed)
      const format: PlanEmail['format'] =
        s.format === 'text' ? 'text' : 'designed'
      const lead = s.products[0]?.title
      return {
        slot,
        date: s.date,
        day: dayLabel(s.date),
        title: lead
          ? `${typeWords[s.emailType] ?? 'Email'}: ${lead}`
          : (typeWords[s.emailType] ?? 'Email'),
        details: [
          dayLabel(s.date),
          timeLabel(s.time),
          s.audience.label,
          ...(s.offer ? [`${s.offer.percent}% off`] : []),
          ...(format === 'text' ? ['Text email'] : [])
        ],
        format,
        status,
        action,
        next: false,
        sampleDraft: run.builds[slot]?.sampleDraft ?? false
      }
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.slot - b.slot)
  // The next one: the first email still to create, on a day not passed.
  const next = emails.find(
    (e) => e.action?.kind === 'create' && e.status.kind === 'planned'
  )
  if (next && !run.stale) next.next = true

  const byDate = new Map<string, PlanEmail>()
  for (const e of emails) if (!byDate.has(e.date)) byDate.set(e.date, e)
  const days: PlanDay[] = fifteenDays(run.startOn).map((date) => {
    const e = byDate.get(date)
    return {
      date,
      state: !e
        ? 'none'
        : e.status.kind === 'in_klaviyo'
          ? 'in_klaviyo'
          : 'planned',
      slot: e ? e.slot : null
    }
  })
  const inKlaviyo = emails.filter((e) => e.status.kind === 'in_klaviyo').length
  return {
    kind: 'plan',
    stale: run.stale,
    sample: run.plan.sample === true,
    startOn: run.startOn,
    days,
    emails,
    counts: { inKlaviyo, planned: emails.length - inKlaviyo }
  }
}
