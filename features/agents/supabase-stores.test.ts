// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { SupabaseMemoryStore, SupabaseRunLog } from './supabase-stores'

const tenantId = '00000000-0000-4000-8000-000000000101'
const now = '2026-11-11T12:00:00Z'
const row = (over: Record<string, unknown> = {}) => ({
  id: '00000000-0000-4000-8000-0000000000a1',
  tenant_id: tenantId,
  industry: null,
  kind: 'dont',
  rule: 'Do not lead with a discount',
  why: 'Fewer opens',
  applies_to: [],
  confidence: '0.80',
  source: 'results',
  evidence_count: 4,
  status: 'active',
  expires_at: null,
  created_at: '2026-11-01T00:00:00+00:00',
  ...over
})

function fakeDb(rows: unknown[], books: unknown[] = []) {
  const or = vi.fn(() => ({
    eq: vi.fn(async () => ({ data: rows, error: null }))
  }))
  const limit = vi.fn(async () => ({ data: books, error: null }))
  const from = vi.fn(() => ({
    select: vi.fn(() => ({
      or,
      eq: vi.fn(() => ({ order: vi.fn(() => ({ limit })) }))
    }))
  }))
  return { db: { from } as never, or }
}

describe('SupabaseMemoryStore', () => {
  it('asks for this brand, its industry and global rules only', async () => {
    const { db, or } = fakeDb([row()])
    const rules = await new SupabaseMemoryStore(db).rulesFor({
      tenantId,
      industry: 'skincare',
      agent: 'x',
      now
    })
    expect(or).toHaveBeenCalledWith(
      `and(tenant_id.is.null,industry.is.null),tenant_id.eq.${tenantId},and(tenant_id.is.null,industry.eq."skincare")`
    )
    expect(rules).toHaveLength(1)
    expect(rules[0]).toMatchObject({
      kind: 'dont',
      confidence: 0.8,
      evidenceCount: 4
    })
  })

  it('never builds a filter from unsafe text', async () => {
    const { db, or } = fakeDb([])
    await new SupabaseMemoryStore(db).rulesFor({
      tenantId: 'x),or(true',
      industry: 'a",tenant_id.neq.0',
      agent: 'x',
      now
    })
    expect(or).toHaveBeenCalledWith('and(tenant_id.is.null,industry.is.null)')
  })

  it('drops malformed rows and applies the same selection as the in-memory store', async () => {
    const { db } = fakeDb([
      row(),
      row({ id: 'bad', kind: 'maybe' }),
      row({ id: '00000000-0000-4000-8000-0000000000a2', confidence: '0.2' })
    ])
    const rules = await new SupabaseMemoryStore(db).rulesFor({
      tenantId,
      industry: null,
      agent: 'x',
      now
    })
    expect(rules.map((r) => r.id)).toEqual([
      '00000000-0000-4000-8000-0000000000a1'
    ])
  })

  it('reads the newest Brand book', async () => {
    const { db } = fakeDb([], [{ version: 4, content: { returns: '30 days' } }])
    expect(await new SupabaseMemoryStore(db).brandBook(tenantId)).toEqual({
      version: 4,
      content: { returns: '30 days' }
    })
    expect(await new SupabaseMemoryStore(db).brandBook('not-a-uuid')).toBeNull()
  })
})

describe('SupabaseRunLog', () => {
  it('records a run through the worker command, trimming long fields', async () => {
    const rpc = vi.fn(async () => ({ data: 'run-1', error: null }))
    const id = await new SupabaseRunLog({ rpc } as never).record({
      agent: 'section-tagger',
      version: 'v1',
      tenantId: null,
      callerKey: 'k'.repeat(300),
      promptDigest: 'a'.repeat(64),
      ruleIds: ['00000000-0000-4000-8000-0000000000a1', 'not-a-uuid'],
      brandBookVersion: null,
      provider: 'gemini',
      model: 'gemini-2.5-flash-lite',
      costMicro: 57.2,
      verdict: 'ok',
      detail: 'd'.repeat(800),
      output: { family: 'hero' }
    })
    expect(id).toBe('run-1')
    const args = (rpc.mock.calls[0] as unknown[])[1] as {
      run: Record<string, unknown>
    }
    expect((rpc.mock.calls[0] as unknown[])[0]).toBe('record_agent_run')
    expect(args.run).toMatchObject({
      costMicro: 58,
      ruleIds: ['00000000-0000-4000-8000-0000000000a1']
    })
    expect(String(args.run.callerKey)).toHaveLength(200)
    expect(String(args.run.detail)).toHaveLength(500)
  })

  it('never blocks the agent when logging fails', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { code: '42501' } }))
    expect(
      await new SupabaseRunLog({ rpc } as never).record({
        agent: 'a',
        version: 'v',
        tenantId: null,
        callerKey: 'k',
        promptDigest: 'a'.repeat(64),
        ruleIds: [],
        brandBookVersion: null,
        provider: null,
        model: null,
        costMicro: 0,
        verdict: 'failed',
        detail: null,
        output: null
      })
    ).toBe('unlogged')
  })
})
