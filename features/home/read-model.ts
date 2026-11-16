import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ClientRequestContext } from '@/features/auth/domain/types'
import { learnedRows } from '@/features/learned/read-model'
import { offersPage } from '@/features/offers/data'
import type { ManagedOffers } from '@/features/offers/source'
import {
  resultsReadModel,
  type ResultLine
} from '@/features/results/read-model'
import {
  latestPlanRun,
  storeToday,
  type EmailBuildView,
  type PlanRun
} from '@/features/strategy/load'
import type { Database } from '@/lib/supabase/database.types'
import { createClient } from '@/lib/supabase/server'

/**
 * Home (master handoff section 11): the plan's 15 days and its emails, the
 * last 30 days' email numbers, the offers and the top things the agents
 * learned. Everything is read with the signed-in member's own client (row
 * rules keep it to their workspace); each part that cannot be read is
 * marked, and the others still show. What Home offers to create follows
 * the Plan page and `create_email_build`: a planned run's email can be
 * created (or tried again) until its send time passes.
 */
export const planDays = 15
export const nextCount = 3
export const learnedCount = 3
export const resultDays = 30

export type HomeDayState = 'none' | 'planned' | 'in_klaviyo'
export type HomeSlotStatus =
  'planned' | 'working' | 'in_klaviyo' | 'sample_draft' | 'failed'

export type HomeSlot = {
  slot: number
  date: string
  time: string
  /** The plan's angle for it, in the planner's words. */
  title: string
  audience: string
  format: 'designed' | 'text'
  status: HomeSlotStatus
  /** For `working`: the step in plain words (Designing). */
  stepWords: string | null
  /** For `failed`: why, in plain words. */
  reason: string | null
  buildId: string | null
  /** Its send time has passed (store time): it can no longer be created. */
  passed: boolean
  /**
   * The owner may click Create email (or Try again) now. A sixth failed try
   * is still refused by the database (the screen shows its words).
   */
  canCreate: boolean
}

export type HomeDay = {
  date: string
  state: HomeDayState
  /** The build to open (made or being made), else none: the plan opens. */
  buildId: string | null
}

export type HomePlanState =
  | 'none'
  | 'working'
  | 'offers_ready'
  | 'planned'
  | 'failed'
  /** Planned, but its stored plan cannot be read: start a new one. */
  | 'unreadable'

export type HomeView = {
  greeting: string
  owner: boolean
  plan: {
    state: HomePlanState
    runId: string | null
    reason: string | null
    /** An unfinished run whose days have begun: only a new plan helps. */
    outOfDate: boolean
    /** A planned run whose last day has passed. */
    ended: boolean
    /** The strip's first day: the plan's (or the one being made), else today. */
    start: string
    days: HomeDay[]
    next: HomeSlot[]
  } | null
  numbers: {
    /** Sent emails in the window with numbers read. */
    emails: number
    /** Added up from `revenueEmails` of them only (null when none). */
    revenue: number | null
    revenueEmails: number
    opens: number
    clicks: number
    currency: string | null
    /** Every number is whole: all orders read, nothing Klaviyo held back. */
    complete: boolean
    /** Every counted email came from the sample pusher. */
    sample: boolean
  } | null
  offers: { maxDiscountPercent: number | null; activeCodes: number } | null
  learned: {
    id: string
    kind: 'do' | 'dont'
    rule: string
    source: string
    at: string
  }[]
  /** The parts that could not be read (the screen says so). */
  unread: ('plan' | 'numbers' | 'offers' | 'learned')[]
}

/** The step a build is on, in a word or two for its status pill. */
function stepWordsOf(build: EmailBuildView) {
  if (build.state === 'push_queued' || build.step === 'push')
    return 'Saving draft'
  return build.step === 'design'
    ? 'Designing'
    : build.step === 'sections'
      ? 'Starting'
      : 'Writing'
}

/** Good morning, afternoon or evening, in the store's own time. */
export function greeting(name: string, timezone: string, now: Date) {
  let hour = now.getUTCHours()
  try {
    hour = Number(
      new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        hourCycle: 'h23',
        timeZone: timezone
      }).format(now)
    )
  } catch {
    // An unknown timezone: UTC.
  }
  const part = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'
  return `Good ${part}, ${name}`
}

/** `start` plus `n` days, YYYY-MM-DD (dates only, no clock). */
export function addDays(start: string, n: number) {
  return new Date(Date.parse(`${start}T00:00:00Z`) + n * 86_400_000)
    .toISOString()
    .slice(0, 10)
}

function slotsOf(run: PlanRun, owner: boolean): HomeSlot[] {
  if (run.state !== 'planned' || !run.plan) return []
  return run.plan.slots.map((s, i) => {
    const build = run.builds[i]
    const passed = run.sendPassed?.[i] ?? s.date < run.today
    const status: HomeSlotStatus = !build
      ? 'planned'
      : build.state === 'failed'
        ? 'failed'
        : build.state === 'drafted'
          ? build.sampleDraft
            ? 'sample_draft'
            : 'in_klaviyo'
          : 'working'
    return {
      slot: i,
      date: s.date,
      time: s.time,
      title: s.angle,
      audience: s.audience.label,
      format: s.format === 'text' ? 'text' : 'designed',
      status,
      stepWords: status === 'working' && build ? stepWordsOf(build) : null,
      reason: status === 'failed' ? (build?.reason ?? null) : null,
      buildId: build?.id ?? null,
      passed,
      canCreate:
        owner && !passed && (status === 'planned' || status === 'failed')
    }
  })
}

function planOf(
  run: PlanRun | null,
  owner: boolean,
  today: string
): NonNullable<HomeView['plan']> {
  const state: HomePlanState = !run
    ? 'none'
    : run.state === 'pulse_queued' || run.state === 'plan_queued'
      ? 'working'
      : (run.state === 'planned' && !run.plan) ||
          (run.state === 'offers_ready' && !run.pulse)
        ? 'unreadable'
        : run.state
  const slots = run ? slotsOf(run, owner) : []
  const start =
    state === 'planned' && run?.plan
      ? run.plan.start
      : state === 'working' || state === 'offers_ready'
        ? run!.startOn
        : today
  // A slot still to come: not in Klaviyo yet, and not a planned one whose
  // send time passed (it can no longer be made, for anyone).
  const ahead = (s: HomeSlot) =>
    s.status !== 'in_klaviyo' && !(s.passed && s.status === 'planned')
  const days = Array.from({ length: planDays }, (_, i): HomeDay => {
    const date = addDays(start, i)
    const on = slots.filter((s) => s.date === date)
    const inKlaviyo = on.find((s) => s.status === 'in_klaviyo')
    if (inKlaviyo)
      return { date, state: 'in_klaviyo', buildId: inKlaviyo.buildId }
    // A failed email's day shows nothing; its row says why.
    const planned = on.find((s) => ahead(s) && s.status !== 'failed')
    if (planned) return { date, state: 'planned', buildId: planned.buildId }
    return { date, state: 'none', buildId: null }
  })
  const next = slots
    .filter((s) => s.date >= today && ahead(s))
    .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))
    .slice(0, nextCount)
  return {
    state,
    runId: run?.id ?? null,
    reason: run?.state === 'failed' ? run.reason : null,
    // A run still being made (or waiting for offers) whose days began.
    outOfDate:
      state === 'working' || state === 'offers_ready' ? run!.stale : false,
    ended: state === 'planned' && !!run?.plan && run.plan.end < today,
    start,
    days,
    next
  }
}

const cents = (n: number) => Math.round(n * 100) / 100

function numbersOf(
  lines: readonly ResultLine[],
  currency: string | null,
  now: Date
): HomeView['numbers'] {
  const since = now.getTime() - resultDays * 86_400_000
  const counted = lines.filter(
    (l) => l.sentAt && Date.parse(l.sentAt) >= since && l.totals
  )
  if (counted.length === 0) return null
  const known = counted.filter((l) => l.totals!.revenue !== null)
  return {
    emails: counted.length,
    revenue: known.length
      ? cents(known.reduce((sum, l) => sum + l.totals!.revenue!, 0))
      : null,
    revenueEmails: known.length,
    opens: counted.reduce((sum, l) => sum + l.totals!.opens, 0),
    clicks: counted.reduce((sum, l) => sum + l.totals!.clicks, 0),
    currency,
    complete:
      known.length === counted.length && counted.every((l) => l.complete),
    sample: counted.every((l) => l.sample)
  }
}

export type HomeInput = {
  context: Pick<ClientRequestContext, 'tenantName' | 'tenantRole' | 'timezone'>
  now: Date
  /** undefined when it could not be read. */
  run: PlanRun | null | undefined
  results: readonly ResultLine[] | null
  currency: string | null
  /** null when it could not be read (`offersPage` answers null then). */
  offers: ManagedOffers | null
  learned: HomeView['learned'] | null
}

/** The Home view from its parts. Pure, for tests. */
export function homeView(input: HomeInput): HomeView {
  const { context, now } = input
  const owner = context.tenantRole === 'owner'
  const today = storeToday(context.timezone, now)
  const unread: HomeView['unread'] = []
  if (input.run === undefined) unread.push('plan')
  if (input.results === null) unread.push('numbers')
  if (input.offers === null) unread.push('offers')
  if (input.learned === null) unread.push('learned')
  return {
    greeting: greeting(context.tenantName, context.timezone, now),
    owner,
    plan: input.run === undefined ? null : planOf(input.run, owner, today),
    numbers: input.results
      ? numbersOf(input.results, input.currency, now)
      : null,
    offers: input.offers
      ? {
          maxDiscountPercent: input.offers.maxDiscountPercent,
          activeCodes: input.offers.codes.filter((c) => !c.ended).length
        }
      : null,
    learned: input.learned ?? [],
    unread
  }
}

type Db = SupabaseClient<Database>

/**
 * The workspace's top do's and don'ts that the agents use now, as the
 * Learned page reads them (`learnedRows`): pinned first, then surest.
 */
export async function topLearned(
  db: Db,
  tenantId: string,
  now: Date,
  limit = learnedCount
): Promise<HomeView['learned'] | null> {
  const rows = await learnedRows(db, tenantId, now, limit)
  if (!rows) return null
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind === 'dont' ? 'dont' : 'do',
    rule: r.rule,
    source: r.source,
    at: r.created_at
  }))
}

/** The currency the workspace's Klaviyo account reports, when known. */
export async function accountCurrency(db: Db, tenantId: string) {
  const { data } = await db
    .from('workspace_connections')
    .select('account_currency')
    .eq('tenant_id', tenantId)
    .eq('provider', 'klaviyo')
    .maybeSingle()
  const currency = data?.account_currency
  return currency && /^[A-Z]{3}$/.test(currency) ? currency : null
}

/** Home for the signed-in member's workspace. */
export async function homeReadModel(
  context: ClientRequestContext,
  now = new Date()
): Promise<HomeView> {
  const db = await createClient()
  const [plan, results, currency, offers, learned] = await Promise.all([
    latestPlanRun(context.tenantId, context.timezone, now).catch(
      () => ({ ok: false }) as const
    ),
    db ? resultsReadModel(db, context.tenantId) : null,
    db ? accountCurrency(db, context.tenantId).catch(() => null) : null,
    offersPage(context).catch(() => null),
    db ? topLearned(db, context.tenantId, now).catch(() => null) : null
  ])
  return homeView({
    context,
    now,
    run: plan.ok ? plan.run : undefined,
    results,
    currency,
    offers,
    learned
  })
}
