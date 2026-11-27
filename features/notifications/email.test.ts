import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  FakeNotificationMailer,
  notificationMailer
} from '@/lib/providers/notification-email'
import { sendNoticeEmails } from './email'

type Claimed = {
  notification_id: string
  tenant_id: string
  recipient_id: string
  kind: string
  message: string
  href: string
}
const notice = (n: number): Claimed => ({
  notification_id: `00000000-0000-4000-8000-0000000000a${n}`,
  tenant_id: '00000000-0000-4000-8000-000000000101',
  recipient_id: `00000000-0000-4000-8000-00000000000${n}`,
  kind: 'plan_ready',
  message: 'Your 15-day plan is ready',
  href: '/plan'
})

/**
 * A stand-in for `claim_notification_emails`: like the database, it hands
 * out notices only while the owner's switch is on, and each one once.
 */
function workspace(emailOn: boolean, waiting: Claimed[]) {
  const claimed = new Set<string>()
  const state = { emailOn }
  const rpc = vi.fn(async (name: string, args: { lim: number }) => {
    expect(name).toBe('claim_notification_emails')
    if (!state.emailOn) return { data: [], error: null }
    const due = waiting
      .filter((n) => !claimed.has(n.notification_id))
      .slice(0, args.lim)
    due.forEach((n) => claimed.add(n.notification_id))
    return { data: due, error: null }
  })
  return { db: { rpc } as never, rpc, state }
}

describe('sendNoticeEmails (PICK-107)', () => {
  it('calls the fake mailer only when the owner turned email on', async () => {
    const off = workspace(false, [notice(1), notice(2)])
    const mailer = new FakeNotificationMailer()
    const deliver = vi.spyOn(mailer, 'deliver')
    expect(await sendNoticeEmails(off.db, mailer)).toEqual({ sent: 0 })
    expect(deliver).not.toHaveBeenCalled()

    off.state.emailOn = true
    expect(await sendNoticeEmails(off.db, mailer)).toEqual({ sent: 2 })
    expect(deliver).toHaveBeenCalledTimes(2)
    expect(mailer.sent).toEqual([
      {
        tenantId: '00000000-0000-4000-8000-000000000101',
        recipientId: '00000000-0000-4000-8000-000000000001',
        template: 'plan_ready',
        idempotencyKey: '00000000-0000-4000-8000-0000000000a1'
      },
      {
        tenantId: '00000000-0000-4000-8000-000000000101',
        recipientId: '00000000-0000-4000-8000-000000000002',
        template: 'plan_ready',
        idempotencyKey: '00000000-0000-4000-8000-0000000000a2'
      }
    ])
  })

  it('emails nothing twice when the sweep runs again', async () => {
    const on = workspace(true, [notice(1)])
    const mailer = new FakeNotificationMailer()
    await sendNoticeEmails(on.db, mailer)
    expect(await sendNoticeEmails(on.db, mailer)).toEqual({ sent: 0 })
    expect(mailer.sent).toHaveLength(1)
  })

  it('asks for at most the limit, and passes a refused claim on to the sweep', async () => {
    const on = workspace(true, [notice(1), notice(2), notice(3)])
    expect(
      await sendNoticeEmails(on.db, new FakeNotificationMailer(), 2)
    ).toEqual({ sent: 2 })
    expect(on.rpc).toHaveBeenCalledWith('claim_notification_emails', { lim: 2 })
    const refused = {
      rpc: async () => ({ data: null, error: { code: '42501' } })
    } as never
    await expect(
      sendNoticeEmails(refused, new FakeNotificationMailer())
    ).rejects.toEqual({ code: '42501' })
  })
})

describe('the notification mailer', () => {
  it('is the fake one, which sends nothing and keeps one email per notice', async () => {
    const mailer = notificationMailer()
    expect(mailer).toBeInstanceOf(FakeNotificationMailer)
    const input = {
      tenantId: 't',
      recipientId: 'r',
      template: 'results_in',
      idempotencyKey: 'n1'
    }
    expect(await mailer.deliver(input)).toEqual({
      reference: 'fake-n1',
      simulated: true
    })
    await mailer.deliver(input)
    expect((mailer as FakeNotificationMailer).sent).toHaveLength(1)
  })
})
