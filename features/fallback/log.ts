import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { fallbackEntry, type FallbackEntry } from './entry'

/**
 * Where jobs write fallbacks (D16). The database log is the real one; the
 * memory log is for tests and fake-mode runs. `record` never throws: a job
 * that already fell back keeps going even if the log is unavailable or the
 * entry is broken, and can say so in its own result.
 */
export type FallbackLog = {
  record(
    entry: FallbackEntry
  ): Promise<{ ok: true; id: string } | { ok: false; code: string }>
}

/** `record_fallback` as it really is: workspace and campaign may be null. */
export type RecordFallbackRpc = (
  fn: 'record_fallback',
  args: {
    tenant: string | null
    campaign: string | null
    agent_key: string
    reason_key: string
    reason_text: string
    fallback_text: string
    tries: number
    facts: FallbackEntry['detail']
    dedupe: string
  }
) => PromiseLike<{ data: unknown; error: { code?: string } | null }>

/**
 * The log in `public.agent_fallbacks`. Pass the service-role client
 * (`createServiceClient()`), or a bare `record_fallback` caller in tests.
 */
export function databaseFallbackLog(
  db: SupabaseClient<Database> | { rpc: RecordFallbackRpc }
): FallbackLog {
  // The generated arguments say `string` for the workspace and campaign;
  // the command takes null for platform work and campaign-less emails.
  const rpc = db.rpc.bind(db) as unknown as RecordFallbackRpc
  return {
    async record(input) {
      const parsed = fallbackEntry.safeParse(input)
      if (!parsed.success) return { ok: false, code: 'invalid_entry' }
      const e = parsed.data
      try {
        const { data, error } = await rpc('record_fallback', {
          tenant: e.tenantId,
          campaign: e.campaignId,
          agent_key: e.agent,
          reason_key: e.reasonCode,
          reason_text: e.reason,
          fallback_text: e.fallback,
          tries: e.attempts,
          facts: e.detail,
          dedupe: e.dedupeKey
        })
        if (error || typeof data !== 'string')
          return { ok: false, code: error?.code ?? 'no_id' }
        return { ok: true, id: data }
      } catch {
        return { ok: false, code: 'unavailable' }
      }
    }
  }
}

/** An in-memory log that behaves like the table: one entry per problem. */
export function memoryFallbackLog() {
  const entries = new Map<
    string,
    FallbackEntry & { id: string; occurrences: number }
  >()
  let next = 0
  const log: FallbackLog & {
    entries: () => (FallbackEntry & { id: string; occurrences: number })[]
  } = {
    async record(input) {
      const parsed = fallbackEntry.safeParse(input)
      if (!parsed.success) return { ok: false, code: 'invalid_entry' }
      const e = parsed.data
      const key = `${e.tenantId ?? ''}|${e.dedupeKey}`
      const seen = entries.get(key)
      const id = seen?.id ?? `fallback-${++next}`
      // A repeat keeps its campaign, like the table.
      entries.set(key, {
        ...e,
        campaignId: seen ? seen.campaignId : e.campaignId,
        id,
        occurrences: (seen?.occurrences ?? 0) + 1
      })
      return { ok: true, id }
    },
    entries: () => [...entries.values()]
  }
  return log
}
