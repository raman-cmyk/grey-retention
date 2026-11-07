// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('./reference-choices', () => ({
  conversationReferenceChoices: async () => ({
    data: [{ id: 'r1', subject: 'Spring' }],
    error: null
  })
}))

type Answer = { data?: unknown; error: { code: string } | null; count?: number }
const db = vi.hoisted(() => ({
  on: true,
  tables: {} as Record<string, Answer>,
  /** What `.maybeSingle()` answers, when it differs from the list. */
  singles: {} as Record<string, Answer>,
  calls: [] as {
    table: string
    filters: [string, string, unknown][]
    limit?: number
  }[]
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () =>
    db.on
      ? {
          from: (table: string) => {
            const call = {
              table,
              filters: [] as [string, string, unknown][],
              limit: undefined as number | undefined
            }
            db.calls.push(call)
            const answer = () =>
              Promise.resolve(
                db.tables[table] ?? { data: [], error: null, count: 0 }
              )
            const chain: Record<string, unknown> = {}
            for (const op of ['eq', 'lt', 'is'])
              chain[op] = (column: string, value: unknown) => {
                call.filters.push([op, column, value])
                return chain
              }
            chain.select = () => chain
            chain.order = () => chain
            chain.limit = (n: number) => {
              call.limit = n
              return chain
            }
            chain.maybeSingle = () =>
              db.singles[table] ? Promise.resolve(db.singles[table]) : answer()
            chain.then = (
              ok: (v: Answer) => unknown,
              bad: (e: unknown) => unknown
            ) => answer().then(ok, bad)
            return chain
          }
        }
      : null
}))

const { grosView } = await import('./data')
const ctx = { tenantId: '00000000-0000-4000-8000-000000000101', userId: 'u1' }
const thread = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  title: `Chat ${id}`,
  visibility: 'private',
  creator_id: 'u1',
  message_count: 2,
  last_message_at: '2026-11-06T10:00:00Z',
  created_at: '2026-11-06T09:00:00Z',
  ...over
})

afterEach(() => {
  db.on = true
  db.tables = {}
  db.singles = {}
  db.calls = []
})

describe('grosView', () => {
  it('reads this workspace only, names the viewer and counts the library', async () => {
    db.tables = {
      profiles: { data: { full_name: 'Demo Owner' }, error: null },
      conversations: {
        data: [
          thread('c1'),
          thread('c2', { visibility: 'shared', creator_id: 'u2' })
        ],
        error: null
      },
      own_templates: { error: null, count: 3 },
      reference_imports: { error: null, count: 2 }
    }
    const view = await grosView(ctx)
    expect(view?.userName).toBe('Demo')
    expect(view?.templates).toBe(5)
    expect(view?.thread).toBeNull()
    expect(view?.threads.map((t) => [t.id, t.mine, t.visibility])).toEqual([
      ['c1', true, 'private'],
      ['c2', false, 'shared']
    ])
    for (const table of [
      'conversations',
      'campaigns',
      'own_templates',
      'reference_imports'
    ])
      expect(db.calls.find((c) => c.table === table)?.filters).toContainEqual([
        'eq',
        'tenant_id',
        ctx.tenantId
      ])
  })

  it('a chat this member cannot see is reported, not shown', async () => {
    db.tables = { conversations: { data: [thread('c1')], error: null } }
    db.singles = { conversations: { data: null, error: null } }
    const view = await grosView(ctx, { chatId: 'other' })
    expect(view?.unavailable).toBe(true)
    expect(view?.thread).toBeNull()
    expect(db.calls.find((c) => c.table === 'chat_messages')).toBeUndefined()
  })

  it('shows the newest 50 messages oldest first, with a link back when there are more', async () => {
    const rows = Array.from({ length: 51 }, (_, i) => ({
      id: `m${60 - i}`,
      role: i % 2 ? 'user' : 'assistant',
      body: `Message ${60 - i}`,
      message_index: 60 - i,
      created_at: '2026-11-06T10:00:00Z'
    }))
    db.tables = {
      conversations: { data: [thread('c1')], error: null },
      chat_messages: { data: rows, error: null },
      chat_proposals: {
        data: [
          {
            id: 'p1',
            kind: 'edit_goal',
            status: 'pending',
            payload: { goal: 'Sell boots' },
            payload_hash: 'a'.repeat(64),
            expires_at: '2026-11-06T10:15:00Z',
            actor_id: 'u1',
            campaign_id: 'k1',
            campaigns: { title: 'Spring launch' }
          }
        ],
        error: null
      }
    }
    const view = await grosView(ctx, { chatId: 'c1' })
    const shown = view!.thread!
    expect(shown.messages).toHaveLength(50)
    expect(shown.messages[0]?.index).toBe(11)
    expect(shown.messages.at(-1)?.index).toBe(60)
    expect(shown.earlierBefore).toBe(11)
    expect(shown.proposals[0]).toMatchObject({
      campaignTitle: 'Spring launch',
      goal: 'Sell boots',
      mine: true
    })
    const messages = db.calls.find((c) => c.table === 'chat_messages')!
    expect(messages.limit).toBe(51)
    expect(messages.filters).toContainEqual(['eq', 'conversation_id', 'c1'])
    expect(messages.filters).toContainEqual(['eq', 'tenant_id', ctx.tenantId])
  })

  it('claims nothing when it cannot read', async () => {
    db.tables = { conversations: { data: null, error: { code: 'XX000' } } }
    expect(await grosView(ctx)).toBeNull()
    db.on = false
    expect(await grosView(ctx)).toBeNull()
  })
})
