import 'server-only'
import { createClient } from '@/lib/supabase/server'
import type { FifteenDayPlan } from './plan'
import type { Pulse } from './pulse'
import type { PlanRun } from './view'

/** The workspace's latest plan run (RLS: members read their own). */
export async function latestPlanRun(
  tenantId: string
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
  return {
    ok: true,
    run: {
      id: row.id,
      state: row.state as PlanRun['state'],
      startOn: row.start_on,
      pulse: (row.pulse as unknown as Pulse | null) ?? null,
      plan: (row.plan as unknown as FifteenDayPlan | null) ?? null
    }
  }
}
