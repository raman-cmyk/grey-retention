import type {
  InboundCaptureTransport,
  InboundSession
} from '@/lib/providers/inbound-capture'
import { InboundTransportError } from '@/lib/providers/inbound-capture'

export type FakeMessage = { raw: string; internalDate: string }

const crlf = (s: string) => s.replace(/\r?\n/g, '\r\n')

/** 15:00 UTC, this many days before today. */
function daysBefore(days: number) {
  const date = new Date()
  date.setUTCHours(15, 0, 0, 0)
  date.setUTCDate(date.getUTCDate() - days)
  return date
}

/**
 * A small, real-shaped sample newsletter (fictional brands, .example),
 * sent at 15:00 UTC on `day` November 2026, or `daysAgo` days before today.
 * `day` also numbers its Message-ID.
 */
export function sampleNewsletter(n: {
  slug: string | null
  fromDomain: string
  subject: string
  day: number
  daysAgo?: number
  html?: boolean
}): FakeMessage {
  const to = n.slug
    ? `capture+${n.slug}@inbox.example`
    : 'capture@inbox.example'
  const date =
    n.daysAgo === undefined
      ? new Date(Date.UTC(2026, 10, n.day, 15, 0, 0))
      : daysBefore(n.daysAgo)
  const body = n.html
    ? [
        'Content-Type: multipart/alternative; boundary="b1"',
        '',
        '--b1',
        'Content-Type: text/plain; charset=utf-8',
        '',
        `${n.subject}. Sample text for the Inspiration inbox.`,
        '--b1',
        'Content-Type: text/html; charset=utf-8',
        'Content-Transfer-Encoding: quoted-printable',
        '',
        `<table width=3D"600"><tr><td><h1>${n.subject}</h1></td></tr><tr><td><img src=3D"https://${n.fromDomain}/hero.png" width=3D"600"></td></tr></table>`,
        '--b1--'
      ]
    : [
        'Content-Type: text/plain; charset=utf-8',
        '',
        `${n.subject}. Sample text for the Inspiration inbox.`
      ]
  return {
    internalDate: date.toISOString(),
    raw: crlf(
      [
        `Delivered-To: ${to}`,
        `From: "Sample sender" <news@${n.fromDomain}>`,
        `To: ${to}`,
        `Subject: ${n.subject}`,
        `Date: ${date.toUTCString()}`,
        `Message-ID: <sample-${n.slug ?? 'none'}-${n.day}@${n.fromDomain}>`,
        'MIME-Version: 1.0',
        ...body,
        ''
      ].join('\n')
    )
  }
}

/**
 * The sample mailbox the fake transport serves by default: sent in the
 * last week, so it always falls inside a brand summary's 90 days.
 */
export const sampleMailbox: FakeMessage[] = [
  sampleNewsletter({
    slug: 'northwind',
    fromDomain: 'mail.northwind.example',
    subject: 'Spring layers are here',
    day: 2,
    daysAgo: 5,
    html: true
  }),
  sampleNewsletter({
    slug: null,
    fromDomain: 'news.cedar-lane.example',
    subject: 'Three ways to style linen',
    day: 3,
    daysAgo: 4
  }),
  sampleNewsletter({
    slug: 'juniper',
    fromDomain: 'juniper.example',
    subject: 'Our founder on slow mornings',
    day: 4,
    daysAgo: 3,
    html: true
  })
]

/**
 * The default inbox transport: sample messages from fictional brands,
 * served like an IMAP mailbox (UIDs from 1, a fixed UIDVALIDITY). Nothing
 * leaves the server.
 */
export function fakeInboundTransport(
  messages: FakeMessage[] = sampleMailbox,
  options: { uidValidity?: number; fail?: InboundTransportError } = {}
): InboundCaptureTransport & { processed: number[] } {
  const uidValidity = options.uidValidity ?? 1
  const processed: number[] = []
  const bytes = messages.map((m) => new TextEncoder().encode(m.raw))
  const session: InboundSession = {
    async list(cursor, limit) {
      const from = cursor.uidValidity === uidValidity ? cursor.lastUid : 0
      return {
        uidValidity,
        messages: messages
          .map((m, i) => ({
            uid: i + 1,
            size: bytes[i]!.byteLength,
            transportId: null,
            internalDate: m.internalDate
          }))
          .filter((m) => m.uid > from)
          .slice(0, limit)
      }
    },
    async fetchRaw(uid, maxBytes) {
      const raw = bytes[uid - 1]
      if (!raw) throw new InboundTransportError('protocol', 'message_missing')
      if (raw.byteLength > maxBytes)
        throw new InboundTransportError('too_large', 'message_too_large')
      return raw
    },
    async markProcessed(uids) {
      processed.push(...uids)
    },
    async close() {}
  }
  return {
    kind: 'fake',
    mailbox: 'fake',
    synthetic: true,
    base: { local: 'capture', domain: 'inbox.example' },
    processed,
    async open() {
      if (options.fail) throw options.fail
      return session
    }
  }
}
