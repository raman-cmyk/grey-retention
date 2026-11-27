import type { NotificationPort } from '@/features/workflow/domain/contracts'

/**
 * PICK-107: the email side of notifications, behind the existing
 * `NotificationPort` (V2-000, a type-only import). Only the fake exists: it keeps each email
 * in memory and sends nothing. A live provider (Resend or Postmark is still
 * the owner's open choice, ARCHITECTURE_BLUEPRINT) needs his OK and its own
 * delivery states first, so `notificationMailer` returns the fake whatever
 * `ADAPTER_MODE` says.
 */
/** One email: `template` is the notice's kind, `idempotencyKey` its id. */
export type SentNotice = Parameters<NotificationPort['deliver']>[0]
export type NotificationMailer = NotificationPort

export class FakeNotificationMailer implements NotificationMailer {
  readonly sent: SentNotice[] = []

  async deliver(input: SentNotice) {
    // Asked twice for one notice, it keeps one (a real provider would too).
    if (!this.sent.some((s) => s.idempotencyKey === input.idempotencyKey))
      this.sent.push({ ...input })
    return { reference: `fake-${input.idempotencyKey}`, simulated: true }
  }
}

/** The mailer the scheduled sweep uses: the fake, always (see above). */
export function notificationMailer(): NotificationMailer {
  return new FakeNotificationMailer()
}
