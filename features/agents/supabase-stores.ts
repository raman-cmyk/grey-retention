import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import {
  memoryRuleSchema,
  selectRules,
  type BrandBook,
  type MemoryRule,
  type MemoryStore
} from './memory'
import type { AgentRunEntry, RunLog } from './runtime'

/**
 * Supabase-backed memory and run log (MEM-001 part 2). Pass a service-role
 * client: the tables are written only through the worker commands, and the
 * reads here include platform rules that clients never see. Until the next
 * `pnpm supabase:types`, the new tables and commands are reached through the
 * narrow typed signatures below.
 */

type Row = Record<string, unknown>
type Untyped = {
  from(table: 'agent_memory_rules' | 'brand_books'): {
    select(columns: string): {
      or(filter: string): {
        eq(
          column: string,
          value: string
        ): PromiseLike<{ data: Row[] | null; error: unknown }>
      }
      eq(
        column: string,
        value: string
      ): {
        order(
          column: string,
          opts: { ascending: boolean }
        ): {
          limit(n: number): PromiseLike<{ data: Row[] | null; error: unknown }>
        }
      }
    }
  }
  rpc(
    fn: 'record_agent_run',
    args: { run: Record<string, unknown> }
  ): PromiseLike<{ data: string | null; error: unknown }>
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const industryText = /^[a-z0-9 &/-]{1,60}$/i

function toRule(r: Row): MemoryRule | null {
  const parsed = memoryRuleSchema.safeParse({
    id: r.id,
    tenantId: r.tenant_id ?? null,
    industry: r.industry ?? null,
    kind: r.kind,
    rule: r.rule,
    why: r.why ?? '',
    appliesTo: r.applies_to ?? [],
    confidence: Number(r.confidence),
    source: r.source,
    evidenceCount: Number(r.evidence_count ?? 0),
    status: r.status,
    expiresAt: r.expires_at
      ? new Date(String(r.expires_at)).toISOString()
      : null,
    createdAt: new Date(String(r.created_at)).toISOString()
  })
  return parsed.success ? parsed.data : null
}

export class SupabaseMemoryStore implements MemoryStore {
  private readonly db: Untyped
  constructor(db: SupabaseClient<Database>) {
    this.db = db as unknown as Untyped
  }

  async rulesFor(input: Parameters<MemoryStore['rulesFor']>[0]) {
    const parts = ['and(tenant_id.is.null,industry.is.null)']
    if (input.tenantId && uuid.test(input.tenantId))
      parts.push(`tenant_id.eq.${input.tenantId}`)
    if (input.industry && industryText.test(input.industry))
      parts.push(`and(tenant_id.is.null,industry.eq."${input.industry}")`)
    const { data, error } = await this.db
      .from('agent_memory_rules')
      .select(
        'id,tenant_id,industry,kind,rule,why,applies_to,confidence,source,evidence_count,status,expires_at,created_at'
      )
      .or(parts.join(','))
      .eq('status', 'active')
    if (error || !data) return []
    // The same selection the in-memory store uses decides what agents see.
    return selectRules(
      data.map(toRule).filter((r): r is MemoryRule => r !== null),
      input
    )
  }

  async brandBook(tenantId: string): Promise<BrandBook | null> {
    if (!uuid.test(tenantId)) return null
    const { data, error } = await this.db
      .from('brand_books')
      .select('version,content')
      .eq('tenant_id', tenantId)
      .order('version', { ascending: false })
      .limit(1)
    const row = !error && data?.[0]
    if (!row) return null
    return {
      version: Number(row.version),
      content: (row.content ?? {}) as Record<string, unknown>
    }
  }
}

export class SupabaseRunLog implements RunLog {
  private readonly db: Untyped
  constructor(db: SupabaseClient<Database>) {
    this.db = db as unknown as Untyped
  }

  async record(entry: AgentRunEntry) {
    const { data, error } = await this.db.rpc('record_agent_run', {
      run: {
        tenantId: entry.tenantId,
        agent: entry.agent,
        version: entry.version,
        callerKey: entry.callerKey.slice(0, 200),
        promptDigest: entry.promptDigest,
        ruleIds: entry.ruleIds.filter((id) => uuid.test(id)),
        brandBookVersion: entry.brandBookVersion,
        provider: entry.provider,
        model: entry.model,
        costMicro: Math.max(0, Math.ceil(entry.costMicro)),
        verdict: entry.verdict,
        detail: entry.detail?.slice(0, 500) ?? null,
        output: entry.output
      }
    })
    // The run log never blocks the agent's work; a failed write is reported.
    if (error || !data) return 'unlogged'
    return data
  }
}
