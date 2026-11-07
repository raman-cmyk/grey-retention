import 'server-only'
import { defaultBrandPresentation } from '@/lib/branding/presentation'
import { getServerEnvironment } from '@/lib/env/server'
import { createClient } from '@/lib/supabase/server'
import {
  categories,
  statusOf,
  type Category,
  type FeatureRequest
} from './rules'

export type FeedbackPage = {
  requests: FeatureRequest[]
  /** Who answers (white-label: the product's name). */
  team: string
  /** When the page was built (for "this year" in dates). */
  now: number
  state: 'ready' | 'demo' | 'no_database' | 'missing_column' | 'load_failed'
}

const missing = new Set(['PGRST204', 'PGRST205', '42703', '42P01'])
/** More than any workspace sends; the page never loads an unbounded list. */
export const requestLimit = 200
/** Messages per request (the details plus replies), oldest first. */
export const messageLimit = 100
const isCategory = (value: unknown): value is Category =>
  categories.some((c) => c.value === value)

/** What one workspace's Feature Requests page shows. */
export async function feedbackPage(
  context: { tenantId: string; userId: string },
  now = Date.now()
): Promise<FeedbackPage> {
  const team = `${defaultBrandPresentation.productName} team`
  const empty = { requests: [], team, now }
  if (getServerEnvironment().AUTH_MODE === 'demo')
    return { ...empty, state: 'demo' }
  const db = await createClient()
  if (!db) return { ...empty, state: 'no_database' }
  const tickets = await db
    .from('support_tickets')
    .select(
      'id,subject,category,state,created_at,creator_id,support_messages(id,actor_id,body,created_at)'
    )
    .eq('tenant_id', context.tenantId)
    .eq('kind', 'feedback')
    .order('created_at', { ascending: false })
    .order('created_at', { referencedTable: 'support_messages' })
    .limit(messageLimit, { referencedTable: 'support_messages' })
    .limit(requestLimit)
  if (tickets.error)
    return {
      ...empty,
      state: missing.has(tickets.error.code) ? 'missing_column' : 'load_failed'
    }
  const rows = tickets.data ?? []
  if (rows.length === 0) return { ...empty, state: 'ready' }
  const actors = [
    ...new Set(
      rows.flatMap((r) => [
        r.creator_id,
        ...r.support_messages.map((m) => m.actor_id)
      ])
    )
  ]
  const [members, profiles] = await Promise.all([
    db
      .from('tenant_memberships')
      .select('profile_id')
      .eq('tenant_id', context.tenantId)
      .in('profile_id', actors),
    db.from('profiles').select('id,full_name').in('id', actors)
  ])
  if (members.error) return { ...empty, state: 'load_failed' }
  // Someone who is not (or no longer) in the workspace is the platform team.
  const inWorkspace = new Set((members.data ?? []).map((m) => m.profile_id))
  const names = new Map(
    (profiles.data ?? []).map((p) => [p.id, p.full_name.trim()])
  )
  const nameOf = (id: string) =>
    id === context.userId ? 'You' : names.get(id) || 'A teammate'
  return {
    team,
    now,
    state: 'ready',
    requests: rows.map((row) => {
      const [first, ...rest] = row.support_messages
      return {
        id: row.id,
        subject: row.subject,
        category: isCategory(row.category) ? row.category : null,
        status: statusOf(row.state),
        createdAt: row.created_at,
        by: nameOf(row.creator_id),
        details: first?.body ?? '',
        replies: rest.map((m) => {
          const fromTeam = !inWorkspace.has(m.actor_id)
          return {
            id: m.id,
            author: fromTeam ? team : nameOf(m.actor_id),
            fromTeam,
            body: m.body,
            createdAt: m.created_at
          }
        })
      }
    })
  }
}
