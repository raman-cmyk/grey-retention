import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ClientRequestContext } from '@/features/auth/domain/types'
import { validTimezone } from '@/lib/brand-time'
import type { Database } from '@/lib/supabase/database.types'
import { createClient } from '@/lib/supabase/server'
import {
  noticeKinds,
  noticeLimit,
  noticeList,
  type Notice,
  type NoticeRow
} from './view'

type Db = SupabaseClient<Database>

/**
 * PICK-107: the signed-in person's notices, read with their own client, so
 * row rules keep it to their own rows in their workspace. A read that
 * fails is marked, never thrown.
 */
export type NoticesView =
  | {
      state: 'ready'
      items: Notice[]
      unread: number
      /** The owner's email switch, as stored (off when never set). */
      emailOn: boolean
      /** Only the owner turns email on or off. */
      owner: boolean
    }
  | { state: 'unread' }
  | { state: 'demo' }

export async function readNotices(
  db: Db,
  tenantId: string,
  timezone: string
): Promise<{ items: Notice[]; unread: number; emailOn: boolean } | null> {
  const [rows, unread, settings] = await Promise.all([
    db
      .from('notifications')
      .select('id,kind,message,href,read_at,updated_at')
      .eq('tenant_id', tenantId)
      .in('kind', [...noticeKinds])
      .not('event_key', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(noticeLimit),
    unreadNotices(db, tenantId),
    db
      .from('notification_settings')
      .select('email_on')
      .eq('tenant_id', tenantId)
      .maybeSingle()
  ])
  if (rows.error || unread === null || settings.error) return null
  const list = noticeList(rows.data as NoticeRow[], validTimezone(timezone))
  // The count covers items older than the list shows, too.
  return {
    items: list.items,
    unread,
    emailOn: settings.data?.email_on === true
  }
}

/** How many of the person's notices are unread; null when not read. */
export async function unreadNotices(db: Db, tenantId: string) {
  const { count, error } = await db
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .in('kind', [...noticeKinds])
    .not('event_key', 'is', null)
    .is('read_at', null)
  return error ? null : (count ?? 0)
}

/** The Notifications page's view for the signed-in member. */
export async function noticesReadModel(
  context: Pick<ClientRequestContext, 'tenantId' | 'tenantRole' | 'timezone'>
): Promise<NoticesView> {
  if (process.env.AUTH_MODE === 'demo') return { state: 'demo' }
  const db = await createClient()
  if (!db) return { state: 'unread' }
  const read = await readNotices(db, context.tenantId, context.timezone).catch(
    () => null
  )
  if (!read) return { state: 'unread' }
  return { state: 'ready', ...read, owner: context.tenantRole === 'owner' }
}
