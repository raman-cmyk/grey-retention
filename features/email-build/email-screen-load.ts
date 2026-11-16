import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { ownerLine } from '@/features/fallback/owner-words'
import { buildReason } from './failure-words'
import {
  emailScreen,
  type EmailLogLine,
  type EmailScreen
} from './email-screen'

/** At most this many log lines a build, the newest (its steps record a few each). */
const maxLines = 20

/** The planned slot's format in a plan run's stored plan, designed when unknown. */
function slotFormat(plan: unknown, slot: number): 'designed' | 'text' {
  const slots = (plan as { slots?: unknown } | null)?.slots
  const s = Array.isArray(slots) ? (slots[slot] as { format?: unknown }) : null
  return s?.format === 'text' ? 'text' : 'designed'
}

/**
 * UI-EMAIL-a: an email's page from its build (`email_builds`), its planned
 * slot's format (`strategy_runs.plan`, for a text email not built yet) and
 * the lines its steps wrote to the fallback log (`agent_fallbacks`): those
 * keyed by the build (`email-build-<id>`, REL-084) and its push's A/B test
 * (`ab-test:<push key>:`). Pass the signed-in member's client: row security
 * lets members read only their own workspace's rows. Null when there is no
 * such build.
 */
export async function loadEmailScreen(
  db: SupabaseClient<Database>,
  tenantId: string,
  buildId: string
): Promise<{ ok: true; screen: EmailScreen | null } | { ok: false }> {
  const build = await db
    .from('email_builds')
    .select(
      'id,run_id,slot,state,step,email,klaviyo_campaign_id,sample_draft,error_code,push_key'
    )
    .eq('tenant_id', tenantId)
    .eq('id', buildId)
    .maybeSingle()
  if (build.error) return { ok: false }
  if (!build.data) return { ok: true, screen: null }
  const row = build.data
  const lines = async (pattern: string) =>
    db
      .from('agent_fallbacks')
      .select('agent,reason_code,reason,fallback,last_seen_at')
      .eq('tenant_id', tenantId)
      .like('dedupe_key', pattern)
      .order('last_seen_at', { ascending: false })
      .limit(maxLines)
  // A build id and a push key are uuids: no LIKE wildcard in either.
  const [run, own, test] = await Promise.all([
    db
      .from('strategy_runs')
      .select('plan')
      .eq('tenant_id', tenantId)
      .eq('id', row.run_id)
      .maybeSingle(),
    lines(`%email-build-${row.id}%`),
    lines(`ab-test:${row.push_key}:%`)
  ])
  if (run.error || own.error || test.error) return { ok: false }
  // The newest lines, shown oldest first.
  const log: EmailLogLine[] = [...(own.data ?? []), ...(test.data ?? [])]
    .sort((a, b) => b.last_seen_at.localeCompare(a.last_seen_at))
    .slice(0, maxLines)
    .reverse()
    .map((f) => {
      const line = ownerLine({
        agent: f.agent,
        reasonCode: f.reason_code,
        reason: f.reason,
        fallback: f.fallback
      })
      return {
        agent: f.agent,
        code: f.reason_code,
        reason: line.what,
        instead: line.instead
      }
    })
  return {
    ok: true,
    screen: emailScreen(
      {
        id: row.id,
        state: row.state,
        step: row.step,
        email: row.email,
        format: slotFormat(run.data?.plan ?? null, row.slot),
        klaviyoCampaignId: row.klaviyo_campaign_id,
        sampleDraft: row.sample_draft,
        reason: row.state === 'failed' ? buildReason(row.error_code) : null
      },
      log
    )
  }
}
