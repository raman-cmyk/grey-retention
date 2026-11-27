/**
 * PICK-107: the email side of notifications. `NotificationMailer` has the
 * shape of the existing `NotificationPort` (V2-000,
 * features/workflow/domain/contracts.ts), kept here so lib stays free of
 * features. Only the fake exists: it keeps each email
 * in memory and sends nothing. A live provider (Resend or Postmark is still
 * the owner's open choice, ARCHITECTURE_BLUEPRINT) needs his OK and its own
 * delivery states first, so `notificationMailer` returns the fake whatever
 * `ADAPTER_MODE` says.
 */
export type SentNotice = {
  tenantId: string
  recipientId: string
  /** The notice's kind: plan_ready, drafts_ready or results_in. */
  template: string
  /** The notice's id: a provider given it twice sends once. */
  idempotencyKey: string
}

export interface NotificationMailer {
  deliver(input: SentNotice): Promise<{ reference: string; simulated: boolean }>
}

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
