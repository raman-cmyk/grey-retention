import 'server-only'
import { getServerEnvironment } from '@/lib/env/server'
import { createClient } from '@/lib/supabase/server'
import { canManageTeam, type PendingInvite, type TeamMember } from './rules'

export type TeamPage = {
  canManage: boolean
  members: TeamMember[]
  /**
   * Open and expired invites (managers only; empty for staff); null when
   * they could not be loaded.
   */
  invites: PendingInvite[] | null
  /** When the page was built, for "Expires in N days". */
  now: number
  state: 'ready' | 'demo' | 'no_database' | 'missing_command' | 'load_failed'
}

/** PostgREST and Postgres codes for "this database update is not applied". */
const missing = new Set(['PGRST202', 'PGRST205', '42883', '42P01'])
/** More than any workspace has; the page never loads an unbounded list. */
export const inviteLimit = 200

/** What one workspace's Team page shows. */
export async function teamPage(
  context: { tenantId: string; tenantRole: string },
  now = Date.now()
): Promise<TeamPage> {
  const canManage = canManageTeam(context.tenantRole)
  const base = { canManage, members: [], invites: [], now }
  if (getServerEnvironment().AUTH_MODE === 'demo')
    return { ...base, state: 'demo' }
  const db = await createClient()
  if (!db) return { ...base, state: 'no_database' }
  const [members, invites] = await Promise.all([
    db.rpc('team_members', { t: context.tenantId }),
    canManage
      ? db
          .from('tenant_invites')
          .select('id,email,role,expires_at')
          .eq('tenant_id', context.tenantId)
          .is('accepted_at', null)
          .is('revoked_at', null)
          .order('created_at', { ascending: false })
          .limit(inviteLimit)
      : Promise.resolve({ data: [], error: null })
  ])
  if (members.error)
    return {
      ...base,
      state: missing.has(members.error.code) ? 'missing_command' : 'load_failed'
    }
  return {
    ...base,
    state: 'ready',
    members: (members.data ?? []).map((m) => ({
      id: m.id,
      name: m.name,
      email: m.email,
      role: m.role,
      status: m.status === 'inactive' ? 'inactive' : 'active',
      updatedAt: m.updated_at,
      isMe: m.is_me
    })),
    invites: invites.error
      ? null
      : (invites.data ?? []).map((i) => ({
          id: i.id,
          email: i.email,
          role: i.role === 'admin' ? ('admin' as const) : ('staff' as const),
          expiresAt: i.expires_at
        }))
  }
}
