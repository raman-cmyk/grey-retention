import { afterEach, describe, expect, it, vi } from 'vitest'
import { fileLimits } from './limits'
import { contractDate, parseEmailFile } from './parse'

// Original synthetic fixtures only (fictional .example brands).
const utf8 = (s: string) => new TextEncoder().encode(s)
const crlf = (s: string) => s.replace(/\n/g, '\r\n')
const latin1 = (s: string) =>
  Uint8Array.from([...s].map((c) => c.charCodeAt(0)))
const meta = { fileName: 'spring.eml', title: '' }

async function ok(bytes: Uint8Array, kind: 'html' | 'text' | 'eml', m = meta) {
  const result = await parseEmailFile(bytes, kind, m)
  if (!result.ok) throw new Error(`expected success, got ${result.code}`)
  return result.value
}
async function code(
  bytes: Uint8Array,
  kind: 'html' | 'text' | 'eml',
  m = meta
) {
  const result = await parseEmailFile(bytes, kind, m)
  return result.ok ? 'ok' : result.code
}

afterEach(() => vi.restoreAllMocks())

describe('HTML and text files', () => {
  it('keeps CRLF and Unicode, drops only the BOM from the decoded source', async () => {
    const source =
      '<html><head><title>Cedar Lane — spring 🌱</title></head><body>\r\n<p>Hello café</p>\r\n</body></html>'
    const value = await ok(
      new Uint8Array([0xef, 0xbb, 0xbf, ...utf8(source)]),
      'html',
      { fileName: 'x.html', title: '' }
    )
    expect(value.body).toBe(source)
    expect(value.format).toBe('html')
    expect(value.subject).toBe('Cedar Lane — spring 🌱')
    expect(value.readableText).toContain('Hello café')
  })

  it('decodes a declared single-byte charset only when the file says so', async () => {
    const bytes = latin1(
      '<meta charset="windows-1252"><p>Caf\xe9 \x93quoted\x94</p>'
    )
    expect(
      (await ok(bytes, 'html', { fileName: 'a.html', title: '' })).body
    ).toContain('Café “quoted”')
    expect(await code(latin1('<p>Caf\xe9</p>'), 'html')).toBe(
      'ambiguous_encoding'
    )
    expect(await code(latin1('Caf\xe9'), 'text')).toBe('ambiguous_encoding')
    expect(
      await code(latin1('<meta charset="x-made-up"><p>Caf\xe9</p>'), 'html')
    ).toBe('unsupported_charset')
    expect(
      await code(latin1('<meta charset="utf-8"><p>Caf\xe9</p>'), 'html')
    ).toBe('ambiguous_encoding')
  })

  it('reads UTF-16 text with a byte order mark', async () => {
    const text = 'Hello\r\nfriend'
    const bytes = new Uint8Array([
      0xff,
      0xfe,
      ...[...text].flatMap((c) => [c.charCodeAt(0), 0])
    ])
    const value = await ok(bytes, 'text', { fileName: 'note.txt', title: '' })
    expect(value.body).toBe(text)
    expect(value.subject).toBe('note')
  })

  it('keeps literal markup in a text file as text and decodes HTML without ordinary tags', async () => {
    const text = await ok(
      utf8('Use <p> and <svg onload=x> in your template.'),
      'text',
      { fileName: 't.txt', title: '' }
    )
    expect(text.format).toBe('text')
    expect(text.readableText).toBe(
      'Use <p> and <svg onload=x> in your template.'
    )
    const html = await ok(utf8('Fish &amp; chips'), 'html', {
      fileName: 'h.html',
      title: ''
    })
    expect(html.format).toBe('html')
    expect(html.readableText).toBe('Fish & chips')
  })

  it('refuses binaries, containers and saved messages misnamed as text', async () => {
    expect(
      await code(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2]), 'eml')
    ).toBe('unsupported_type')
    expect(
      await code(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]), 'html')
    ).toBe('unsupported_type')
    expect(
      await code(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), 'text')
    ).toBe('unsupported_type')
    expect(await code(utf8('abc\u0000def'), 'text')).toBe('unsupported_type')
    expect(
      await code(
        utf8(crlf('MIME-Version: 1.0\nSubject: Hi\n\n<p>x</p>\n')),
        'html'
      )
    ).toBe('rename_to_eml')
  })

  it('never cuts content: above the editor bound is an error, at the bound is kept', async () => {
    const at = `<p>${'x'.repeat(fileLimits.decodedChars - 7)}</p>`
    expect(
      (await ok(utf8(at), 'html', { fileName: 'a.html', title: '' })).body
        .length
    ).toBe(fileLimits.decodedChars)
    expect(await code(utf8(`${at}y`), 'html')).toBe('content_too_large')
    expect(
      await code(new Uint8Array(fileLimits.rawBytes + 1).fill(0x61), 'text')
    ).toBe('too_large')
    expect(await code(new Uint8Array(), 'text')).toBe('no_content')
    expect(
      await code(utf8('<img src="https://tracker.example/p.gif">'), 'html')
    ).toBe('no_content')
  })

  it('keeps hostile markup inert: original kept, preview text excludes active content, no network', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const hostile =
      '<p>Sale</p><script>fetch("https://evil.example")</script><img src="https://tracker.example/x.gif" onerror="alert(1)">'
    const value = await ok(utf8(hostile), 'html', {
      fileName: 'h.html',
      title: ''
    })
    expect(value.body).toBe(hostile)
    expect(value.readableText).toBe('Sale')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('names the email from the owner, then the file; long names are shortened with a note', async () => {
    expect(
      (await ok(utf8('Hi'), 'text', { fileName: 'n.txt', title: 'My pick' }))
        .subject
    ).toBe('My pick')
    const long = await ok(
      utf8(`<title>${'S'.repeat(300)}</title><p>x</p>`),
      'html',
      { fileName: 'a.html', title: '' }
    )
    expect(long.subject).toHaveLength(200)
    expect(long.notes).toContain('subject_shortened')
  })
})

describe('EML messages', () => {
  it('decodes folded encoded headers, sender and date as unverified metadata', async () => {
    const raw = crlf(
      'From: =?utf-8?Q?Caf=C3=A9_Cedar?= <news@cedar-lane.example>\nSubject: =?utf-8?B?U3ByaW5nIPCfjLE=?=\n =?utf-8?B?IGVkaXQ=?=\nDate: Thu, 01 Oct 2026 09:30:00 +0200\nMIME-Version: 1.0\nContent-Type: text/plain; charset=utf-8\n\nHello there\n'
    )
    const value = await ok(utf8(raw), 'eml')
    expect(value.headerSubject).toBe('Spring 🌱 edit')
    expect(value.subject).toBe('Spring 🌱 edit')
    expect(value.headerFrom).toBe('Café Cedar <news@cedar-lane.example>')
    expect(value.headerDate).toBe('2026-10-01T07:30:00.000Z')
    expect(value.format).toBe('text')
    expect(value.body.trim()).toBe('Hello there')
  })

  it('prefers HTML in multipart/alternative and notes the text version', async () => {
    const raw = crlf(
      'Subject: Alt\nMIME-Version: 1.0\nContent-Type: multipart/alternative; boundary="b1"\n\n--b1\nContent-Type: text/plain; charset=utf-8\n\nPlain version\n--b1\nContent-Type: text/html; charset=utf-8\n\n<p>Designed version</p>\n--b1--\n'
    )
    const value = await ok(utf8(raw), 'eml')
    expect(value.format).toBe('html')
    expect(value.body).toContain('<p>Designed version</p>')
    expect(value.notes).toContain('text_part_available')
  })

  it('decodes quoted-printable latin-1 and base64 UTF-8 bodies', async () => {
    const qp = crlf(
      'Subject: QP\nContent-Type: text/html; charset=iso-8859-1\nContent-Transfer-Encoding: quoted-printable\n\n<p>Caf=E9 sale =\nends soon</p>\n'
    )
    expect((await ok(utf8(qp), 'eml')).body).toContain(
      '<p>Café sale ends soon</p>'
    )
    const b64 = crlf(
      `Subject: B64\nContent-Type: text/plain; charset=utf-8\nContent-Transfer-Encoding: base64\n\n${Buffer.from('Grüße aus Köln').toString('base64')}\n`
    )
    expect((await ok(utf8(b64), 'eml')).body.trim()).toBe('Grüße aus Köln')
  })

  it('handles nested structure: attachments counted and kept, inline CID images as placeholders, forwards not inlined', async () => {
    const raw = crlf(
      [
        'Subject: Nested',
        'MIME-Version: 1.0',
        'Content-Type: multipart/mixed; boundary="m"',
        '',
        '--m',
        'Content-Type: multipart/related; boundary="r"',
        '',
        '--r',
        'Content-Type: multipart/alternative; boundary="a"',
        '',
        '--a',
        'Content-Type: text/plain',
        '',
        'plain',
        '--a',
        'Content-Type: text/html',
        '',
        '<p>Look <img src="cid:hero@cedar.example"></p>',
        '--a--',
        '--r',
        'Content-Type: image/png',
        'Content-ID: <hero@cedar.example>',
        'Content-Transfer-Encoding: base64',
        '',
        'iVBORw0KGgo=',
        '--r--',
        '--m',
        'Content-Type: application/pdf',
        'Content-Disposition: attachment; filename="terms.pdf"',
        'Content-Transfer-Encoding: base64',
        '',
        'JVBERi0xLjQ=',
        '--m',
        'Content-Type: message/rfc822',
        '',
        'Subject: Forwarded',
        'Content-Type: text/html',
        '',
        '<p>forwarded body</p>',
        '--m--',
        ''
      ].join('\n')
    )
    const value = await ok(utf8(raw), 'eml')
    expect(value.format).toBe('html')
    expect(value.body).toContain('cid:hero@cedar.example')
    expect(value.body).not.toContain('forwarded body')
    expect(value.attachmentCount).toBe(2)
    expect(value.notes).toEqual(
      expect.arrayContaining(['attachments_kept', 'inline_images_placeholder'])
    )
  })

  it('refuses charsets it cannot decode faithfully instead of guessing', async () => {
    expect(
      await code(
        utf8(
          crlf(
            'Subject: X\nContent-Type: text/plain; charset=x-made-up\n\nhi\n'
          )
        ),
        'eml'
      )
    ).toBe('unsupported_charset')
    expect(
      await code(
        utf8(
          crlf('Subject: X\nContent-Type: text/plain; charset=utf-7\n\nhi\n')
        ),
        'eml'
      )
    ).toBe('unsupported_charset')
    expect(
      await code(
        utf8(
          crlf(
            'Subject: =?x-unknown?B?aGk=?=\nContent-Type: text/plain\n\nhi\n'
          )
        ),
        'eml'
      )
    ).toBe('unsupported_charset')
  })

  it('rejects mailboxes, non-messages, malformed bodies and resource abuse', async () => {
    expect(
      await code(
        utf8(
          crlf(
            'From news@cedar.example Thu Oct  1 09:30:00 2026\nSubject: A\n\nx\n'
          )
        ),
        'eml'
      )
    ).toBe('mbox_unsupported')
    expect(await code(utf8('<html><body>hi</body></html>'), 'eml')).toBe(
      'not_an_email'
    )
    expect(
      await code(
        utf8(crlf('Subject: Empty\nContent-Type: text/plain\n\n\n')),
        'eml'
      )
    ).toBe('no_content')
    let nested = 'Content-Type: text/plain\n\nbottom\n'
    for (let i = 0; i < 25; i++)
      nested = `Content-Type: multipart/mixed; boundary="n${i}"\n\n--n${i}\n${nested}--n${i}--\n`
    expect(
      await code(
        utf8(crlf(`Subject: Deep\nMIME-Version: 1.0\n${nested}`)),
        'eml'
      )
    ).toBe('limits_exceeded')
    const parts = Array.from(
      { length: 250 },
      (_, i) => `--w\nContent-Type: text/plain\n\npart ${i}\n`
    ).join('')
    expect(
      await code(
        utf8(
          crlf(
            `Subject: Wide\nContent-Type: multipart/mixed; boundary="w"\n\n${parts}--w--\n`
          )
        ),
        'eml'
      )
    ).toBe('limits_exceeded')
  })

  it('strips control and direction-override characters from metadata', async () => {
    const raw = crlf(
      'From: "Shop‮gnp.exe" <a@cedar.example>\nSubject: Hi\u0007 there\nContent-Type: text/plain\n\nx\n'
    )
    const value = await ok(utf8(raw), 'eml')
    expect(value.headerFrom).toBe('Shopgnp.exe <a@cedar.example>')
    expect(value.subject).toBe('Hi there')
  })
})

// Every string the database stores must be well-formed UTF-16 (JSONB rejects lone surrogates).
const loneSurrogate =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
const encoded = (text: string) =>
  `=?utf-8?B?${Buffer.from(text).toString('base64')}?=`

describe('review fixes: Unicode bounds, charset precedence and dates', () => {
  it('shortens subject and sender at an emoji boundary without splitting it', async () => {
    const subject = 'a'.repeat(198) + '😀long'
    const header = 'h'.repeat(1998) + '😀tail'
    const name = 'b'.repeat(398) + '😀xyz'
    const raw = crlf(
      `From: ${encoded(name)} <n@cedar.example>\nSubject: ${encoded(subject)}\nContent-Type: text/plain\n\nHi\n`
    )
    const value = await ok(utf8(raw), 'eml')
    expect(value.subject).toBe('a'.repeat(198) + '…')
    expect(value.notes).toEqual(
      expect.arrayContaining(['subject_shortened', 'sender_shortened'])
    )
    expect(value.headerFrom).toBe('b'.repeat(398) + '…')
    for (const text of [value.subject, value.headerSubject!, value.headerFrom!])
      expect(loneSurrogate.test(text)).toBe(false)
    const long = await ok(
      utf8(
        crlf(`Subject: ${encoded(header)}\nContent-Type: text/plain\n\nHi\n`)
      ),
      'eml'
    )
    expect(long.headerSubject).toBe('h'.repeat(1998) + '…')
    expect(JSON.parse(JSON.stringify(long))).toEqual(long)
    // An owner-chosen name gets the same treatment; the body is never shortened.
    const named = await ok(utf8('Body 😀 kept'), 'text', {
      fileName: 'n.txt',
      title: subject
    })
    expect(named.subject).toBe('a'.repeat(198) + '…')
    expect(named.body).toBe('Body 😀 kept')
  })

  it('honours a BOM first, then an explicit HTML declaration, then UTF-8', async () => {
    const bytes = (prefix: number[], text: string) =>
      new Uint8Array([...prefix, ...utf8(text)])
    const declared = '<meta charset="windows-1252"><p>café</p>'
    // Valid UTF-8 bytes C3 A9 under an explicit windows-1252 declaration mean "Ã©".
    expect((await ok(bytes([], declared), 'html')).body).toContain(
      '<p>cafÃ©</p>'
    )
    // A conflicting byte order mark wins over the declaration.
    expect(
      (await ok(bytes([0xef, 0xbb, 0xbf], declared), 'html')).body
    ).toContain('<p>café</p>')
    // An unsupported declaration is refused even for pure ASCII content.
    expect(
      await code(utf8('<meta charset="x-made-up"><p>plain ascii</p>'), 'html')
    ).toBe('unsupported_charset')
    // A UTF-16 declaration without a BOM is read as UTF-8, as browsers do.
    expect(
      (await ok(utf8('<meta charset="utf-16"><p>café</p>'), 'html')).body
    ).toContain('café')
    // No declaration: UTF-8 by default; text files never read declarations.
    expect((await ok(utf8('<p>café</p>'), 'html')).body).toBe('<p>café</p>')
    expect(
      (await ok(utf8('meta charset="windows-1252" café'), 'text')).body
    ).toContain('café')
  })

  it('keeps only dates the database contract can store, without failing the email', async () => {
    expect(contractDate('2026-10-01T07:30:00Z')).toBe(
      '2026-10-01T07:30:00.000Z'
    )
    expect(contractDate('+010000-01-01T00:00:00.000Z')).toBeNull()
    expect(contractDate('0000-06-01T00:00:00.000Z')).toBeNull()
    expect(contractDate('-000001-01-01T00:00:00.000Z')).toBeNull()
    expect(contractDate('not a date')).toBeNull()
    expect(contractDate('9999-12-31T23:59:59.999Z')).toBe(
      '9999-12-31T23:59:59.999Z'
    )
    for (const date of [
      'Sat, 01 Jan 10000 00:00:00 +0000',
      'Mon, 01 Jan 0000 00:00:00 +0000',
      'whenever'
    ]) {
      const value = await ok(
        utf8(
          crlf(
            `Subject: Dated\nDate: ${date}\nContent-Type: text/plain\n\nHi\n`
          )
        ),
        'eml'
      )
      if (value.headerDate === null)
        expect(value.notes).toContain('date_unreadable')
      else {
        expect(value.headerDate).toMatch(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
        )
        expect(value.headerDate.startsWith('0000')).toBe(false)
      }
    }
  })
})
