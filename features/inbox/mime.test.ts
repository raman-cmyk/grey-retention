// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { sampleNewsletter } from './fake-transport'
import { maxMessageBytes, readInboxMessage, safeText } from './mime'

const enc = (s: string) => new TextEncoder().encode(s.replace(/\r?\n/g, '\r\n'))

describe('readInboxMessage', () => {
  it('reads a multipart newsletter: recipients, subject, HTML and text', async () => {
    const m = sampleNewsletter({
      slug: 'northwind',
      fromDomain: 'mail.northwind.example',
      subject: 'Spring layers',
      day: 2,
      html: true
    })
    const read = await readInboxMessage(new TextEncoder().encode(m.raw))
    expect(read).toMatchObject({
      messageId: '<sample-northwind-2@mail.northwind.example>',
      subject: 'Spring layers',
      fromAddress: 'news@mail.northwind.example',
      sentAt: '2026-11-02T15:00:00.000Z'
    })
    expect(read?.recipients[0]).toBe('capture+northwind@inbox.example')
    // Quoted-printable decoded.
    expect(read?.html).toContain('<table width="600">')
    expect(read?.text).toContain('Sample text for the Inspiration inbox')
  })

  it('decodes base64, ISO-8859-1 and encoded-word subjects', async () => {
    const raw = enc(
      [
        'From: =?UTF-8?B?Q2Fmw6k=?= <hello@cafe.example>',
        'To: capture+cafe@inbox.example',
        'Subject: =?ISO-8859-1?Q?Caf=E9_week?=',
        'Message-ID: <x1@cafe.example>',
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=ISO-8859-1',
        'Content-Transfer-Encoding: base64',
        '',
        Buffer.from('Crème brûlée', 'latin1').toString('base64'),
        ''
      ].join('\n')
    )
    const read = await readInboxMessage(raw)
    expect(read?.subject).toBe('Café week')
    expect(read?.text).toBe('Crème brûlée')
  })

  it('makes text from HTML when there is no text part, without scripts', async () => {
    const raw = enc(
      [
        'From: a@shop.example',
        'Subject: HTML only',
        'Content-Type: text/html; charset=utf-8',
        '',
        '<html><head><style>p{}</style></head><body><script>alert(1)</script><p>Hello&nbsp;there</p><p>Second</p></body></html>',
        ''
      ].join('\n')
    )
    const read = await readInboxMessage(raw)
    expect(read?.text).toBe('Hello there\n\nSecond')
    expect(read?.preview).toBe('Hello there Second')
    expect(read?.messageId).toBeNull()
  })

  it('refuses empty, oversized and non-email bytes', async () => {
    expect(await readInboxMessage(new Uint8Array())).toBeNull()
    expect(
      await readInboxMessage(new Uint8Array(maxMessageBytes + 1))
    ).toBeNull()
    expect(await readInboxMessage(enc('just some words\n'))).toBeNull()
  })

  it('stores only text the database takes: no NUL, no half emoji', async () => {
    expect(safeText('a\u0000b\u0007c\n\td', 100)).toBe('abc\n\td')
    expect(safeText('ab😀', 3)).toBe('ab')
    expect(safeText('lone \ud83d half', 100)).toBe('lone \ufffd half')
    const raw = enc(
      [
        'From: a@shop.example',
        'Subject: Sale \u0000 😀',
        'Content-Type: text/plain; charset=utf-8',
        '',
        `${'é'.repeat(9_999)}😀 and more`,
        ''
      ].join('\n')
    )
    const read = await readInboxMessage(raw)
    expect(read?.subject).toBe('Sale 😀')
    expect(read?.text).toHaveLength(9_999)
    expect(JSON.stringify(read)).not.toMatch(/\\u0000|\\ud83d"/)
  })

  it('makes text from huge hostile HTML quickly', async () => {
    const raw = enc(
      [
        'From: a@shop.example',
        'Subject: Big',
        'Content-Type: text/html; charset=utf-8',
        '',
        `<p>Hello</p>${'<style'.repeat(400_000)}`,
        ''
      ].join('\n')
    )
    const started = Date.now()
    const read = await readInboxMessage(raw)
    expect(read?.text.startsWith('Hello')).toBe(true)
    expect(Date.now() - started).toBeLessThan(3_000)
  })
})
