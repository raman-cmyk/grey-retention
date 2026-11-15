import 'server-only'
import { allSteps } from '@/features/email-build/step-names'
import { buildReason } from '@/features/email-build/failure-words'
import { planReason } from './failure-words'
import { createClient } from '@/lib/supabase/server'
import {
  storedPlan,
  storedPulse,
  type StoredPlan,
  type StoredPulse
} from './stored'

export type PlanRun = {
  id: string
  state: 'pulse_queued' | 'offers_ready' | 'plan_queued' | 'planned' | 'failed'
  /** Why it failed, in plain words (REL-084); null unless failed. */
  reason: string | null
  startOn: string
  /** The 15 days have begun (store time): only a new plan helps. */
  stale: boolean
  /** Checked when read back; null when missing or of a broken shape. */
  pulse: StoredPulse | null
  plan: StoredPlan | null
  /** "Create email" builds (EML-004 part 2), the latest per planned email. */
  builds: Record<number, EmailBuildView>
  /** Today in store time: no email is created for a day that has passed. */
  today: string
}

export type EmailBuildView = {
  id: string
  state: 'build_queued' | 'push_queued' | 'drafted' | 'failed'
  /** How far it got (REL-081): the step it runs next, or stopped at. */
  step: (typeof allSteps)[number]
  /** The draft came from the fake pusher: no Klaviyo call was made. */
  sampleDraft: boolean
  /** Why it failed, in plain words (REL-084); null unless failed. */
  reason: string | null
}

const buildStates = [
  'build_queued',
  'push_queued',
  'drafted',
  'failed'
] as const

const states = [
  'pulse_queued',
  'offers_ready',
  'plan_queued',
  'planned',
  'failed'
] as const

/** Today in the store's timezone, YYYY-MM-DD. */
export function storeToday(timezone: string, now = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(now)
  } catch {
    return now.toISOString().slice(0, 10)
  }
}

/** The workspace's latest plan run (RLS: members read their own). */
export async function latestPlanRun(
  tenantId: string,
  timezone: string,
  now = new Date()
): Promise<{ ok: true; run: PlanRun | null } | { ok: false }> {
  const db = await createClient()
  if (!db) return { ok: false }
  const { data, error } = await db
    .from('strategy_runs')
    .select('id,state,error_code,start_on,pulse,plan')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) return { ok: false }
  const row = data[0]
  if (!row) return { ok: true, run: null }
  const pulse = storedPulse.safeParse(row.pulse)
  const plan = storedPlan.safeParse(row.plan)
  const builds: Record<number, EmailBuildView> = {}
  if (row.state === 'planned') {
    const read = (columns: string) =>
      db
        .from('email_builds')
        .select(columns)
        .eq('tenant_id', tenantId)
        .eq('run_id', row.id)
        .order('created_at', { ascending: false })
    let found = await db
      .from('email_builds')
      .select('id,slot,state,step,sample_draft,error_code')
      .eq('tenant_id', tenantId)
      .eq('run_id', row.id)
      .order('created_at', { ascending: false })
    // The app can go live minutes before the migration that adds `step`
    // (REL-081, 42703 = no such column): the plan still loads, without it.
    if (found.error?.code === '42703')
      found = (await read(
        'id,slot,state,sample_draft,error_code'
      )) as unknown as typeof found
    if (found.error) return { ok: false }
    for (const b of found.data) {
      if (b.slot in builds) continue
      const state = (buildStates as readonly string[]).includes(b.state)
        ? (b.state as EmailBuildView['state'])
        : 'failed'
      builds[b.slot] = {
        id: b.id,
        state,
        step: (allSteps as readonly string[]).includes(b.step)
          ? (b.step as EmailBuildView['step'])
          : 'sections',
        sampleDraft: b.sample_draft,
        // REL-084: a failed build always says why, in plain words.
        reason: state === 'failed' ? buildReason(b.error_code) : null
      }
    }
  }
  return {
    ok: true,
    run: {
      id: row.id,
      state: (states as readonly string[]).includes(row.state)
        ? (row.state as PlanRun['state'])
        : 'failed',
      reason:
        row.state === 'failed' ||
        !(states as readonly string[]).includes(row.state)
          ? planReason(row.error_code)
          : null,
      startOn: row.start_on,
      stale: row.start_on <= storeToday(timezone, now),
      pulse: pulse.success ? pulse.data : null,
      plan: plan.success ? plan.data : null,
      builds,
      today: storeToday(timezone, now)
    }
  }
}
