// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { industryOf } from '@/features/intelligence/classifier'
import { aliasSlug, messageKey, senderDomain } from './addresses'
import { readInboxMessage } from './mime'

/**
 * The inbox pilot (docs/inbox/PILOT.md): synthetic arrivals read the way
 * the poll worker reads them (`features/inbox/worker.ts`), to show what the
 * database gets for each case. Which brand a slug or sender domain belongs
 * to is decided in the database (`record_inbox_message`, tested in
 * `supabase/tests/inbox_capture.test.sql`). Gmail names cannot contain a
 * dash, so these inbox names are no one's real address.
 */
const inbox = { local: 'sample-inbox', domain: 'gmail.com' }

function arrival(h: {
  deliveredTo?: string
  to: string
  from: string
  id?: string
  extra?: string[]
}) {
  return new TextEncoder().encode(
    [
      ...(h.extra ?? []),
      ...(h.deliveredTo ? [`Delivered-To: ${h.deliveredTo}`] : []),
      `From: "News" <${h.from}>`,
      `To: ${h.to}`,
      'Subject: New arrivals',
      ...(h.id ? [`Message-ID: <${h.id}>`] : []),
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'New arrivals this week.',
      ''
    ].join('\r\n')
  )
}

/** What the poll worker sends `record_inbox_message` for one arrival. */
async function read(raw: Uint8Array) {
  const parsed = await readInboxMessage(raw)
  if (!parsed) throw new Error('unreadable arrival')
  return {
    aliasSlug: aliasSlug(parsed.recipients, inbox),
    fromDomain: senderDomain(parsed.fromAddress),
    messageKey: messageKey(parsed.messageId, raw)
  }
}

describe('pilot arrivals', () => {
  it('reads the +alias from Delivered-To and the From subdomain as the sender', async () => {
    const got = await read(
      arrival({
        deliveredTo: 'sample-inbox+cedar-lane@gmail.com',
        to: 'sample-inbox+cedar-lane@gmail.com',
        from: 'hello@mail.cedarlane.test',
        id: 'a1@mail.cedarlane.test'
      })
    )
    expect(got).toMatchObject({
      aliasSlug: 'cedar-lane',
      fromDomain: 'mail.cedarlane.test'
    })
  })

  it('an unknown slug is passed on as it is (the database then tries the sender)', async () => {
    const got = await read(
      arrival({
        deliveredTo: 'sample-inbox+not-a-brand@gmail.com',
        to: 'sample-inbox+not-a-brand@gmail.com',
        from: 'news@cedarlane.test',
        id: 'a2@cedarlane.test'
      })
    )
    expect(got).toMatchObject({
      aliasSlug: 'not-a-brand',
      fromDomain: 'cedarlane.test'
    })
  })

  it('no tag: no slug, so only the sender domain can match', async () => {
    const got = await read(
      arrival({
        deliveredTo: 'sample-inbox@gmail.com',
        to: 'sample-inbox@gmail.com',
        from: 'news@e.cedarlane.test',
        id: 'a3@e.cedarlane.test'
      })
    )
    expect(got).toMatchObject({
      aliasSlug: null,
      fromDomain: 'e.cedarlane.test'
    })
  })

  it('Gmail dots, capitals and googlemail.com reach the same inbox', async () => {
    const got = await read(
      arrival({
        deliveredTo: 'Sample-In.Box+Cedar-Lane@googlemail.com',
        to: 'Sample-In.Box+Cedar-Lane@googlemail.com',
        from: 'hello@cedarlane.test',
        id: 'a4@cedarlane.test'
      })
    )
    expect(got.aliasSlug).toBe('cedar-lane')
  })

  it('reads the +alias from Delivered-To when To shows the list, not us', async () => {
    const got = await read(
      arrival({
        deliveredTo: 'sample-inbox+cedar-lane@gmail.com',
        to: '"Cedar Lane" <list@cedarlane.test>',
        from: 'hello@cedarlane.test',
        id: 'a5@cedarlane.test'
      })
    )
    expect(got.aliasSlug).toBe('cedar-lane')
  })

  it('another inbox, a bad tag or a tag of the wrong length gives no slug', async () => {
    for (const to of [
      'other-inbox+cedar-lane@gmail.com',
      'sample-inbox+cedar_lane@gmail.com',
      'sample-inbox+c@gmail.com',
      `sample-inbox+${'a'.repeat(41)}@gmail.com`
    ]) {
      const got = await read(
        arrival({ to, from: 'hello@cedarlane.test', id: `${to}@x.test` })
      )
      expect(got.aliasSlug, to).toBeNull()
    }
  })

  it('a re-delivered arrival keeps its key, so it is recorded once', async () => {
    const first = await read(
      arrival({
        to: 'sample-inbox+cedar-lane@gmail.com',
        from: 'hello@cedarlane.test',
        id: 'a7@cedarlane.test'
      })
    )
    const again = await read(
      arrival({
        to: 'sample-inbox+cedar-lane@gmail.com',
        from: 'hello@cedarlane.test',
        id: 'a7@cedarlane.test',
        extra: ['Received: from relay.test by mx.test']
      })
    )
    expect(again.messageKey).toBe(first.messageKey)
  })

  it('without a Message-ID, only a byte-identical copy is the same email', async () => {
    const base = {
      to: 'sample-inbox+cedar-lane@gmail.com',
      from: 'hello@cedarlane.test'
    }
    const first = await read(arrival(base))
    const same = await read(arrival(base))
    const relayed = await read(
      arrival({ ...base, extra: ['Received: from relay.test by mx.test'] })
    )
    expect(same.messageKey).toBe(first.messageKey)
    expect(relayed.messageKey).not.toBe(first.messageKey)
  })

  it("the pilot's niche words map to their industries", () => {
    expect(
      [
        'skincare',
        'supplements',
        'jewelry',
        'pet',
        'home',
        'apparel',
        'fitness',
        'beauty tools',
        'baby',
        'kitchen'
      ].map(industryOf)
    ).toEqual([
      'skincare',
      'supplements',
      'jewelry',
      'pet',
      'home',
      'apparel',
      'fitness',
      'beauty_tools',
      'baby',
      'kitchen'
    ])
  })
})
