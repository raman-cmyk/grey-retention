import 'server-only'
import type { ClientRequestContext } from '@/features/auth/domain/types'
import { latestPlanRun } from '@/features/strategy/load'
import { planScreen } from '@/features/strategy/plan-screen'
import { createClient } from '@/lib/supabase/server'
import type { UseEmailInput } from './use-view'

/**
 * UI-USE: what "Use this design" reads, with the member's own session (RLS
 * applies): the chosen Inspiration email, only when it comes from a brand
 * this workspace follows now and has not hidden (a member of two
 * workspaces may read the other's followed emails; this page is for this
 * one), and the workspace's latest plan, as the Plan screen reads it. The
 * Create email command checks the email again under the workspace lock.
 */
export async function readUseEmail(
  context: Pick<ClientRequestContext, 'tenantId' | 'tenantRole' | 'timezone'>,
  reference: string | null
): Promise<UseEmailInput> {
  const db = await createClient()
  if (!db) return { ok: false }
  const owner = context.tenantRole === 'owner'
  const [found, run] = await Promise.all([
    reference
      ? db
          .from('competitor_emails')
          .select('id,capture_id,subject,safe_html,received_at')
          .eq('id', reference)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    latestPlanRun(context.tenantId, context.timezone)
  ])
  if (found.error || !run.ok) return { ok: false }
  const plan = planScreen(run.run, { owner: true })
  const row = found.data
  if (!row) return { ok: true, owner, email: null, plan }
  const [followed, hidden] = await Promise.all([
    db
      .from('competitor_subscriptions')
      .select('label')
      .eq('tenant_id', context.tenantId)
      .eq('capture_id', row.capture_id)
      .eq('active', true)
      .maybeSingle(),
    db
      .from('competitor_hidden')
      .select('capture_id')
      .eq('tenant_id', context.tenantId)
      .eq('capture_id', row.capture_id)
      .maybeSingle()
  ])
  if (followed.error || hidden.error) return { ok: false }
  if (!followed.data || hidden.data)
    return { ok: true, owner, email: null, plan }
  return {
    ok: true,
    owner,
    email: {
      id: row.id,
      subject: row.subject,
      from: followed.data.label,
      at: row.received_at,
      html: row.safe_html
    },
    plan
  }
}
