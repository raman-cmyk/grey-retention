import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { logger } from '@/lib/logger'
import { runFixtureJobs } from '@/features/integrations/worker'

type Db = SupabaseClient<Database>

/** Bounds for one scheduled sweep (one cron request). */
export const scheduleLimits = {
  /** Jobs claimed per workspace per visit; `runFixtureJobs` caps this at 4. */
  jobsPerTenant: 4,
  /** Workspaces visited per request. */
  maxTenants: 100,
  /** Extra visits for workspaces that still had work after their first visit. */
  maxRounds: 3,
  /** No new workspace visit starts after this much time (route allows 60 s). */
  budgetMs: 40_000,
  /** Due-job rows scanned to find workspaces with waiting work. */
  scanRows: 500,
  /** Active workspaces read for daily housekeeping. */
  activeRows: 1000
}

/**
 * Paid AI rewrites and uploaded-file imports have their own leases and resume
 * paths (the owner's result/progress page); site, catalog, history, ads
 * and reviews reads (ONB-101..105) have the onboarding readers' run. The sweep never dispatches them, so it cannot
 * start or retry anything that costs real AI money.
 */
export const separatelyDispatchedKinds = [
  'email.rewrite',
  'email.import',
  'brand.read_site',
  'brand.read_catalog',
  'brand.read_history',
  'brand.read_ads',
  'brand.read_reviews'
]

export type ScheduledRun = {
  /** Workspaces visited at least once. */
  tenants: number
  /** Jobs that succeeded. Failed attempts are recorded on the job for retry. */
  processed: number
  /** Workspace visits that stopped on an error; their jobs stay queued. */
  failed: number
  /** Workspaces not reached in this request; the next request picks them up. */
  deferred: number
  /** Passes over the workspace list that visited at least one workspace. */
  rounds: number
}

export type SchedulerOptions = {
  now?: () => number
  random?: () => number
  run?: (db: Db, tenantId: string, limit: number) => Promise<number>
  limits?: Partial<typeof scheduleLimits>
}

const excludedKinds = `(${separatelyDispatchedKinds.map((k) => `"${k}"`).join(',')})`

/**
 * Active workspaces with due or stale-leased jobs, oldest waiting work first.
 * The active filter is part of the query, so waiting work is found however
 * many workspaces exist.
 */
export async function tenantsWithDueJobs(
  db: Db,
  nowIso: string,
  scanRows = scheduleLimits.scanRows
) {
  const [due, stale] = await Promise.all([
    db
      .from('job_runs')
      .select('tenant_id, tenants!inner(status)')
      .eq('tenants.status', 'active')
      .in('status', ['queued', 'retry_wait'])
      .lt('attempt', 4)
      .lte('available_at', nowIso)
      .not('kind', 'in', excludedKinds)
      .order('available_at')
      .limit(scanRows),
    db
      .from('job_runs')
      .select('tenant_id, tenants!inner(status)')
      .eq('tenants.status', 'active')
      .in('status', ['leased', 'running'])
      .lt('lease_until', nowIso)
      .not('kind', 'in', excludedKinds)
      .order('lease_until')
      .limit(scanRows)
  ])
  if (due.error) throw due.error
  if (stale.error) throw stale.error
  return [...new Set([...due.data, ...stale.data].map((r) => r.tenant_id))]
}

function shuffle<T>(items: T[], random: () => number) {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j]!, copy[i]!]
  }
  return copy
}

/**
 * Runs queued background work for every active workspace in bounded batches.
 *
 * Safe to call repeatedly and concurrently (Vercel cron and GitHub Actions may
 * overlap, and cron delivery is at-least-once): each workspace visit is the
 * same `runFixtureJobs` path the owner buttons use, where `claim_job` locks the
 * workspace and hands out one lease per job, retries are bounded at four
 * attempts, and daily housekeeping jobs use unique idempotency keys.
 *
 * Workspaces with waiting jobs go first; the remaining active workspaces get
 * their daily health/report/standing-policy checks in random order, so no
 * workspace is starved when a request runs out of time.
 */
export async function runScheduledJobs(
  db: Db,
  options: SchedulerOptions = {}
): Promise<ScheduledRun> {
  const limits = { ...scheduleLimits, ...options.limits }
  const now = options.now ?? Date.now
  const run = options.run ?? runFixtureJobs
  const started = now()

  const active = await db
    .from('tenants')
    .select('id')
    .eq('status', 'active')
    .order('id')
    .limit(limits.activeRows)
  if (active.error) throw active.error
  const activeIds = active.data.map((row) => row.id)
  const due = await tenantsWithDueJobs(
    db,
    new Date(started).toISOString(),
    limits.scanRows
  )
  const waiting = new Set(due)
  const candidates = [
    ...due,
    ...shuffle(
      activeIds.filter((id) => !waiting.has(id)),
      options.random ?? Math.random
    )
  ]
  const queue = candidates.slice(0, limits.maxTenants)

  const visited = new Set<string>()
  let processed = 0,
    failed = 0,
    rounds = 0,
    outOfTime = false,
    pending = queue
  while (pending.length > 0 && rounds < limits.maxRounds && !outOfTime) {
    const busy: string[] = []
    let visits = 0
    for (const tenantId of pending) {
      if (now() - started >= limits.budgetMs) {
        outOfTime = true
        break
      }
      if (visits++ === 0) rounds++
      visited.add(tenantId)
      try {
        const count = await run(db, tenantId, limits.jobsPerTenant)
        processed += count
        if (count >= limits.jobsPerTenant) busy.push(tenantId)
      } catch (error) {
        failed++
        logger.warn('Scheduled job visit stopped for a workspace', {
          tenantId,
          code: (error as { code?: string }).code ?? 'worker_error'
        })
      }
    }
    pending = busy
  }
  return {
    tenants: visited.size,
    processed,
    failed,
    deferred: candidates.length - visited.size,
    rounds
  }
}
