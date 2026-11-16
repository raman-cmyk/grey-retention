import type { EmailBuildView, PlanRun } from './load'
import type { EmailType } from './plan'

/**
 * UI-PLAN-a (the owner's request of 16 November: a basic working UI on
 * docs/design/BRAND.md): what the Plan screen shows, from the plan run the
 * page already reads (`latestPlanRun`). Pure: the page draws it with the
 * GROS components (DayStrip, ListRow, Status, Progress, EmptyState), and
 * this file decides every word, state and button, so the screen has no
 * logic of its own. Only the workspace's owner starts a plan, picks offers
 * and creates emails (the server refuses anyone else): for staff the
 * screen says so and offers no such button.
 *
 * The screen is one of six:
 * - `empty`: no plan yet, one button (Plan next 15 days);
 * - `planning`: what the planner is doing, step by step;
 * - `offers`: the planner waits for the owner to pick the offers to run;
 * - `restart`: a plan started for days that have begun: start again;
 * - `failed`: what happened, in the owner's words, and Try again;
 * - `plan`: the 15 days, and each planned email with its one action.
 */
export type PlanScreen =
  | { kind: 'empty'; canPlan: boolean }
  | { kind: 'planning'; steps: PlanStep[] }
  | {
      kind: 'offers'
      /** Made from the sample store: the screen says so. */
      sample: boolean
      runId: string
      /** "Tue 17 Nov to Tue 1 Dec". */
      days: string
      summary: string
      highlights: { fact: string; why: string }[]
      offers: { id: string; label: string }[]
      /** "SUMMER10 is not offered: it ended on 1 Sep." */
      leftOut: string[]
      /** The owner picks; anyone else is told only the owner can. */
      canPick: boolean
    }
  | { kind: 'restart'; reason: string; canPlan: boolean }
  | { kind: 'failed'; reason: string; canPlan: boolean }
  | {
      kind: 'plan'
      /** Made from the sample store: the screen says so. */
      sample: boolean
      /** Planned from facts only: the AI was not used for this plan. */
      noAi: boolean
      /** The planner's own notes (a dropped email, an offer left out). */
      notes: string[]
      startOn: string
      days: PlanDay[]
      emails: PlanEmail[]
      /** None planned: why, in the owner's words. */
      none: string | null
      /** "3 in Klaviyo · 1 sample draft · 5 planned", for the card's label. */
      counts: { inKlaviyo: number; sampleDrafts: number; planned: number }
      /** Plan again (the owner only). */
      canPlan: boolean
    }

export type PlanStep = {
  label: string
  state: 'done' | 'now' | 'next'
}

export type PlanDay = {
  date: string
  /** The day's furthest email: in Klaviyo, a sample draft, or planned. */
  state: 'none' | 'planned' | 'sample_draft' | 'in_klaviyo'
  /** The planned email of that day (its slot), the first when several. */
  slot: number | null
}

export type EmailStatus =
  | { kind: 'planned' }
  /** Agents are on it: the word is the step. */
  | { kind: 'working'; word: string }
  | { kind: 'in_klaviyo' }
  /** Made by the fake pusher: nothing was sent to Klaviyo. */
  | { kind: 'sample_draft' }
  /** The owner must act: what happened and what to do, in his words. */
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
  /** What it is about, in a sentence. */
  angle: string
  /** Why the planner chose it, and the facts behind that. */
  why: string
  evidence: string[]
  status: EmailStatus
  /** At most one action; none when there is nothing to do or no right to. */
  action: EmailAction | null
  /** The one email that is next: lime-soft row with the forest button. */
  next: boolean
}

/** A build step in the owner's words, as the Working pill shows it. */
export const stepWords: Record<EmailBuildView['step'], string> = {
  sections: 'Planning sections',
  content: 'Choosing products',
  copy: 'Writing',
  design: 'Designing',
  push: 'Adding to Klaviyo'
}

/** What an email is about, in a few words, when it has no title yet. */
const typeWords: Record<EmailType, string> = {
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

const longDayOf = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC'
})
/** "Fri 20 Nov". */
function longDay(date: string) {
  const t = Date.parse(`${date}T00:00:00Z`)
  return Number.isNaN(t) ? date : longDayOf.format(new Date(t))
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
  const steps = [
    {
      done: 'Read your store and your discounts',
      doing: 'Reading your store and your discounts'
    },
    { done: 'Planned 15 days of emails', doing: 'Planning 15 days of emails' }
  ]
  const at = state === 'pulse_queued' ? 0 : 1
  return steps.map((s, i) => ({
    label: i < at ? s.done : s.doing,
    state: i < at ? 'done' : i === at ? 'now' : 'next'
  }))
}

const passedWords =
  'Its send time passed before it was made. Plan next 15 days for new emails.'

/** One planned email's status and action, from its latest build. */
function emailState(
  build: EmailBuildView | undefined,
  passed: boolean,
  owner: boolean
): { status: EmailStatus; action: EmailAction | null } {
  const create = (label: 'Create email' | 'Try again') =>
    owner ? ({ kind: 'create', label } as const) : null
  if (!build)
    return passed
      ? { status: { kind: 'needs_you', reason: passedWords }, action: null }
      : { status: { kind: 'planned' }, action: create('Create email') }
  if (build.state === 'failed') {
    const reason = build.reason ?? 'We could not create this email.'
    return passed
      ? {
          status: { kind: 'needs_you', reason: `${reason} ${passedWords}` },
          action: null
        }
      : {
          status: { kind: 'needs_you', reason },
          action: create('Try again')
        }
  }
  if (build.state === 'drafted')
    return {
      status: { kind: build.sampleDraft ? 'sample_draft' : 'in_klaviyo' },
      action: { kind: 'open', buildId: build.id }
    }
  return {
    status: { kind: 'working', word: stepWords[build.step] ?? 'Working' },
    action: { kind: 'open', buildId: build.id }
  }
}

/** How far a day's emails got, the furthest first. */
const dayRank: Record<PlanDay['state'], number> = {
  none: 0,
  planned: 1,
  sample_draft: 2,
  in_klaviyo: 3
}

/** The Plan screen from the latest plan run (see above). */
export function planScreen(
  run: PlanRun | null,
  { owner }: { owner: boolean }
): PlanScreen {
  if (!run) return { kind: 'empty', canPlan: owner }
  if (run.state === 'failed')
    return {
      kind: 'failed',
      reason: run.reason ?? 'The plan could not be made. Try again.',
      canPlan: owner
    }
  // An open run for days that have begun: the server closes it only when
  // a new one starts, so only starting again helps.
  if (run.state !== 'planned' && run.stale)
    return {
      kind: 'restart',
      reason:
        'This plan was for days that have started. Plan the next 15 days again.',
      canPlan: owner
    }
  if (run.state === 'offers_ready')
    return run.pulse
      ? {
          kind: 'offers',
          sample: run.pulse.sample === true,
          runId: run.id,
          days: `${longDay(run.pulse.start)} to ${longDay(run.pulse.end)}`,
          summary: run.pulse.summary,
          highlights: run.pulse.highlights.map((h) => ({
            fact: h.fact,
            why: h.why
          })),
          offers: run.pulse.offers.map((o) => ({
            id: o.id,
            label: `${o.percent}% off with ${o.code}${o.until ? `, until ${longDay(o.until)}` : ''}`
          })),
          leftOut: run.pulse.leftOut.map(
            (l) => `${l.code} is not offered: ${l.why}`
          ),
          canPick: owner
        }
      : {
          kind: 'failed',
          reason: 'This plan could not be read. Start a new one.',
          canPlan: owner
        }
  if (run.state !== 'planned')
    return { kind: 'planning', steps: planningSteps(run.state) }
  if (!run.plan)
    return {
      kind: 'failed',
      reason: 'This plan could not be read. Start a new one.',
      canPlan: owner
    }

  const plan = run.plan
  const emails: PlanEmail[] = plan.slots
    .map((s, slot) => {
      // REL-DAT: the loader says when a send time has passed; else its day.
      const passed = run.sendPassed?.[slot] ?? s.date < run.today
      const { status, action } = emailState(run.builds[slot], passed, owner)
      const format: PlanEmail['format'] =
        s.format === 'text' ? 'text' : 'designed'
      const kind = typeWords[s.emailType] ?? 'Email'
      const lead = s.products[0]?.title
      return {
        slot,
        date: s.date,
        day: dayLabel(s.date),
        title: lead ? `${kind}: ${lead}` : kind,
        details: [
          dayLabel(s.date),
          timeLabel(s.time),
          s.audience.label,
          ...(s.offer ? [`${s.offer.percent}% off with ${s.offer.code}`] : []),
          ...(format === 'text' ? ['Text email'] : [])
        ],
        format,
        angle: s.angle,
        why: s.why,
        evidence: s.evidence.map((e) => e.fact),
        status,
        action,
        next: false
      }
    })
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        plan.slots[a.slot]!.time.localeCompare(plan.slots[b.slot]!.time) ||
        a.slot - b.slot
    )
  // The next one: the first email still to create (a passed one has none).
  const next = emails.find(
    (e) => e.action?.kind === 'create' && e.status.kind === 'planned'
  )
  if (next) next.next = true

  const byDate = new Map<string, PlanDay>()
  for (const e of emails) {
    const state: PlanDay['state'] =
      e.status.kind === 'in_klaviyo' || e.status.kind === 'sample_draft'
        ? e.status.kind
        : 'planned'
    const day = byDate.get(e.date)
    if (!day) byDate.set(e.date, { date: e.date, state, slot: e.slot })
    else if (dayRank[state] > dayRank[day.state]) day.state = state
  }
  const days: PlanDay[] = fifteenDays(run.startOn).map(
    (date) => byDate.get(date) ?? { date, state: 'none', slot: null }
  )
  const inKlaviyo = emails.filter((e) => e.status.kind === 'in_klaviyo').length
  const sampleDrafts = emails.filter(
    (e) => e.status.kind === 'sample_draft'
  ).length
  return {
    kind: 'plan',
    sample: plan.sample === true,
    noAi: plan.source.brief === 'code' && plan.source.planner === 'code',
    notes: plan.notes,
    startOn: run.startOn,
    days,
    emails,
    none: emails.length
      ? null
      : 'No email fits these 15 days with your current settings.',
    counts: {
      inKlaviyo,
      sampleDrafts,
      planned: emails.length - inKlaviyo - sampleDrafts
    },
    canPlan: owner
  }
}
