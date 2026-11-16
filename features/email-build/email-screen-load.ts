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

/** At most this many log lines a build (its steps record a few each). */
const maxLines = 20

/**
 * UI-EMAIL-a: an email's page from its build (`email_builds`) and the
 * lines its steps wrote to the fallback log (`agent_fallbacks`): those
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
      'id,state,step,email,klaviyo_campaign_id,sample_draft,error_code,push_key'
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
      .order('last_seen_at', { ascending: true })
      .limit(maxLines)
  // A build id and a push key are uuids: no LIKE wildcard in either.
  const [own, test] = await Promise.all([
    lines(`%email-build-${row.id}%`),
    lines(`ab-test:${row.push_key}:%`)
  ])
  if (own.error || test.error) return { ok: false }
  const log: EmailLogLine[] = [...(own.data ?? []), ...(test.data ?? [])]
    .sort((a, b) => a.last_seen_at.localeCompare(b.last_seen_at))
    .slice(0, maxLines)
    .map((f) => {
      const line = ownerLine({
        agent: f.agent,
        reasonCode: f.reason_code,
        reason: f.reason,
        fallback: f.fallback
      })
      return { code: f.reason_code, reason: line.what, instead: line.instead }
    })
  return {
    ok: true,
    screen: emailScreen(
      {
        id: row.id,
        state: row.state,
        step: row.step,
        email: row.email,
        klaviyoCampaignId: row.klaviyo_campaign_id,
        sampleDraft: row.sample_draft,
        reason: row.state === 'failed' ? buildReason(row.error_code) : null
      },
      log
    )
  }
}
