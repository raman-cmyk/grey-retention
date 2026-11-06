import 'server-only'
import { getServerEnvironment } from '@/lib/env/server'
import { createClient } from '@/lib/supabase/server'
import {
  canManageTeam,
  eventText,
  teamEventKinds,
  type PendingInvite,
  type TeamEvent,
  type TeamMember
} from './rules'

export type TeamPage = {
  canManage: boolean
  members: TeamMember[]
  /**
   * Open and expired invites (managers only; empty for staff); null when
   * they could not be loaded.
   */
  invites: PendingInvite[] | null
  /** Recent team changes (managers only); null when they could not load. */
  events: TeamEvent[] | null
  /** When the page was built, for "Expires in N days". */
  now: number
  state: 'ready' | 'demo' | 'no_database' | 'missing_command' | 'load_failed'
}

/** PostgREST and Postgres codes for "this database update is not applied". */
const missing = new Set(['PGRST202', 'PGRST205', '42883', '42P01'])
/** More than any workspace has; the page never loads an unbounded list. */
export const inviteLimit = 200
/** How many recent team changes the page shows. */
export const eventLimit = 20

type Db = NonNullable<Awaited<ReturnType<typeof createClient>>>

/** "Recent team changes", in plain sentences, newest first. */
async function teamEvents(
  db: Db,
  tenantId: string,
  members: TeamMember[]
): Promise<TeamEvent[] | null> {
  const log = await db
    .from('workspace_events')
    .select('id,kind,entity_id,actor_id,detail,created_at')
    .eq('tenant_id', tenantId)
    .in('kind', [...teamEventKinds])
    .order('created_at', { ascending: false })
    .limit(eventLimit)
  if (log.error) return null
  const rows = log.data ?? []
  const inviteIds = rows
    .filter((r) => r.kind.startsWith('invitation_') && r.entity_id)
    .map((r) => r.entity_id!)
  const invites = inviteIds.length
    ? await db
        .from('tenant_invites')
        .select('id,email')
        .eq('tenant_id', tenantId)
        .in('id', inviteIds)
    : { data: [], error: null }
  if (invites.error) return null
  const emails = new Map((invites.data ?? []).map((i) => [i.id, i.email]))
  const byMembership = new Map(members.map((m) => [m.id, m.name || m.email]))
  const byProfile = new Map(members.map((m) => [m.profileId, m]))
  const actor = (id: string | null) => {
    const member = id ? byProfile.get(id) : undefined
    return member
      ? member.isMe
        ? 'you'
        : member.name || member.email
      : 'someone'
  }
  return rows.flatMap((row) => {
    const detail =
      row.detail && typeof row.detail === 'object' && !Array.isArray(row.detail)
        ? (row.detail as Record<string, unknown>)
        : {}
    const text = eventText(
      row.kind,
      detail,
      (row.entity_id && byMembership.get(row.entity_id)) || 'A teammate',
      (row.entity_id && emails.get(row.entity_id)) || 'someone'
    )
    return text
      ? [{ id: row.id, text, by: actor(row.actor_id), at: row.created_at }]
      : []
  })
}

/** What one workspace's Team page shows. */
export async function teamPage(
  context: { tenantId: string; tenantRole: string },
  now = Date.now()
): Promise<TeamPage> {
  const canManage = canManageTeam(context.tenantRole)
  const base = { canManage, members: [], invites: [], events: [], now }
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
  const list: TeamMember[] = (members.data ?? []).map((m) => ({
    id: m.id,
    profileId: m.profile_id,
    name: m.name,
    email: m.email,
    role: m.role,
    status: m.status === 'inactive' ? 'inactive' : 'active',
    updatedAt: m.updated_at,
    isMe: m.is_me
  }))
  return {
    ...base,
    state: 'ready',
    events: canManage ? await teamEvents(db, context.tenantId, list) : [],
    members: list,
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
