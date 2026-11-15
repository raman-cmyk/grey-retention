import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'

/**
 * Onboarding progress (owner pick #66, ONB-066): where the workspace is on
 * the way from sign-up to its first 15-day plan, with the target of ten
 * minutes. One step per onboarding reader (ONB-101..105, each a
 * `brand.read_*` job) and the first plan (`strategy_runs`), each with its
 * state and how long it took. Data only: the progress screen waits for its
 * approved design. Times are real; nothing is guessed (ONB-034).
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
export type StepState =
  'not_started' | 'waiting' | 'working' | 'done' | 'failed'

export type ProgressStep = {
  key: StepKey
  /** Plain words for the owner. */
  label: string
  state: StepState
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
  created_at: string
  updated_at: string
}
export type PlanRow = { state: string; created_at: string; updated_at: string }

const jobState: Record<string, StepState> = {
  queued: 'waiting',
  leased: 'working',
  running: 'working',
  // Tried again on its own.
  retry_wait: 'working',
  succeeded: 'done',
  failed: 'failed',
  cancelled: 'failed'
}

const seconds = (from: string, to: number) =>
  Math.max(0, Math.round((to - Date.parse(from)) / 1000))

const newestFirst = <T extends { created_at: string }>(rows: readonly T[]) =>
  [...rows].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))

function step(
  key: StepKey,
  state: StepState,
  startedAt: string | null,
  finishedAt: string | null,
  now: number
): ProgressStep {
  return {
    key,
    label: labels[key],
    state,
    startedAt,
    finishedAt,
    seconds:
      startedAt === null
        ? null
        : seconds(startedAt, finishedAt ? Date.parse(finishedAt) : now)
  }
}

/** The progress from the rows; pure, `now` passed in. */
export function progressFrom(input: {
  signedUpAt: string
  jobs: readonly JobRow[]
  plans: readonly PlanRow[]
  now: Date
}): OnboardingProgress {
  const now = input.now.getTime()
  const steps: ProgressStep[] = (
    Object.keys(readerKinds) as (keyof typeof readerKinds)[]
  ).map((key) => {
    // The newest read of this kind says where it is.
    const job = newestFirst(
      input.jobs.filter((j) => j.kind === readerKinds[key])
    )[0]
    if (!job) return step(key, 'not_started', null, null, now)
    const state = jobState[job.status] ?? 'working'
    const finished = state === 'done' || state === 'failed'
    return step(
      key,
      state,
      job.created_at,
      finished ? job.updated_at : null,
      now
    )
  })
  const planned = [...input.plans]
    .filter((p) => p.state === 'planned')
    .sort((a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at))[0]
  const latest = newestFirst(input.plans)[0]
  if (planned)
    steps.push(
      step('plan', 'done', planned.created_at, planned.updated_at, now)
    )
  else if (!latest) steps.push(step('plan', 'not_started', null, null, now))
  else
    steps.push(
      step(
        'plan',
        latest.state === 'failed' ? 'failed' : 'working',
        latest.created_at,
        latest.state === 'failed' ? latest.updated_at : null,
        now
      )
    )
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

/**
 * The workspace's progress, read with a member's client (RLS keeps it to
 * the workspace) or the worker's; null when a read fails.
 */
export async function readOnboardingProgress(
  db: SupabaseClient<Database>,
  tenantId: string,
  now = new Date()
): Promise<OnboardingProgress | null> {
  const [tenant, jobs, plans] = await Promise.all([
    db.from('tenants').select('created_at').eq('id', tenantId).maybeSingle(),
    db
      .from('job_runs')
      .select('kind,status,created_at,updated_at')
      .eq('tenant_id', tenantId)
      .in('kind', Object.values(readerKinds))
      .order('created_at', { ascending: false })
      .limit(100),
    db
      .from('strategy_runs')
      .select('state,created_at,updated_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true })
      .limit(50)
  ])
  if (tenant.error || jobs.error || plans.error || !tenant.data) return null
  return progressFrom({
    signedUpAt: tenant.data.created_at,
    jobs: jobs.data ?? [],
    plans: plans.data ?? [],
    now
  })
}
