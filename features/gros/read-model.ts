import 'server-only'
import type { ClientRequestContext } from '@/features/auth/domain/types'
import { formatBrandDateTime } from '@/lib/brand-time'
import { createClient } from '@/lib/supabase/server'
import type { Database, Json } from '@/lib/supabase/database.types'
import { validChatId } from './params'
import { conversationReferenceChoices } from './reference-choices'

/**
 * What Ask GROS shows (UI-ASK): the chats this member may see (their own
 * private ones and the workspace's shared ones; row level security decides
 * again), the open chat with a page of up to 100 messages, its exact
 * version-bound proposals, and the campaigns and subscribed references a
 * question can name. Nothing here changes data; `grosAction` does.
 */
export type ChatItem = {
  id: string
  title: string
  shared: boolean
  /** Started by this member (only they can share it or make it private). */
  mine: boolean
}

export type ChatMessage = {
  id: string
  fromGros: boolean
  /** A member's message: written by this member. */
  byYou: boolean
  body: string
}

export type ProposalStatus = 'pending' | 'confirmed' | 'rejected' | 'expired'

export type ChatProposal = {
  id: string
  /** The command's kind: edit_goal, select_reference, schedule, cancel… */
  kind: string
  /** What it changes, in the owner's words: Goal change. */
  title: string
  status: ProposalStatus
  /** Where it stands, in the owner's words: Waiting for you. */
  state: string
  consequence: string
  /** The exact change, as it will be applied. */
  payload: string
  /** When a pending proposal ends, in the brand's timezone. */
  ends: string | null
  hash: string
  /** Only the member who asked confirms it, and only while it is pending. */
  canDecide: boolean
}

export type OpenChat = ChatItem & {
  /** Oldest first. */
  messages: ChatMessage[]
  /** The cursor of the older page, when there are older messages. */
  earlier: number | null
  /** This page ends before a cursor (Show latest messages goes back). */
  paged: boolean
  /** Newest first. */
  proposals: ChatProposal[]
}

export type AskView =
  | { kind: 'unread'; reason: string }
  | {
      kind: 'ready'
      /** Owners may also propose scheduling, cancelling and assignment. */
      owner: boolean
      chats: ChatItem[]
      /** The chat asked for, else the newest one. */
      open: OpenChat | null
      /** A chat was asked for that this member may not see. */
      missing: boolean
      campaigns: { id: string; title: string }[]
      references: { id: string; subject: string }[]
    }

type Conversation = Pick<
  Database['public']['Tables']['conversations']['Row'],
  'id' | 'title' | 'visibility' | 'creator_id'
>
type MessageRow = Pick<
  Database['public']['Tables']['chat_messages']['Row'],
  'id' | 'role' | 'actor_id' | 'body' | 'message_index'
>
type ProposalRow = Pick<
  Database['public']['Tables']['chat_proposals']['Row'],
  | 'id'
  | 'kind'
  | 'status'
  | 'consequence'
  | 'payload'
  | 'payload_hash'
  | 'expires_at'
  | 'actor_id'
>

const proposalTitles: Record<string, string> = {
  edit_goal: 'Goal change',
  select_reference: 'Reference',
  schedule: 'Scheduling',
  cancel: 'Cancellation',
  request_assignment: 'Assignment request'
}

const unreadReason =
  'We could not read your chats just now. They are safe. Try again in a minute.'

const chatItem = (c: Conversation, userId: string): ChatItem => ({
  id: c.id,
  title: c.title,
  shared: c.visibility === 'shared',
  mine: c.creator_id === userId
})

/** A proposal as the screen shows it (pure, for the tests). */
export function proposalItem(
  p: ProposalRow,
  context: Pick<ClientRequestContext, 'userId' | 'timezone'>,
  now: Date
): ChatProposal {
  const ended = Date.parse(p.expires_at) <= now.getTime()
  const status: ProposalStatus =
    p.status === 'pending' && ended
      ? 'expired'
      : ((['pending', 'confirmed', 'rejected', 'expired'] as const).find(
          (s) => s === p.status
        ) ?? 'expired')
  const mine = p.actor_id === context.userId
  const canDecide = status === 'pending' && mine
  return {
    id: p.id,
    kind: p.kind,
    title: proposalTitles[p.kind] ?? 'Change',
    status,
    state:
      status === 'pending'
        ? mine
          ? 'Waiting for you'
          : 'Waiting for the person who asked'
        : status === 'confirmed'
          ? 'Confirmed'
          : status === 'rejected'
            ? 'Rejected'
            : 'Ended',
    consequence: p.consequence,
    payload: JSON.stringify(p.payload as Json, null, 2),
    ends:
      status === 'pending'
        ? formatBrandDateTime(p.expires_at, context.timezone)
        : null,
    hash: p.payload_hash ?? '',
    canDecide
  }
}

/**
 * Reads the screen for one member. `chat` is the address's raw parameter:
 * a malformed one is a chat that is not available (never the newest chat
 * instead), and `before` (already checked) counts only with a chat.
 */
export async function askReadModel(
  context: ClientRequestContext,
  { chat, before: cursor }: { chat?: unknown; before?: number },
  now = new Date()
): Promise<AskView> {
  const asked = chat !== undefined
  const chatId = validChatId(chat)
  const before = chatId ? cursor : undefined
  const db = await createClient()
  if (!db)
    return {
      kind: 'unread',
      reason:
        'Chats need a signed-in workspace. Sign in again, then try once more.'
    }
  try {
    const tenant = context.tenantId
    const [chats, campaigns, selected, references] = await Promise.all([
      db
        .from('conversations')
        .select('id,title,visibility,creator_id')
        .eq('tenant_id', tenant)
        .order('created_at', { ascending: false })
        .limit(100),
      db
        .from('campaigns')
        .select('id,title')
        .eq('tenant_id', tenant)
        .is('superseded_by_plan', null)
        .order('planned_at')
        .limit(100),
      chatId
        ? db
            .from('conversations')
            .select('id,title,visibility,creator_id')
            .eq('tenant_id', tenant)
            .eq('id', chatId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      conversationReferenceChoices(db, tenant)
    ])
    if (chats.error || campaigns.error || selected.error || references.error)
      return { kind: 'unread', reason: unreadReason }
    const list = (chats.data ?? []) as Conversation[]
    const active = asked
      ? ((selected.data as Conversation | null) ?? null)
      : (list[0] ?? null)
    let open: OpenChat | null = null
    if (active) {
      const [messages, proposals] = await Promise.all([
        db
          .from('chat_messages')
          .select('id,role,actor_id,body,message_index')
          .eq('tenant_id', tenant)
          .eq('conversation_id', active.id)
          .lt('message_index', before ?? Number.MAX_SAFE_INTEGER)
          .order('message_index', { ascending: false })
          .limit(100),
        db
          .from('chat_proposals')
          .select(
            'id,kind,status,consequence,payload,payload_hash,expires_at,actor_id'
          )
          .eq('tenant_id', tenant)
          .eq('conversation_id', active.id)
          .order('created_at', { ascending: false })
          .limit(30)
      ])
      if (messages.error || proposals.error)
        return { kind: 'unread', reason: unreadReason }
      const page = (messages.data ?? []) as MessageRow[]
      const oldest = page.at(-1)
      open = {
        ...chatItem(active, context.userId),
        messages: page.toReversed().map((m) => ({
          id: m.id,
          fromGros: m.role === 'assistant',
          byYou: m.role !== 'assistant' && m.actor_id === context.userId,
          body: m.body
        })),
        earlier:
          oldest && oldest.message_index > 1 ? oldest.message_index : null,
        paged: before !== undefined,
        proposals: ((proposals.data ?? []) as ProposalRow[]).map((p) =>
          proposalItem(p, context, now)
        )
      }
    }
    return {
      kind: 'ready',
      owner: context.tenantRole === 'owner',
      chats: list.map((c) => chatItem(c, context.userId)),
      open,
      missing: asked && !active,
      campaigns: (campaigns.data ?? []).map((c) => ({
        id: c.id,
        title: c.title
      })),
      references: (references.data ?? []).map((r) => ({
        id: r.id,
        subject: r.subject
      }))
    }
  } catch {
    return { kind: 'unread', reason: unreadReason }
  }
}
