import 'server-only'
import type { ClientRequestContext } from '@/features/auth/domain/types'
import { maxAgeDays } from '@/features/studio/reference'
import { latestPlanRun } from '@/features/strategy/load'
import { planScreen } from '@/features/strategy/plan-screen'
import { createClient } from '@/lib/supabase/server'
import type { ChosenEmail, UseEmailInput } from './use-view'

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
  reference: string | null,
  now = Date.now()
): Promise<UseEmailInput> {
  const db = await createClient()
  if (!db) return { ok: false }
  const owner = context.tenantRole === 'owner'
  const [found, run] = await Promise.all([
    reference
      ? db
          .from('competitor_emails')
          .select(
            'id,capture_id,subject,safe_html,received_at,labels_state,inbox_message_id'
          )
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
      html: row.safe_html,
      unready: unready(row, now)
    },
    plan
  }
}

/**
 * Why the build cannot follow this email yet, as the worker reads the
 * inbox (`readReferenceRows`): not tagged by the inbox (still being read),
 * or older than the build's age limit. Null: it can (the build still
 * checks its layout, heights and offer when it runs).
 */
export function unready(
  row: {
    labels_state: string | null
    inbox_message_id: string | null
    received_at: string
  },
  now: number
): ChosenEmail['unready'] {
  const at = Date.parse(row.received_at)
  if (Number.isFinite(at) && now - at > maxAgeDays * 86_400_000) return 'old'
  if (row.labels_state !== 'tagged' || !row.inbox_message_id) return 'reading'
  return null
}
