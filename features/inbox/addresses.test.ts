// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { aliasSlug, bareAddress, messageKey, senderDomain } from './addresses'

const gmail = { local: 'sampleinbox', domain: 'gmail.com' }

describe('inbox addresses', () => {
  it('finds the brand slug in the +alias, Delivered-To first', () => {
    expect(
      aliasSlug(
        ['SampleInbox+Northwind@gmail.com', 'someone+else@gmail.com'],
        gmail
      )
    ).toBe('northwind')
    expect(
      aliasSlug(['"Newsletter" <sampleinbox+cedar-lane@gmail.com>'], gmail)
    ).toBe('cedar-lane')
  })

  it('treats Gmail dots and googlemail.com as the same inbox', () => {
    expect(aliasSlug(['sample.in.box+juniper@googlemail.com'], gmail)).toBe(
      'juniper'
    )
  })

  it('ignores other inboxes, a missing tag and odd tags', () => {
    expect(aliasSlug(['sampleinbox@gmail.com'], gmail)).toBeNull()
    expect(aliasSlug(['someoneelse+northwind@gmail.com'], gmail)).toBeNull()
    expect(aliasSlug(['sampleinbox+northwind@outlook.com'], gmail)).toBeNull()
    expect(aliasSlug(['sampleinbox+x@gmail.com'], gmail)).toBeNull()
    expect(aliasSlug(['sampleinbox+bad_slug!@gmail.com'], gmail)).toBeNull()
    expect(aliasSlug([null, undefined, 'not an address'], gmail)).toBeNull()
    expect(aliasSlug(['sampleinbox+northwind+x@gmail.com'], gmail)).toBeNull()
  })

  it('reads the sender domain only when it is a real host name', () => {
    expect(senderDomain('News <News@Mail.Northwind.Example>')).toBe(
      'mail.northwind.example'
    )
    expect(senderDomain('nobody')).toBeNull()
    expect(senderDomain('a@localhost')).toBeNull()
    expect(senderDomain(null)).toBeNull()
    expect(bareAddress('A <a@b.c>')).toBe('a@b.c')
  })

  it('keys a message by its Message-ID, or by its bytes when it has none', () => {
    const raw = new TextEncoder().encode('Subject: hi\r\n\r\nhi')
    expect(messageKey('<ABC@x.example>', raw)).toBe(
      messageKey('abc@x.example', new Uint8Array())
    )
    expect(messageKey(null, raw)).toMatch(/^[a-f0-9]{64}$/)
    expect(messageKey(null, raw)).not.toBe(messageKey('abc@x.example', raw))
  })
})
