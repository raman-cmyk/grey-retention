import 'server-only'
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
  startOn: string
  /** The 15 days have begun (store time): only a new plan helps. */
  stale: boolean
  /** Checked when read back; null when missing or of a broken shape. */
  pulse: StoredPulse | null
  plan: StoredPlan | null
}

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
    .select('id,state,start_on,pulse,plan')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) return { ok: false }
  const row = data[0]
  if (!row) return { ok: true, run: null }
  const pulse = storedPulse.safeParse(row.pulse)
  const plan = storedPlan.safeParse(row.plan)
  return {
    ok: true,
    run: {
      id: row.id,
      state: (states as readonly string[]).includes(row.state)
        ? (row.state as PlanRun['state'])
        : 'failed',
      startOn: row.start_on,
      stale: row.start_on <= storeToday(timezone, now),
      pulse: pulse.success ? pulse.data : null,
      plan: plan.success ? plan.data : null
    }
  }
}
