import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ClientRequestContext } from '@/features/auth/domain/types'
import type { BuildStep } from '@/features/email-build/step-names'
import { offersPage } from '@/features/offers/data'
import type { ManagedOffers } from '@/features/offers/source'
import {
  resultsReadModel,
  type ResultLine
} from '@/features/results/read-model'
import {
  latestPlanRun,
  storeToday,
  type PlanRun
} from '@/features/strategy/load'
import type { Database } from '@/lib/supabase/database.types'
import { createClient } from '@/lib/supabase/server'

/**
 * Home (master handoff section 11): the plan's 15 days and its emails, the
 * last 30 days' email numbers, the offers and the top things the agents
 * learned. Everything is read with the signed-in member's own client (row
 * rules keep it to their workspace); each part that cannot be read is
 * marked, and the others still show.
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
  /** The owner may click Create email (or Try again) on it now. */
  canCreate: boolean
}

export type HomeDay = {
  date: string
  state: HomeDayState
  /** The email to open: its built draft, else none (the plan opens it). */
  buildId: string | null
}

export type HomeView = {
  greeting: string
  owner: boolean
  plan: {
    /** none: never planned; working: a plan is being made. */
    state: 'none' | 'working' | 'offers_ready' | 'planned' | 'failed'
    runId: string | null
    reason: string | null
    /** The plan's 15 days have begun: only a new plan helps. */
    stale: boolean
    /** The strip's first day: the plan's, else today (store time). */
    start: string
    days: HomeDay[]
    next: HomeSlot[]
  } | null
  numbers: {
    emails: number
    revenue: number | null
    opens: number
    clicks: number
    currency: string | null
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

const stepWords: Record<BuildStep | 'push', string> = {
  sections: 'Planning',
  content: 'Writing',
  copy: 'Writing',
  design: 'Designing',
  push: 'Saving draft'
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
      stepWords: status === 'working' && build ? stepWords[build.step] : null,
      reason: status === 'failed' ? (build?.reason ?? null) : null,
      buildId: build?.id ?? null,
      canCreate:
        owner &&
        !run.stale &&
        !passed &&
        (status === 'planned' || status === 'failed')
    }
  })
}

function planOf(
  run: PlanRun | null,
  owner: boolean,
  today: string
): NonNullable<HomeView['plan']> {
  const state: NonNullable<HomeView['plan']>['state'] = !run
    ? 'none'
    : run.state === 'pulse_queued' || run.state === 'plan_queued'
      ? 'working'
      : run.state
  const slots = run ? slotsOf(run, owner) : []
  const start = run?.plan && run.state === 'planned' ? run.plan.start : today
  const days = Array.from({ length: planDays }, (_, i): HomeDay => {
    const date = addDays(start, i)
    const on = slots.filter((s) => s.date === date)
    const inKlaviyo = on.find((s) => s.status === 'in_klaviyo')
    if (inKlaviyo)
      return { date, state: 'in_klaviyo', buildId: inKlaviyo.buildId }
    // A day that passed without its email has nothing more to show.
    const planned = on.find((s) => date >= today && s.status !== 'failed')
    if (planned) return { date, state: 'planned', buildId: planned.buildId }
    return { date, state: 'none', buildId: null }
  })
  const next = slots
    .filter((s) => s.date >= today && s.status !== 'in_klaviyo')
    .filter((s) => s.canCreate || s.status !== 'planned' || !owner)
    .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))
    .slice(0, nextCount)
  return {
    state,
    runId: run?.id ?? null,
    reason: run?.state === 'failed' ? run.reason : null,
    stale: run?.stale ?? false,
    start,
    days,
    next
  }
}

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
      ? known.reduce((sum, l) => sum + l.totals!.revenue!, 0)
      : null,
    opens: counted.reduce((sum, l) => sum + l.totals!.opens, 0),
    clicks: counted.reduce((sum, l) => sum + l.totals!.clicks, 0),
    currency,
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
  offers: ManagedOffers | null | undefined
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
  if (input.offers === undefined) unread.push('offers')
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

/** The workspace's top active do's and don'ts, surest first. */
export async function topLearned(
  db: Db,
  tenantId: string,
  limit = learnedCount
): Promise<HomeView['learned'] | null> {
  const { data, error } = await db
    .from('agent_memory_rules')
    .select('id,kind,rule,source,created_at')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .order('confidence', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error || !data) return null
  return data.map((r) => ({
    id: r.id,
    kind: r.kind === 'dont' ? 'dont' : 'do',
    rule: r.rule,
    source: r.source,
    at: r.created_at
  }))
}

/** The currency the workspace's Klaviyo account reports, when known. */
async function accountCurrency(db: Db, tenantId: string) {
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
    latestPlanRun(context.tenantId, context.timezone, now),
    db ? resultsReadModel(db, context.tenantId) : null,
    db ? accountCurrency(db, context.tenantId).catch(() => null) : null,
    offersPage(context).then(
      (o) => o,
      () => undefined
    ),
    db ? topLearned(db, context.tenantId).catch(() => null) : null
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
