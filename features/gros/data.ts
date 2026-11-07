import 'server-only'
import type { ClientRequestContext } from '@/features/auth/domain/types'
import { createClient } from '@/lib/supabase/server'
import { firstName, messagePage } from './model'
import { conversationReferenceChoices } from './reference-choices'

export type GrosThreadRow = {
  id: string
  title: string
  visibility: 'private' | 'shared'
  mine: boolean
  message_count: number
  last_message_at: string | null
  created_at: string
}

export type GrosMessage = {
  id: string
  role: 'user' | 'assistant'
  body: string
  index: number
  at: string
}

export type GrosProposal = {
  id: string
  kind: string
  /** "expired" also once a pending proposal is past its 15 minutes. */
  status: string
  campaignTitle: string
  goal: string | null
  /** The reference email's subject, for "Use … as the reference". */
  referenceSubject: string | null
  /** When the campaign is planned to send, for "Schedule …". */
  plannedAt: string | null
  hash: string
  expiresAt: string
  mine: boolean
}

export type GrosView = {
  /** When the page was read, for "2 days ago". */
  now: number
  userName: string
  threads: GrosThreadRow[]
  /** The open thread; null on the new-chat screen. */
  thread:
    | (GrosThreadRow & {
        messages: GrosMessage[]
        /** The message_index of the oldest message shown, when there are older ones. */
        earlierBefore: number | null
        paged: boolean
        proposals: GrosProposal[]
      })
    | null
  /** The id was asked for but this member cannot see it (or it is gone). */
  unavailable: boolean
  campaigns: { id: string; title: string }[]
  references: { id: string; subject: string }[]
  templates: number
}

type Context = Pick<ClientRequestContext, 'tenantId' | 'userId'>

/**
 * Everything the Ask GROS screen shows, read with the member's own session
 * (row-level security: private chats only for their creator). Null when the
 * database cannot be read.
 */
export async function grosView(
  ctx: Context,
  options: { chatId?: string; before?: number } = {}
): Promise<GrosView | null> {
  const db = await createClient()
  if (!db || process.env.AUTH_MODE === 'demo') return null
  const [profile, threads, campaigns, templates, uploads, references] =
    await Promise.all([
      db
        .from('profiles')
        .select('full_name')
        .eq('id', ctx.userId)
        .maybeSingle(),
      db
        .from('conversations')
        .select(
          'id,title,visibility,creator_id,message_count,last_message_at,created_at'
        )
        .eq('tenant_id', ctx.tenantId)
        .eq('status', 'active')
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(100),
      db
        .from('campaigns')
        .select('id,title')
        .eq('tenant_id', ctx.tenantId)
        .is('superseded_by_plan', null)
        .order('planned_at')
        .limit(100),
      db
        .from('own_templates')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', ctx.tenantId),
      db
        .from('reference_imports')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', ctx.tenantId),
      conversationReferenceChoices(db, ctx.tenantId)
    ])
  if (
    threads.error ||
    campaigns.error ||
    templates.error ||
    uploads.error ||
    references.error
  )
    return null
  const rows: GrosThreadRow[] = (threads.data ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    visibility: t.visibility === 'shared' ? 'shared' : 'private',
    mine: t.creator_id === ctx.userId,
    message_count: t.message_count,
    last_message_at: t.last_message_at,
    created_at: t.created_at
  }))
  const base = {
    now: Date.now(),
    userName: firstName(profile.data?.full_name),
    threads: rows,
    campaigns: campaigns.data ?? [],
    references: references.data ?? [],
    templates: (templates.count ?? 0) + (uploads.count ?? 0)
  }
  if (!options.chatId) return { ...base, thread: null, unavailable: false }
  const open =
    rows.find((t) => t.id === options.chatId) ??
    (await (async () => {
      // An older thread beyond the 100 listed.
      const one = await db
        .from('conversations')
        .select(
          'id,title,visibility,creator_id,message_count,last_message_at,created_at'
        )
        .eq('tenant_id', ctx.tenantId)
        .eq('id', options.chatId!)
        .eq('status', 'active')
        .maybeSingle()
      return one.data
        ? ({
            ...one.data,
            visibility: one.data.visibility === 'shared' ? 'shared' : 'private',
            mine: one.data.creator_id === ctx.userId
          } as GrosThreadRow)
        : null
    })())
  if (!open) return { ...base, thread: null, unavailable: true }
  const [messages, proposals] = await Promise.all([
    db
      .from('chat_messages')
      .select('id,role,body,message_index,created_at')
      .eq('tenant_id', ctx.tenantId)
      .eq('conversation_id', open.id)
      .lt('message_index', options.before ?? Number.MAX_SAFE_INTEGER)
      .order('message_index', { ascending: false })
      .limit(messagePage + 1),
    db
      .from('chat_proposals')
      .select(
        'id,kind,status,payload,payload_hash,expires_at,actor_id,campaign_id,campaigns(title,planned_at)'
      )
      .eq('tenant_id', ctx.tenantId)
      .eq('conversation_id', open.id)
      .order('created_at', { ascending: false })
      .limit(30)
  ])
  if (messages.error || proposals.error) return null
  const page = messages.data ?? []
  const shown = page.slice(0, messagePage).reverse()
  return {
    ...base,
    unavailable: false,
    thread: {
      ...open,
      messages: shown.map((m) => ({
        id: m.id,
        role: m.role === 'user' ? 'user' : 'assistant',
        body: m.body,
        index: m.message_index,
        at: m.created_at
      })),
      earlierBefore:
        page.length > messagePage ? (shown[0]?.message_index ?? null) : null,
      paged: options.before !== undefined,
      proposals: (proposals.data ?? []).map((p) => {
        const payload = p.payload as Record<string, unknown> | null
        const joined = p.campaigns as
          | { title?: string; planned_at?: string }
          | { title?: string; planned_at?: string }[]
          | null
        const campaign = Array.isArray(joined) ? joined[0] : joined
        const emailId =
          typeof payload?.emailId === 'string' ? payload.emailId : null
        return {
          id: p.id,
          kind: p.kind,
          status:
            p.status === 'pending' && Date.parse(p.expires_at) <= base.now
              ? 'expired'
              : p.status,
          campaignTitle: campaign?.title ?? 'a campaign',
          goal: typeof payload?.goal === 'string' ? payload.goal : null,
          referenceSubject: emailId
            ? (base.references.find((r) => r.id === emailId)?.subject ?? null)
            : null,
          plannedAt: campaign?.planned_at ?? null,
          hash: p.payload_hash ?? '',
          expiresAt: p.expires_at,
          mine: p.actor_id === ctx.userId
        }
      })
    }
  }
}

/** The most recent thread this member can see, for opening /gros. */
export async function latestThreadId(ctx: Context): Promise<string | null> {
  const db = await createClient()
  if (!db || process.env.AUTH_MODE === 'demo') return null
  const { data } = await db
    .from('conversations')
    .select('id')
    .eq('tenant_id', ctx.tenantId)
    .eq('status', 'active')
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.id ?? null
}
