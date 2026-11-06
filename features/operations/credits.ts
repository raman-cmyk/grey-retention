import 'server-only'
import type { RequestContext } from '@/features/auth/domain/types'
import { createClient } from '@/lib/supabase/server'

export type WorkspaceCredits = {
  plan: string
  renewsInDays: number | null
  used: number
  included: number
  sample: true
  format: (value: number) => string
}

const DAY = 24 * 3600 * 1000

/**
 * The workspace's AI allowance from its active package cycle, for the
 * dashboard's AI credits indicator. Same numbers and the same audience
 * (owner and admin) as the budget panel on Settings. Amounts are synthetic
 * allowances, so they are always labelled sample. Null means "don't show".
 */
export async function workspaceCredits(
  context: RequestContext,
  now: Date
): Promise<WorkspaceCredits | null> {
  if (
    context.kind !== 'client' ||
    !['owner', 'admin'].includes(context.tenantRole)
  )
    return null
  const db = await createClient()
  if (!db || process.env.AUTH_MODE === 'demo') return null
  const { data, error } = await db
    .from('package_cycles')
    .select('state,allocation_micro,used_micro,reserved_micro,ends_at,snapshot')
    .eq('tenant_id', context.tenantId)
    .eq('state', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const format = (micro: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 2
    }).format(micro / 1_000_000)
  if (error || !data)
    return {
      plan: 'AI allowance',
      renewsInDays: null,
      used: Number.NaN,
      included: 0,
      sample: true,
      format
    }
  const name = (data.snapshot as { name?: unknown } | null)?.name
  const ends = Date.parse(data.ends_at)
  return {
    plan: typeof name === 'string' && name ? name : 'AI allowance',
    renewsInDays: Number.isFinite(ends) ? (ends - now.getTime()) / DAY : null,
    used: data.used_micro + data.reserved_micro,
    included: data.allocation_micro,
    sample: true,
    format
  }
}
