// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  references: vi.fn()
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))
vi.mock('./reference-choices', () => ({
  conversationReferenceChoices: mocks.references
}))

import { askReadModel, proposalItem } from './read-model'

const now = new Date('2026-11-24T15:00:00Z')
const context = {
  kind: 'client' as const,
  userId: 'user-1',
  tenantId: 'tenant-1',
  tenantRole: 'owner' as const,
  tenantName: 'Cedar Lane',
  tenantSlug: 'cedar-lane',
  timezone: 'America/New_York'
}
const chatA = '00000000-0000-4000-8000-00000000000a'
const chatB = '00000000-0000-4000-8000-00000000000b'

type Answer = { data: unknown; error: unknown }
type Call = { table: string; steps: unknown[][] }

/** A member's client that records each read and answers per table. */
function database(answers: Record<string, Answer | Answer[]>) {
  const calls: Call[] = []
  const take = (table: string) => {
    const a = answers[table]
    return Array.isArray(a) ? a.shift()! : a!
  }
  const db = {
    from(table: string) {
      const call: Call = { table, steps: [] }
      calls.push(call)
      const step =
        (name: string) =>
        (...args: unknown[]) => (call.steps.push([name, ...args]), chain)
      const chain = {
        select: step('select'),
        eq: step('eq'),
        is: step('is'),
        lt: step('lt'),
        order: step('order'),
        limit: async (n: number) => (
          call.steps.push(['limit', n]),
          take(table)
        ),
        maybeSingle: async () => (call.steps.push(['maybeSingle']), take(table))
      }
      return chain
    }
  }
  return { db, calls }
}

const conversation = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  title: `Chat ${id.slice(-1)}`,
  visibility: 'private',
  creator_id: 'user-1',
  ...over
})
const proposal = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  kind: 'edit_goal',
  status: 'pending',
  consequence: 'The goal of Winter sale changes.',
  payload: { goal: 'Bring back past buyers' },
  payload_hash: 'a'.repeat(64),
  expires_at: '2026-11-24T15:10:00Z',
  actor_id: 'user-1',
  ...over
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.references.mockResolvedValue({
    data: [{ id: 'ref-1', subject: 'Rival winter sale' }],
    error: null
  })
})

describe('askReadModel (UI-ASK)', () => {
  it('opens the newest chat when none is asked for, oldest message first', async () => {
    const { db, calls } = database({
      conversations: {
        data: [
          conversation(chatA),
          conversation(chatB, { creator_id: 'u2', visibility: 'shared' })
        ],
        error: null
      },
      campaigns: { data: [{ id: 'c1', title: 'Winter sale' }], error: null },
      chat_messages: {
        data: [
          {
            id: 'm2',
            role: 'assistant',
            actor_id: 'user-1',
            body: 'Next step: design.',
            message_index: 2
          },
          {
            id: 'm1',
            role: 'user',
            actor_id: 'user-1',
            body: 'Where is it?',
            message_index: 1
          }
        ],
        error: null
      },
      chat_proposals: { data: [proposal()], error: null }
    })
    mocks.createClient.mockResolvedValue(db)
    const view = await askReadModel(context, {}, now)
    expect(view).toMatchObject({
      kind: 'ready',
      owner: true,
      missing: false,
      chats: [
        { id: chatA, shared: false, mine: true },
        { id: chatB, shared: true, mine: false }
      ],
      campaigns: [{ id: 'c1', title: 'Winter sale' }],
      references: [{ id: 'ref-1', subject: 'Rival winter sale' }],
      open: {
        id: chatA,
        earlier: null,
        paged: false,
        messages: [
          { id: 'm1', fromGros: false, byYou: true, body: 'Where is it?' },
          { id: 'm2', fromGros: true, byYou: false }
        ],
        proposals: [{ id: 'p1', title: 'Goal change', canDecide: true }]
      }
    })
    // Every read is the workspace's own; messages are read 100 at a time.
    for (const call of calls)
      expect(call.steps).toContainEqual(['eq', 'tenant_id', 'tenant-1'])
    const messages = calls.find((c) => c.table === 'chat_messages')!
    expect(messages.steps).toContainEqual(['eq', 'conversation_id', chatA])
    expect(messages.steps).toContainEqual([
      'lt',
      'message_index',
      Number.MAX_SAFE_INTEGER
    ])
    expect(messages.steps).toContainEqual(['limit', 100])
  })

  it('pages before a cursor and offers the older page while there is one', async () => {
    const { db, calls } = database({
      conversations: [
        { data: [conversation(chatA)], error: null },
        { data: conversation(chatB, { visibility: 'shared' }), error: null }
      ],
      campaigns: { data: [], error: null },
      chat_messages: {
        data: [
          {
            id: 'm150',
            role: 'user',
            actor_id: 'u2',
            body: 'Hi',
            message_index: 150
          },
          {
            id: 'm51',
            role: 'user',
            actor_id: 'u2',
            body: 'Old',
            message_index: 51
          }
        ],
        error: null
      },
      chat_proposals: { data: [], error: null }
    })
    mocks.createClient.mockResolvedValue(db)
    const view = await askReadModel(context, { chat: chatB, before: 151 }, now)
    expect(view).toMatchObject({
      kind: 'ready',
      missing: false,
      open: {
        id: chatB,
        shared: true,
        earlier: 51,
        paged: true,
        messages: [{ id: 'm51', byYou: false }, { id: 'm150' }]
      }
    })
    const selected = calls.filter((c) => c.table === 'conversations')[1]!
    expect(selected.steps).toContainEqual(['eq', 'id', chatB])
    expect(
      calls.find((c) => c.table === 'chat_messages')!.steps
    ).toContainEqual(['lt', 'message_index', 151])
  })

  it('says a chat this member may not see is not available, and reads no messages', async () => {
    const { db, calls } = database({
      conversations: [
        { data: [conversation(chatA)], error: null },
        { data: null, error: null }
      ],
      campaigns: { data: [], error: null }
    })
    mocks.createClient.mockResolvedValue(db)
    const view = await askReadModel(context, { chat: chatB }, now)
    expect(view).toMatchObject({ kind: 'ready', missing: true, open: null })
    expect(calls.some((c) => c.table === 'chat_messages')).toBe(false)
  })

  it('never opens the newest chat for a malformed chat, and reads no chat for it', async () => {
    for (const chat of ['chat-1', [chatA], '']) {
      const { db, calls } = database({
        conversations: { data: [conversation(chatA)], error: null },
        campaigns: { data: [], error: null }
      })
      mocks.createClient.mockResolvedValue(db)
      expect(await askReadModel(context, { chat }, now)).toMatchObject({
        kind: 'ready',
        missing: true,
        open: null
      })
      expect(calls.filter((c) => c.table === 'conversations')).toHaveLength(1)
      expect(calls.some((c) => c.table === 'chat_messages')).toBe(false)
    }
  })

  it('ignores a page cursor without a chat (the newest chat opens at its latest)', async () => {
    const { db, calls } = database({
      conversations: { data: [conversation(chatA)], error: null },
      campaigns: { data: [], error: null },
      chat_messages: { data: [], error: null },
      chat_proposals: { data: [], error: null }
    })
    mocks.createClient.mockResolvedValue(db)
    expect(await askReadModel(context, { before: 51 }, now)).toMatchObject({
      missing: false,
      open: { id: chatA, paged: false }
    })
    expect(
      calls.find((c) => c.table === 'chat_messages')!.steps
    ).toContainEqual(['lt', 'message_index', Number.MAX_SAFE_INTEGER])
  })

  it('cannot read without a sign-in or when a read fails', async () => {
    mocks.createClient.mockResolvedValue(null)
    expect((await askReadModel(context, {}, now)).kind).toBe('unread')
    const { db } = database({
      conversations: { data: null, error: { code: '42501' } },
      campaigns: { data: [], error: null }
    })
    mocks.createClient.mockResolvedValue(db)
    expect(await askReadModel(context, {}, now)).toEqual({
      kind: 'unread',
      reason:
        'We could not read your chats just now. They are safe. Try again in a minute.'
    })
  })
})

describe('proposalItem (UI-ASK)', () => {
  it('lets only the member who asked decide, while it is pending', () => {
    expect(proposalItem(proposal(), context, now)).toMatchObject({
      title: 'Goal change',
      status: 'pending',
      state: 'Waiting for you',
      ends: 'Nov 24, 2026 · 10:10 AM',
      hash: 'a'.repeat(64),
      canDecide: true
    })
    expect(
      proposalItem(proposal({ actor_id: 'u2' }), context, now)
    ).toMatchObject({
      state: 'Waiting for the person who asked',
      canDecide: false
    })
  })

  it('treats a pending proposal past its end as ended', () => {
    expect(
      proposalItem(
        proposal({ expires_at: '2026-11-24T14:59:00Z' }),
        context,
        now
      )
    ).toMatchObject({
      status: 'expired',
      state: 'Ended',
      ends: null,
      canDecide: false
    })
  })

  it('names each kind and state in plain words and shows the exact change', () => {
    const confirmed = proposalItem(
      proposal({ kind: 'schedule', status: 'confirmed' }),
      context,
      now
    )
    expect(confirmed).toMatchObject({
      title: 'Scheduling',
      state: 'Confirmed',
      canDecide: false
    })
    expect(JSON.parse(confirmed.payload)).toEqual({
      goal: 'Bring back past buyers'
    })
    expect(
      proposalItem(
        proposal({ kind: 'cancel', status: 'rejected' }),
        context,
        now
      )
    ).toMatchObject({ title: 'Cancellation', state: 'Rejected' })
    expect(
      proposalItem(proposal({ payload_hash: null }), context, now).hash
    ).toBe('')
  })
})
