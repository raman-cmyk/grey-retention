// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))

import {
  dateWords,
  learnedReadModel,
  learnedRows,
  learnedView,
  maxLearnedRows,
  type LearnedRow
} from './read-model'

// 10:00 in New York on Monday 16 November 2026.
const now = new Date('2026-11-16T15:00:00Z')
const context = {
  kind: 'client' as const,
  userId: 'user-1',
  tenantId: 'tenant-1',
  tenantRole: 'owner' as const,
  tenantName: 'Cedar Lane',
  tenantSlug: 'cedar-lane',
  timezone: 'America/New_York'
}

const row = (over: Partial<LearnedRow> = {}): LearnedRow => ({
  id: 'r1',
  kind: 'do',
  rule: 'Lead with one product',
  why: 'More clicks over 6 sends',
  source: 'results',
  confidence: 0.8,
  status: 'active',
  expires_at: null,
  created_at: '2026-11-10T03:00:00Z',
  pinned: false,
  revision: 2,
  ...over
})

type Call = {
  table: string
  columns?: string
  filters: unknown[][]
  orders: unknown[][]
  limit?: number
}

/** A member's client that records what it is asked for. */
function database(answer: { data: unknown; error: unknown }) {
  const calls: Call[] = []
  const db = {
    from(table: string) {
      const call: Call = { table, filters: [], orders: [] }
      calls.push(call)
      const chain = {
        select: (columns: string) => ((call.columns = columns), chain),
        eq: (...args: unknown[]) => (call.filters.push(['eq', ...args]), chain),
        or: (...args: unknown[]) => (call.filters.push(['or', ...args]), chain),
        order: (...args: unknown[]) => (call.orders.push(args), chain),
        limit: async (n: number) => ((call.limit = n), answer)
      }
      return chain
    }
  }
  return { db, calls }
}

describe('learnedRows (UI-LRNa)', () => {
  it('asks only for the workspace’s own rules the agents use, pinned first, then surest', async () => {
    const { db, calls } = database({ data: [row()], error: null })
    expect(await learnedRows(db as never, 'tenant-1', now)).toEqual([row()])
    expect(calls).toEqual([
      {
        table: 'agent_memory_rules',
        columns:
          'id,kind,rule,why,source,confidence,status,expires_at,created_at,pinned,revision',
        filters: [
          ['eq', 'tenant_id', 'tenant-1'],
          ['eq', 'status', 'active'],
          [
            'or',
            'pinned.is.true,and(confidence.gte.0.5,or(expires_at.is.null,expires_at.gt.2026-11-16T15:00:00.000Z))'
          ]
        ],
        orders: [
          ['pinned', { ascending: false }],
          ['confidence', { ascending: false }],
          ['created_at', { ascending: false }]
        ],
        limit: maxLearnedRows
      }
    ])
    // Platform and industry rules (no workspace) are never asked for.
    expect(JSON.stringify(calls)).not.toContain('is.null,industry')
  })

  it('answers null when the read fails', async () => {
    const { db } = database({ data: null, error: { code: '42501' } })
    expect(await learnedRows(db as never, 'tenant-1', now)).toBeNull()
  })
})

describe('learnedView (UI-LRNa)', () => {
  it('splits do and avoid, pinned first, then surest, then newest, in the owner’s words', () => {
    const view = learnedView({
      context,
      now,
      rows: [
        row({ id: 'do-sure', confidence: 0.9 }),
        row({
          id: 'do-new',
          confidence: 0.6,
          created_at: '2026-11-12T00:00:00Z'
        }),
        row({ id: 'do-old', confidence: 0.6, source: 'seed' }),
        row({
          id: 'do-pinned',
          confidence: 0.2,
          expires_at: '2026-11-01T00:00:00Z',
          pinned: true,
          source: 'owner_edit',
          revision: 5
        }),
        row({ id: 'avoid', kind: 'dont', source: 'inspector', why: '' })
      ]
    })
    expect(view.owner).toBe(true)
    expect(view.unread).toBe(false)
    expect(view.do.map((i) => i.id)).toEqual([
      'do-pinned',
      'do-sure',
      'do-new',
      'do-old'
    ])
    expect(view.do[0]).toEqual({
      id: 'do-pinned',
      kind: 'do',
      rule: 'Lead with one product',
      why: 'More clicks over 6 sends',
      source: 'owner_edit',
      sourceWords: 'From your edits',
      at: '2026-11-10T03:00:00.000Z',
      // 3 am in London is still 9 November in New York.
      date: '9 Nov',
      pinned: true,
      revision: 5
    })
    expect(view.do.map((i) => i.sourceWords)).toEqual([
      'From your edits',
      'From your results',
      'From your results',
      'From the starting rules'
    ])
    expect(view.avoid).toHaveLength(1)
    expect(view.avoid[0]).toMatchObject({
      id: 'avoid',
      kind: 'dont',
      sourceWords: 'From the email checks'
    })
  })

  it('leaves out rows it cannot name and rules the agents no longer use', () => {
    const view = learnedView({
      context,
      now,
      rows: [
        row({ id: 'odd-kind', kind: 'maybe' }),
        row({ id: 'odd-source', source: 'guess' }),
        row({ id: 'odd-date', created_at: 'yesterday' }),
        row({ id: 'unsure', confidence: 0.3 }),
        row({ id: 'ended', expires_at: '2026-11-15T00:00:00Z' }),
        row({ id: 'retired', status: 'retired', pinned: true }),
        row({ id: 'keep' })
      ]
    })
    expect([...view.do, ...view.avoid].map((i) => i.id)).toEqual(['keep'])
  })

  it('marks rules it could not read, and tells staff apart from the owner', () => {
    expect(learnedView({ context, now, rows: null })).toEqual({
      owner: true,
      do: [],
      avoid: [],
      unread: true
    })
    const staff = { ...context, tenantRole: 'staff' as const }
    expect(learnedView({ context: staff, now, rows: [row()] }).owner).toBe(
      false
    )
  })
})

describe('dateWords', () => {
  it('writes a short day in the store’s time, with the year only when it differs', () => {
    expect(dateWords('2026-11-10T03:00:00Z', 'America/New_York', now)).toBe(
      '9 Nov'
    )
    expect(dateWords('2025-11-10T12:00:00Z', 'Asia/Kathmandu', now)).toBe(
      '10 Nov 2025'
    )
    expect(dateWords('2026-11-10T03:00:00Z', 'Not/AZone', now)).toBe('10 Nov')
  })
})

describe('learnedReadModel (UI-LRNa)', () => {
  beforeEach(() => vi.resetAllMocks())

  it('reads the session’s workspace with the member’s own client', async () => {
    const { db, calls } = database({ data: [row()], error: null })
    mocks.createClient.mockResolvedValue(db)
    const view = await learnedReadModel(context, now)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.filters).toContainEqual(['eq', 'tenant_id', 'tenant-1'])
    expect(view.do.map((i) => i.rule)).toEqual(['Lead with one product'])
  })

  it('asks only for another workspace’s rows when signed into it (row rules refuse the rest)', async () => {
    const { db, calls } = database({ data: [], error: null })
    mocks.createClient.mockResolvedValue(db)
    await learnedReadModel({ ...context, tenantId: 'tenant-2' }, now)
    expect(calls[0]!.filters).toContainEqual(['eq', 'tenant_id', 'tenant-2'])
    expect(JSON.stringify(calls)).not.toContain('tenant-1')
  })

  it('marks a failed read and never throws for it', async () => {
    mocks.createClient.mockResolvedValue(
      database({ data: null, error: { code: '42501' } }).db
    )
    expect((await learnedReadModel(context, now)).unread).toBe(true)
    mocks.createClient.mockResolvedValue({
      from: () => {
        throw new Error('down')
      }
    })
    expect((await learnedReadModel(context, now)).unread).toBe(true)
    mocks.createClient.mockResolvedValue(null)
    expect((await learnedReadModel(context, now)).unread).toBe(true)
  })
})
