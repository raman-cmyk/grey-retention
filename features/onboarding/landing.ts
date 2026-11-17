import 'server-only'
import type { Route } from 'next'
import type { ClientRequestContext } from '@/features/auth/domain/types'
import { createClient } from '@/lib/supabase/server'
import { setupReadModel } from './flow'

/**
 * Where an owner lands after signing in (UI-ONBe): `/setup` while his
 * workspace goes through onboarding (it has its row, so it was made after
 * UI-ONBa) and has neither finished setup nor done every step, else Home.
 * Not when the step that is Now is Klaviyo and connecting is switched off
 * (he could do nothing there). Staff and admins always land on Home (setup
 * is the owner's); a setup that cannot be read lands on Home too. Only the
 * workspace's own row is read first: a workspace from before onboarding,
 * or one that finished, needs nothing more.
 */
export async function setupLanding(
  context: ClientRequestContext
): Promise<Route> {
  if (context.tenantRole !== 'owner') return '/home'
  try {
    const db = await createClient()
    if (!db) return '/home'
    const row = await db
      .from('onboarding_steps')
      .select('finished_at')
      .eq('tenant_id', context.tenantId)
      .maybeSingle()
    if (row.error || !row.data || row.data.finished_at) return '/home'
    const view = await setupReadModel(context)
    const flow = view.flow
    if (!flow || !flow.tracked || flow.finished || flow.allDone) return '/home'
    const now = flow.steps[flow.current]?.key
    return now === 'klaviyo' && view.keyCheck === 'off' ? '/home' : '/setup'
  } catch {
    return '/home'
  }
}
