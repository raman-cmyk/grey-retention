import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { NotificationMailer } from '@/lib/providers/notification-email'
import type { Database } from '@/lib/supabase/database.types'

type Db = SupabaseClient<Database>

/** Notices emailed per sweep at most (the rest wait for the next one). */
export const noticeEmailLimit = 100

/**
 * PICK-107: the scheduled sweep's email step. The database hands out each
 * notice once (`claim_notification_emails`: only where the owner turned
 * email on, only notices made since, a drafts notice once it is quiet for
 * an hour) and records it; each is then given to the mailer, which is the
 * fake one (nothing is sent). A claim already recorded is never claimed
 * again, so a retried or doubled sweep emails nothing twice.
 */
export async function sendNoticeEmails(
  db: Db,
  mailer: NotificationMailer,
  limit = noticeEmailLimit
) {
  const { data, error } = await db.rpc('claim_notification_emails', {
    lim: limit
  })
  if (error) throw error
  let sent = 0
  for (const notice of data ?? []) {
    await mailer.deliver({
      tenantId: notice.tenant_id,
      recipientId: notice.recipient_id,
      template: notice.kind,
      idempotencyKey: notice.notification_id
    })
    sent++
  }
  return { sent }
}
