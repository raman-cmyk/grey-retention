import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import type { EmailStatus, StoredClick, StoredResult } from './sync'

type Db = SupabaseClient<Database>

/** One pushed email's status and results, as lane A's agents read them. */
export type EmailResult = {
  buildId: string
  runId: string
  slot: number
  sample: boolean
  campaignId: string
  /** What was planned and built: type, angle, offer, send time, audience, products. */
  planned: Record<string, unknown>
  status: EmailStatus
  /** Changed in Klaviyo outside the app (never overwritten). */
  changed: boolean
  sentAt: string | null
  /** Results reads done (three once the email is final). */
  pulls: number
  results: StoredResult[]
  clicks: StoredClick[]
  /** False when Klaviyo had more than it gave, or no orders could be read. */
  complete: boolean
  final: boolean
  /** Why the last check could not read Klaviyo, if it could not. */
  paused: string | null
  checkedAt: string | null
}

/**
 * The workspace's pushed emails, newest first, with their status and
 * results (RLS: members of the workspace, or a service-role caller).
 */
export async function listEmailResults(
  db: Db,
  tenantId: string,
  limit = 50
): Promise<EmailResult[]> {
  const { data, error } = await db
    .from('klaviyo_email_results')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(Math.max(1, Math.min(200, limit)))
  if (error) throw error
  return (data ?? []).map((r) => ({
    buildId: r.build_id,
    runId: r.run_id,
    slot: r.slot,
    sample: r.sample,
    campaignId: r.campaign_id,
    planned: r.planned as Record<string, unknown>,
    status: r.status as EmailStatus,
    changed: r.changed,
    sentAt: r.sent_at,
    pulls: r.pulls,
    results: r.results as unknown as StoredResult[],
    clicks: r.clicks as unknown as StoredClick[],
    complete: r.complete,
    final: r.final,
    paused: r.paused,
    checkedAt: r.checked_at
  }))
}
