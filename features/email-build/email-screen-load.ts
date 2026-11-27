import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { ownerLine } from '@/features/fallback/owner-words'
import { buildReason } from './failure-words'
import type { KlaviyoState } from '@/features/results/klaviyo-state'
import type { EmailStatus } from '@/features/results/sync'
import {
  emailScreen,
  versionPreview,
  type EmailLogLine,
  type EmailScreen,
  type VersionsPanel
} from './email-screen'
import { pushRoute } from '@/features/klaviyo-push/live'
import {
  restoreRoute,
  versionsKept,
  versionsView,
  type VersionRow
} from './versions'

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
  buildId: string,
  /** The store's time zone (the session's), for Klaviyo's send times. */
  timezone = 'UTC',
  /** PICK-106: the version whose preview is shown (the page's `?version=`). */
  shown: number | null = null,
  /** PICK-106: the server's switches, for where "Use this version" would go. */
  env: Record<string, string | undefined> = process.env
): Promise<
  | { ok: true; screen: EmailScreen | null; versions?: VersionsPanel | null }
  | { ok: false }
> {
  const build = await db
    .from('email_builds')
    .select(
      'id,run_id,slot,state,step,email,klaviyo_campaign_id,sample_draft,error_code,push_key,referenceReason:progress->sections->reference->>reason'
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
  const [run, own, test, synced, kept] = await Promise.all([
    db
      .from('strategy_runs')
      .select('plan')
      .eq('tenant_id', tenantId)
      .eq('id', row.run_id)
      .maybeSingle(),
    lines(`%email-build-${row.id}%`),
    lines(`ab-test:${row.push_key}:%`),
    // PICK-99: what the results sync last read of its draft in Klaviyo.
    db
      .from('klaviyo_email_results')
      .select(
        'status,changed,design_changed,scheduled_for,send_strategy,sent_at,checked_at'
      )
      .eq('tenant_id', tenantId)
      .eq('build_id', row.id)
      .maybeSingle(),
    // PICK-106: the planned email's versions (its emails are read when shown).
    db
      .from('email_versions')
      .select('number,how,restored_from,outcome,failure,subject,created_at')
      .eq('tenant_id', tenantId)
      .eq('run_id', row.run_id)
      .eq('slot', row.slot)
      .order('number', { ascending: false })
      .limit(versionsKept)
  ])
  if (run.error || own.error || test.error) return { ok: false }
  // Not read: the page still opens, saying what it knows without it.
  const s = synced.error ? null : synced.data
  const klaviyoState: KlaviyoState | null = s
    ? {
        status: s.status as EmailStatus,
        edited: s.changed || s.design_changed,
        scheduledFor: s.scheduled_for,
        sendStrategy: s.send_strategy,
        sentAt: s.sent_at,
        checkedAt: s.checked_at
      }
    : null
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
  const versions = await versionsPanel(
    db,
    tenantId,
    row,
    kept.error || !Array.isArray(kept.data) ? [] : kept.data,
    timezone,
    shown,
    env
  )
  return {
    ok: true,
    versions,
    screen: emailScreen(
      {
        id: row.id,
        state: row.state,
        step: row.step,
        email: row.email,
        format: slotFormat(run.data?.plan ?? null, row.slot),
        klaviyoCampaignId: row.klaviyo_campaign_id,
        sampleDraft: row.sample_draft,
        reason: row.state === 'failed' ? buildReason(row.error_code) : null,
        // DST-002b: one short line of the owner's words, never more.
        referenceReason:
          typeof row.referenceReason === 'string'
            ? row.referenceReason.slice(0, 600)
            : null,
        klaviyoState,
        timezone
      },
      log
    )
  }
}

/**
 * PICK-106: the planned email's versions and the one shown, with its
 * preview (its email read only when it is not the current one, which the
 * page shows already). Where "Use this version" would put it is worked out
 * as the push would (`pushRoute`, `restoreRoute`). Not read (or none kept,
 * as for an email made before version history): no panel, and the page
 * opens as before.
 */
async function versionsPanel(
  db: SupabaseClient<Database>,
  tenantId: string,
  row: {
    id: string
    run_id: string
    slot: number
    state: string
    sample_draft: boolean
    push_key: string
    email: unknown
  },
  rows: readonly {
    number: number
    how: string
    restored_from: number | null
    outcome?: string | null
    failure?: string | null
    subject: string
    created_at: string
  }[],
  timezone: string,
  shown: number | null,
  env: Record<string, string | undefined>
): Promise<VersionsPanel | null> {
  const view = versionsView(
    rows.map((r): VersionRow => ({
      number: r.number,
      how: r.how,
      restoredFrom: r.restored_from,
      outcome: r.outcome ?? null,
      failure: r.failure ?? null,
      subject: r.subject,
      createdAt: r.created_at
    })),
    { timezone, shown }
  )
  if (!view) return null
  const pick = view.lines.find((l) => l.shown)!
  const [email, pushes] = pick.current
    ? [null, null]
    : await Promise.all([
        db
          .from('email_versions')
          .select('email')
          .eq('tenant_id', tenantId)
          .eq('run_id', row.run_id)
          .eq('slot', row.slot)
          .eq('number', pick.number)
          .maybeSingle(),
        db
          .from('klaviyo_draft_pushes')
          .select('campaign_id')
          .eq('tenant_id', tenantId)
          .eq('push_key', row.push_key)
      ])
  const preview =
    email && !email.error && email.data
      ? versionPreview(email.data.email, row.sample_draft)
      : null
  const sampleStore =
    (row.email as { sample?: unknown } | null)?.sample === true
  return {
    ...view,
    buildId: row.id,
    drafted: row.state === 'drafted',
    preview,
    route: restoreRoute({
      route: pushRoute(env, sampleStore),
      sampleDraft: row.sample_draft,
      // Unread: as if Klaviyo holds it (never offered while it may).
      pushRow:
        !pushes ||
        !!pushes.error ||
        (pushes.data ?? []).some((p) => p.campaign_id !== null)
    })
  }
}
