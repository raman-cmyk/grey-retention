import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { logger } from '@/lib/logger'
import { listEmailResults, type EmailResult } from '@/features/results/read'
import { numbers, resultLine } from '@/features/results/read-model'
import {
  findPatterns,
  planWrites,
  weeklyLearning,
  type LearnedRow,
  type SentEmail,
  type StoredRule
} from './patterns'
import {
  copyFallbackCodes,
  findRejections,
  rejectionDays,
  rejectionKey,
  rejectionRuleDays
} from './rejections'

type Db = SupabaseClient<Database>

/** Workspaces learned for per run, newest final result first. */
export const tenantsPerRun = 5
/** Results that turned final this recently send a workspace to learning. */
const recentMs = 2 * 86_400_000
/** Sent emails read per workspace (the newest; the window keeps 120 days). */
const emailsRead = 200

/**
 * One stored email as the analyst reads it, or null when it says too little
 * (a deleted, cancelled or never-sent draft is no send). PICK-99: one the
 * owner edited in Klaviyo is marked so, and its sections teach nothing
 * about GROS's design (they may be his).
 */
export function sentEmail(email: EmailResult): SentEmail | null {
  if (email.sample || !email.final || email.status !== 'sent' || !email.sentAt)
    return null
  const totals = numbers(email.results)
  if (!totals || totals.clickRate === null) return null
  // A design difference first seen at the send check (stored, never
  // confirmed by a second check) counts as his edit too.
  const edited = email.changed || email.designChanged || email.designEvidence
  const known = email.results.some(
    (r) => typeof r.statistics.unsubscribe_uniques === 'number'
  )
  // #76: a spam count only when Klaviyo gave one (never a made-up 0).
  const spamKnown = email.results.some(
    (r) => typeof r.statistics.spam_complaints === 'number'
  )
  return {
    buildId: email.buildId,
    emailType: resultLine(email).emailType,
    sentAt: email.sentAt,
    recipients: totals.recipients,
    clicks: totals.clicks,
    unsubscribes: known
      ? email.results.reduce(
          (n, r) => n + (Number(r.statistics.unsubscribe_uniques) || 0),
          0
        )
      : null,
    spamComplaints: spamKnown
      ? email.results.reduce(
          (n, r) => n + (Number(r.statistics.spam_complaints) || 0),
          0
        )
      : null,
    topBlock: edited ? null : (resultLine(email).topSection?.block ?? null),
    edited
  }
}

export type LearnRun = {
  added: number
  updated: number
  retired: number
  conflicts: number
}

/**
 * LRN-002 part a for one workspace: its final, real sends in the window,
 * the patterns in them, and the Memory writer's plan applied through the
 * service-only `add_memory_rule` (one rule per key, ever) and
 * `update_memory_rule` (expected revision; a rule changed meanwhile is
 * left for the next run). The rules are the workspace's own (no industry):
 * every agent named in a rule reads it through the shared memory. A failed
 * read throws; a refused write is counted, never thrown.
 */
export async function learnFromResults(
  db: Db,
  tenantId: string,
  now = Date.now()
): Promise<LearnRun> {
  const emails = (await listEmailResults(db, tenantId, emailsRead)).flatMap(
    (e) => {
      const s = sentEmail(e)
      return s ? [s] : []
    }
  )
  const { data, error } = await db
    .from('agent_memory_rules')
    .select('id,revision,idempotency_key,status,confidence,retired_by')
    .eq('tenant_id', tenantId)
    .eq('source', 'results')
    .limit(500)
  if (error) throw error
  const stored: StoredRule[] = (data ?? []).map((r) => ({
    id: r.id,
    revision: r.revision,
    key: r.idempotency_key,
    status: r.status as StoredRule['status'],
    confidence: Number(r.confidence),
    removedByOwner: r.retired_by != null
  }))
  const patterns = findPatterns(emails, now)
  const writes = planWrites({ tenantId, patterns, stored, emails, now })
  const run: LearnRun = { added: 0, updated: 0, retired: 0, conflicts: 0 }
  for (const w of writes) {
    if (w.op === 'add') {
      const added = await db.rpc('add_memory_rule', {
        r: {
          tenantId,
          industry: null,
          kind: w.pattern.kind,
          rule: w.pattern.rule,
          why: w.pattern.why,
          appliesTo: w.pattern.appliesTo,
          confidence: w.pattern.confidence,
          source: 'results',
          evidenceCount: w.pattern.evidence.length,
          evidence: w.pattern.evidence,
          expiresAt: w.expiresAt,
          idempotencyKey: w.key
        }
      })
      if (added.error) run.conflicts++
      else run.added++
      continue
    }
    const updated = await db.rpc('update_memory_rule', {
      rule_id: w.id,
      expected_revision: w.revision,
      new_status: w.status,
      new_confidence: w.confidence
    })
    if (updated.error) run.conflicts++
    else if (w.status === 'retired') run.retired++
    else run.updated++
  }
  return run
}

/** Workspaces with results that turned final lately, newest first. */
export async function workspacesToLearn(
  db: Db,
  now = Date.now()
): Promise<string[]> {
  const { data, error } = await db
    .from('klaviyo_email_results')
    .select('tenant_id,results_at')
    .eq('final', true)
    .eq('sample', false)
    .gte('results_at', new Date(now - recentMs).toISOString())
    .order('results_at', { ascending: false })
    .limit(200)
  if (error) throw error
  return [...new Set((data ?? []).map((r) => r.tenant_id))].slice(
    0,
    tenantsPerRun
  )
}

/**
 * After the hourly results sync: learn for the workspaces whose results
 * turned final lately. Code only, no model call; the same results give the
 * same rules (the writes are keyed), so running it again changes nothing.
 * Never throws.
 */
export async function learnFromRecentResults(
  db: Db,
  now = Date.now()
): Promise<{ workspaces: number; failed: number } & LearnRun> {
  const total = {
    workspaces: 0,
    failed: 0,
    added: 0,
    updated: 0,
    retired: 0,
    conflicts: 0
  }
  let tenants: string[]
  try {
    tenants = await workspacesToLearn(db, now)
  } catch (error) {
    logger.warn('Learning not run', {
      code: (error as { code?: string })?.code ?? 'learning_error'
    })
    return total
  }
  for (const t of tenants) {
    try {
      const run = await learnFromResults(db, t, now)
      total.workspaces++
      total.added += run.added
      total.updated += run.updated
      total.retired += run.retired
      total.conflicts += run.conflicts
    } catch (error) {
      total.failed++
      logger.warn('Learning failed for a workspace', {
        code: (error as { code?: string })?.code ?? 'learning_error'
      })
    }
  }
  return total
}

/**
 * Owner pick #74, data layer: what the agents learned for this workspace
 * this week (the screen waits for its design). Read with the member's own
 * client: row rules keep it to their workspace.
 */
export async function weeklyLearningFor(
  db: Db,
  tenantId: string,
  now = Date.now()
) {
  const since = new Date(now - 7 * 86_400_000).toISOString()
  const { data, error } = await db
    .from('agent_memory_rules')
    .select('kind,rule,status,created_at,updated_at,retired_by')
    .eq('tenant_id', tenantId)
    .or(`created_at.gte.${since},updated_at.gte.${since}`)
    .limit(200)
  if (error) throw error
  const rows: LearnedRow[] = (data ?? []).map((r) => ({
    kind: r.kind as LearnedRow['kind'],
    rule: r.rule,
    status: r.status as LearnedRow['status'],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    removedByOwner: r.retired_by != null
  }))
  return weeklyLearning(rows, now)
}

/**
 * LRN-002 part b for one workspace: the checks its copy kept failing
 * (`agent_fallbacks` with `detail.rules`, the last 60 days) as "don't"
 * rules for the writers, added once per check through `add_memory_rule`
 * (source `inspector`) and moved with their evidence through
 * `update_memory_rule`; they end after 90 days unless seen again. A failed
 * read throws; a refused write is counted.
 */
export async function learnFromRejections(
  db: Db,
  tenantId: string,
  now = Date.now()
): Promise<LearnRun> {
  const since = new Date(now - rejectionDays * 86_400_000).toISOString()
  const fallbacks = await db
    .from('agent_fallbacks')
    .select('id,detail,last_seen_at')
    .eq('tenant_id', tenantId)
    .in('reason_code', copyFallbackCodes)
    .gte('last_seen_at', since)
    .limit(500)
  if (fallbacks.error) throw fallbacks.error
  const found = findRejections(
    (fallbacks.data ?? []).map((f) => {
      const rules = (f.detail as { rules?: unknown } | null)?.rules
      return {
        id: f.id,
        rules: Array.isArray(rules)
          ? rules.filter((r): r is string => typeof r === 'string')
          : [],
        lastSeenAt: f.last_seen_at
      }
    }),
    now
  )
  const run: LearnRun = { added: 0, updated: 0, retired: 0, conflicts: 0 }
  if (!found.length) return run
  const stored = await db
    .from('agent_memory_rules')
    .select('id,revision,idempotency_key,status,confidence')
    .eq('tenant_id', tenantId)
    .eq('source', 'inspector')
    .limit(500)
  if (stored.error) throw stored.error
  const byKey = new Map((stored.data ?? []).map((r) => [r.idempotency_key, r]))
  for (const p of found) {
    const key = rejectionKey(tenantId, p.check)
    const rule = byKey.get(key)
    if (!rule) {
      const added = await db.rpc('add_memory_rule', {
        r: {
          tenantId,
          industry: null,
          kind: 'dont',
          rule: p.rule,
          why: p.why,
          appliesTo: p.appliesTo,
          confidence: p.confidence,
          source: 'inspector',
          evidenceCount: p.evidence.length,
          evidence: p.evidence,
          expiresAt: new Date(
            now + rejectionRuleDays * 86_400_000
          ).toISOString(),
          idempotencyKey: key
        }
      })
      if (added.error) run.conflicts++
      else run.added++
      continue
    }
    if (
      rule.status !== 'active' ||
      Math.abs(Number(rule.confidence) - p.confidence) < 0.05
    )
      continue
    const updated = await db.rpc('update_memory_rule', {
      rule_id: rule.id,
      expected_revision: rule.revision,
      new_status: 'active',
      new_confidence: p.confidence
    })
    if (updated.error) run.conflicts++
    else run.updated++
  }
  return run
}

/**
 * After a build finished: what the checks' rejections teach this
 * workspace (part b). Code only and cheap; never throws.
 */
export async function learnAfterBuild(
  db: Db,
  tenantId: string,
  now = Date.now()
) {
  try {
    return await learnFromRejections(db, tenantId, now)
  } catch (error) {
    logger.warn('Learning from rejections failed', {
      code: (error as { code?: string })?.code ?? 'learning_error'
    })
    return null
  }
}
