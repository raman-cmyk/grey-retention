import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { ownerLine } from './owner-words'

/** One line of the workspace's fallback log, in the owner's words (REL-084, REL-084b). */
export type WorkspaceFallback = {
  id: string
  /** Which agent or check gave up, e.g. "content-locker" (for the team, not the owner). */
  agent: string
  /** Who gave up, in the owner's words, e.g. "Choosing the email's content". */
  who: string
  /** What went wrong, in the owner's words. */
  reason: string
  /** What the team did instead. */
  instead: string
  /** How many times it happened (a repeat counts on the same line). */
  times: number
  lastSeen: string
}

/**
 * The workspace's latest fallbacks, newest first: what the team changed
 * and why (D16, REL-084). Pass the signed-in member's client: row security
 * lets active members read only their own workspace's lines. No screen
 * shows it yet; it goes where the approved design puts it.
 */
export async function workspaceFallbacks(
  db: SupabaseClient<Database>,
  tenantId: string,
  limit = 20
): Promise<{ ok: true; entries: WorkspaceFallback[] } | { ok: false }> {
  const { data, error } = await db
    .from('agent_fallbacks')
    .select('id,agent,reason_code,reason,fallback,occurrences,last_seen_at')
    .eq('tenant_id', tenantId)
    .order('last_seen_at', { ascending: false })
    .order('id')
    .limit(Math.min(Math.max(Math.trunc(limit) || 1, 1), 100))
  if (error) return { ok: false }
  return {
    ok: true,
    entries: data.map((f) => {
      const line = ownerLine({
        agent: f.agent,
        reasonCode: f.reason_code,
        reason: f.reason,
        fallback: f.fallback
      })
      return {
        id: f.id,
        agent: f.agent,
        who: line.who,
        reason: line.what,
        instead: line.instead,
        times: f.occurrences,
        lastSeen: f.last_seen_at
      }
    })
  }
}
