import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { localDateTime } from '@/lib/local-time'

/**
 * Onboarding progress (owner pick #66, ONB-066): where the workspace is on
 * the way from sign-up to its first 15-day plan, with the target of ten
 * minutes. One step per onboarding reader (ONB-101..105, each a
 * `brand.read_*` job) and the first plan (`strategy_runs`), each with its
 * state and how long it took. Data only: the progress screen waits for its
 * approved design, and is for the workspace's members (a designer reads no
 * jobs). Times are real; nothing is guessed (ONB-034).
 *
 * A reader's step is its newest read that succeeded (a later re-read never
 * makes a finished onboarding look unfinished), else its newest read. A
 * read restarted on the same day keeps its first start time.
 */

/** Ten minutes from sign-up to the first plan. */
export const targetSeconds = 600

export const readerKinds = {
  site: 'brand.read_site',
  catalog: 'brand.read_catalog',
  history: 'brand.read_history',
  ads: 'brand.read_ads',
  reviews: 'brand.read_reviews'
} as const

export type StepKey = keyof typeof readerKinds | 'plan'
/**
 * `skipped`: finished without reading anything (no source, or not set up);
 * `needs_you`: waiting for the owner (the plan's offer choice).
 */
export type StepState =
  | 'not_started'
  | 'waiting'
  | 'working'
  | 'needs_you'
  | 'done'
  | 'skipped'
  | 'failed'

export type ProgressStep = {
  key: StepKey
  /** Plain words for the owner. */
  label: string
  state: StepState
  /** When it started; null before it starts (queued is not started). */
  startedAt: string | null
  finishedAt: string | null
  /** How long it took, or has taken so far; null before it starts. */
  seconds: number | null
}

export type OnboardingProgress = {
  signedUpAt: string
  steps: ProgressStep[]
  done: number
  /** Seconds since sign-up. */
  elapsedSeconds: number
  /** Seconds from sign-up to the first finished plan; null before it. */
  firstPlanSeconds: number | null
  /** Whether the first plan came within ten minutes; null while it still can. */
  onTarget: boolean | null
}

const labels: Record<StepKey, string> = {
  site: 'Reading your website',
  catalog: 'Reading your products',
  history: 'Reading what you sent in Klaviyo',
  ads: 'Reading your ads',
  reviews: 'Reading your reviews',
  plan: 'Your first 15-day plan'
}

export type JobRow = {
  kind: string
  status: string
  checkpoint: unknown
  created_at: string
  updated_at: string
}
export type PlanRow = {
  state: string
  start_on: string
  created_at: string
  updated_at: string
}

const jobState = new Map<string, StepState>([
  ['queued', 'waiting'],
  ['leased', 'working'],
  ['running', 'working'],
  // Tried again on its own.
  ['retry_wait', 'working'],
  ['succeeded', 'done'],
  ['failed', 'failed'],
  ['cancelled', 'failed']
])
const openPlan = new Map<string, StepState>([
  ['pulse_queued', 'working'],
  ['offers_ready', 'needs_you'],
  ['plan_queued', 'working']
])

const seconds = (from: string, to: number) =>
  Math.max(0, Math.round((to - Date.parse(from)) / 1000))

const newestFirst = <T extends { created_at: string }>(rows: readonly T[]) =>
  [...rows].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))

/** A succeeded read that read nothing: no ads to read, no reviews or comments. */
function skipped(job: JobRow) {
  const c = (job.checkpoint ?? {}) as Record<string, unknown>
  if (job.kind === readerKinds.ads) return c.state === 'skipped'
  if (job.kind === readerKinds.reviews)
    return c.reviews === 'skipped' && c.social === 'skipped'
  return false
}

function step(
  key: StepKey,
  state: StepState,
  startedAt: string | null,
  finishedAt: string | null,
  now: number
): ProgressStep {
  const started =
    state === 'waiting' || state === 'not_started' ? null : startedAt
  return {
    key,
    label: labels[key],
    state,
    startedAt: started,
    finishedAt,
    seconds:
      started === null
        ? null
        : seconds(started, finishedAt ? Date.parse(finishedAt) : now)
  }
}

/** The progress from the rows; pure, `now` and the store's `today` passed in. */
export function progressFrom(input: {
  signedUpAt: string
  jobs: readonly JobRow[]
  /** The first planned run, if any. */
  firstPlanned: PlanRow | null
  /** The newest run, if any. */
  newestPlan: PlanRow | null
  /** The store's date today (YYYY-MM-DD): a run whose days began is out of date. */
  today: string
  now: Date
}): OnboardingProgress {
  const now = input.now.getTime()
  const steps: ProgressStep[] = (
    Object.keys(readerKinds) as (keyof typeof readerKinds)[]
  ).map((key) => {
    const reads = newestFirst(
      input.jobs.filter((j) => j.kind === readerKinds[key])
    )
    const job = reads.find((j) => j.status === 'succeeded') ?? reads[0]
    if (!job) return step(key, 'not_started', null, null, now)
    const known = jobState.get(job.status) ?? 'working'
    const state = known === 'done' && skipped(job) ? 'skipped' : known
    const finished =
      state === 'done' || state === 'skipped' || state === 'failed'
    return step(
      key,
      state,
      job.created_at,
      finished ? job.updated_at : null,
      now
    )
  })
  const planned = input.firstPlanned
  const latest = input.newestPlan
  if (planned)
    steps.push(
      step('plan', 'done', planned.created_at, planned.updated_at, now)
    )
  else if (!latest) steps.push(step('plan', 'not_started', null, null, now))
  else {
    const open = openPlan.get(latest.state)
    // An open run whose 15 days began never finishes (it is started again).
    const outOfDate = open !== undefined && latest.start_on < input.today
    const state: StepState = open === undefined || outOfDate ? 'failed' : open
    steps.push(
      step(
        'plan',
        state,
        latest.created_at,
        state === 'failed' ? latest.updated_at : null,
        now
      )
    )
  }
  const elapsedSeconds = seconds(input.signedUpAt, now)
  const firstPlanSeconds = planned
    ? seconds(input.signedUpAt, Date.parse(planned.updated_at))
    : null
  return {
    signedUpAt: input.signedUpAt,
    steps,
    done: steps.filter((s) => s.state === 'done').length,
    elapsedSeconds,
    firstPlanSeconds,
    onTarget:
      firstPlanSeconds !== null
        ? firstPlanSeconds <= targetSeconds
        : elapsedSeconds > targetSeconds
          ? false
          : null
  }
}

/** Reads of one kind looked at: the newest few find its newest success. */
const readsPerKind = 20

/**
 * The workspace's progress, read with a member's client (RLS keeps it to
 * the workspace) or the worker's; null when a read fails.
 */
export async function readOnboardingProgress(
  db: SupabaseClient<Database>,
  tenantId: string,
  now = new Date()
): Promise<OnboardingProgress | null> {
  const plans = () =>
    db
      .from('strategy_runs')
      .select('state,start_on,created_at,updated_at')
      .eq('tenant_id', tenantId)
  const [tenant, firstPlanned, newestPlan, ...reads] = await Promise.all([
    db
      .from('tenants')
      .select('created_at,timezone')
      .eq('id', tenantId)
      .maybeSingle(),
    plans()
      .eq('state', 'planned')
      .order('updated_at', { ascending: true })
      .limit(1),
    plans().order('created_at', { ascending: false }).limit(1),
    ...Object.values(readerKinds).map((kind) =>
      db
        .from('job_runs')
        .select('kind,status,checkpoint,created_at,updated_at')
        .eq('tenant_id', tenantId)
        .eq('kind', kind)
        .order('created_at', { ascending: false })
        .limit(readsPerKind)
    )
  ])
  if (
    tenant.error ||
    !tenant.data ||
    firstPlanned.error ||
    newestPlan.error ||
    reads.some((r) => r.error)
  )
    return null
  let today: string
  try {
    today = localDateTime(now, tenant.data.timezone || 'UTC').slice(0, 10)
  } catch {
    today = now.toISOString().slice(0, 10)
  }
  return progressFrom({
    signedUpAt: tenant.data.created_at,
    jobs: reads.flatMap((r) => r.data ?? []),
    firstPlanned: firstPlanned.data?.[0] ?? null,
    newestPlan: newestPlan.data?.[0] ?? null,
    today,
    now
  })
}
