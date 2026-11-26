// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { picture } from '@/features/design-engine/golden/pictures'
import { readDesignFile } from '@/features/email-import/parse'
import { addUploadFile, deleteUploadFiles, uploadName } from './intake'

const tenant = '00000000-0000-4000-8000-0000000000d1'
const upload = '00000000-0000-4000-8000-0000000000c1'
const requestKey = '00000000-0000-4000-8000-0000000000e1'
const enc = (s: string) => new TextEncoder().encode(s)

const pngB64 = picture(40, 20, '#225588', true).split(',')[1]!
const eml = (html: string) =>
  enc(
    [
      'From: Cedar Lane <hello@cedarlane.example>',
      'Subject: Our autumn edit',
      'MIME-Version: 1.0',
      'Content-Type: multipart/related; boundary="b1"',
      '',
      '--b1',
      'Content-Type: text/html; charset=utf-8',
      '',
      html,
      '--b1',
      'Content-Type: image/png',
      'Content-Transfer-Encoding: base64',
      'Content-ID: <hero@cedar>',
      '',
      pngB64,
      '--b1--',
      ''
    ].join('\r\n')
  )
const designHtml =
  '<table width="600"><tr><td><img src="cid:hero@cedar" alt="Autumn"></td></tr><tr><td><p>Hello there</p></td></tr></table>'

function fakes(answers: {
  added?: { id: string; state: string } | null
  addError?: { code: string; hint?: string }
  finish?: string
  finishError?: { code: string; hint?: string }
  storedError?: string
  deleted?: string
  /** The pictures the row was saved with (a retry); else the ones added. */
  saved?: unknown
}) {
  const calls: string[] = []
  const stored: { path: string; type: string; size: number }[] = []
  let added: unknown = []
  const db = {
    from: () => {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({
          data: { pictures: answers.saved ?? added },
          error: null
        })
      }
      return q
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push(fn)
      if (fn === 'add_email_upload') added = args.pictures
      if (fn === 'add_email_upload')
        return answers.addError
          ? { data: null, error: answers.addError }
          : {
              data: [answers.added ?? { id: upload, state: 'saving' }],
              error: null,
              args
            }
      if (fn === 'finish_email_upload')
        return answers.finishError
          ? { data: null, error: answers.finishError }
          : { data: answers.finish ?? 'measuring', error: null }
      if (fn === 'delete_email_upload')
        return { data: answers.deleted ?? `${tenant}/${upload}/`, error: null }
      return { data: null, error: null }
    }
  }
  const service = {
    storage: {
      from: (bucket: string) => ({
        upload: async (
          path: string,
          body: Uint8Array,
          o: { contentType: string; upsert: boolean }
        ) => {
          calls.push(`upload:${bucket}`)
          expect(o.upsert).toBe(false)
          stored.push({ path, type: o.contentType, size: body.byteLength })
          return answers.storedError
            ? { data: null, error: { message: answers.storedError } }
            : { data: {}, error: null }
        },
        list: async () => ({
          data: [{ name: 'original.eml' }, { name: 'email.html' }],
          error: null
        }),
        remove: async (paths: string[]) => {
          calls.push(`remove:${paths.join(',')}`)
          return { data: [], error: null }
        }
      })
    }
  }
  return { db: db as never, service: service as never, calls, stored }
}

const add = (
  f: ReturnType<typeof fakes>,
  file: { name: string; bytes: Uint8Array },
  design: 'own' | 'other' = 'own'
) =>
  addUploadFile({
    db: f.db,
    service: f.service,
    tenantId: tenant,
    form: { requestKey, name: '', design },
    file
  })

describe('adding an email file (DES-ENGINE-003)', () => {
  it('reads an .eml’s own pictures, saves the row, stores every file, then queues it', async () => {
    const f = fakes({})
    const got = await add(f, { name: 'autumn.eml', bytes: eml(designHtml) })
    expect(got).toEqual({
      ok: true,
      id: upload,
      state: 'measuring',
      missing: 0
    })
    expect(f.calls).toEqual([
      'add_email_upload',
      'upload:email-uploads',
      'upload:email-uploads',
      'upload:email-uploads',
      'finish_email_upload'
    ])
    expect(f.stored.map((s) => [s.path, s.type])).toEqual([
      [`${tenant}/${upload}/original.eml`, 'message/rfc822'],
      [`${tenant}/${upload}/email.html`, 'text/html'],
      [`${tenant}/${upload}/picture-0.png`, 'image/png']
    ])
  })

  it('keeps no picture of another brand’s email', async () => {
    const f = fakes({})
    await add(f, { name: 'theirs.eml', bytes: eml(designHtml) }, 'other')
    expect(f.stored.map((s) => s.path)).toEqual([
      `${tenant}/${upload}/original.eml`,
      `${tenant}/${upload}/email.html`
    ])
  })

  it('stores nothing again for an upload already saved (the same request)', async () => {
    const f = fakes({ added: { id: upload, state: 'ready' } })
    expect(
      await add(f, {
        name: 'a.html',
        bytes: enc(`<html><body>${designHtml}</body></html>`)
      })
    ).toEqual({ ok: true, id: upload, state: 'ready', missing: 1 })
    expect(f.calls).toEqual(['add_email_upload'])
  })

  it('refuses a retry whose pictures are not the ones the row was saved with', async () => {
    const f = fakes({ saved: [] })
    const got = await add(f, { name: 'autumn.eml', bytes: eml(designHtml) })
    expect(got.ok).toBe(false)
    expect(!got.ok && got.error).toContain('its pictures have changed')
    expect(f.calls).toEqual(['add_email_upload'])
  })

  it('removes the files it wrote when the upload was deleted meanwhile', async () => {
    const f = fakes({ finishError: { code: 'PT409', hint: 'upload_gone' } })
    const got = await add(f, { name: 'autumn.eml', bytes: eml(designHtml) })
    expect(!got.ok && got.error).toContain('deleted while it was added')
    expect(f.calls.at(-1)).toBe(
      `remove:${tenant}/${upload}/original.eml,${tenant}/${upload}/email.html,${tenant}/${upload}/picture-0.png`
    )
  })

  it('treats a file already stored by the same request as stored', async () => {
    const f = fakes({ storedError: 'The resource already exists' })
    expect(
      (await add(f, { name: 'a.html', bytes: enc(`<p>${designHtml}</p>`) })).ok
    ).toBe(true)
  })

  it.each([
    [
      'a file with another kind',
      { name: 'a.pdf', bytes: enc('%PDF') },
      'not supported'
    ],
    ['an empty file', { name: 'a.html', bytes: enc('') }, 'no email in it'],
    [
      'a picture named .html',
      { name: 'a.html', bytes: Buffer.from(pngB64, 'base64') },
      'not supported'
    ],
    [
      'a saved message named .html',
      {
        name: 'a.html',
        bytes: enc('Received: x\r\nMessage-ID: <1@x>\r\n\r\n<p>x</p>')
      },
      'Rename it'
    ],
    [
      'a mailbox',
      {
        name: 'a.eml',
        bytes: enc('From someone Mon Jan 1\r\nSubject: x\r\n\r\nx')
      },
      'mailbox'
    ],
    [
      'a text-only email',
      {
        name: 'a.eml',
        bytes: enc('Subject: x\r\nContent-Type: text/plain\r\n\r\nJust words')
      },
      'words only'
    ],
    [
      'a file over 4 MB',
      { name: 'a.html', bytes: new Uint8Array(4 * 1024 * 1024 + 1) },
      'larger than 4 MB'
    ]
  ])('refuses %s before anything is saved', async (_, file, words) => {
    const f = fakes({})
    const got = await add(f, file)
    expect(got.ok).toBe(false)
    expect(!got.ok && got.error).toContain(words)
    expect(f.calls).toEqual([])
  })

  it('says why the database refused it, in plain words', async () => {
    expect(
      await add(fakes({ addError: { code: '42501' } }), {
        name: 'a.html',
        bytes: enc(designHtml)
      })
    ).toEqual({
      ok: false,
      error: 'Only the owner or an admin of this workspace can add emails.'
    })
    expect(
      await add(fakes({ addError: { code: 'PT409', hint: 'upload_limit' } }), {
        name: 'a.html',
        bytes: enc(designHtml)
      })
    ).toEqual({
      ok: false,
      error:
        'You have 100 emails of your own, the most. Delete one to add another.'
    })
    const lost = fakes({ storedError: 'network down' })
    expect(
      (await add(lost, { name: 'a.html', bytes: enc(designHtml) })).ok
    ).toBe(false)
    expect(lost.calls).not.toContain('finish_email_upload')
  })

  it('deletes the row, then its files', async () => {
    const f = fakes({})
    expect(
      await deleteUploadFiles({
        db: f.db,
        service: f.service,
        tenantId: tenant,
        uploadId: upload
      })
    ).toEqual({ ok: true })
    expect(f.calls).toEqual([
      'delete_email_upload',
      `remove:${tenant}/${upload}/original.eml,${tenant}/${upload}/email.html`
    ])
  })

  it('names it from the owner’s words, else the file’s title, else its name', () => {
    expect(uploadName('  My  hero​ email ', 'T', 'f.html')).toBe(
      'My hero email'
    )
    expect(uploadName('', 'Our autumn edit', 'f.html')).toBe('Our autumn edit')
    expect(uploadName('', '', 'spring-sale.eml')).toBe('spring-sale')
    expect(uploadName('x'.repeat(200), '', 'f.html')).toHaveLength(80)
    expect(uploadName('', 'Sale\u0085 now', 'f.html')).toBe('Sale now')
  })
})

describe('reading a design file (DES-ENGINE-003)', () => {
  it('keeps an .eml’s related pictures and its subject', async () => {
    const got = await readDesignFile(eml(designHtml), 'eml')
    expect(got.ok).toBe(true)
    if (!got.ok) return
    expect(got.title).toBe('Our autumn edit')
    expect(got.related).toHaveLength(1)
    expect(got.related[0]!.contentId).toBe('hero@cedar')
    expect(got.related[0]!.type).toBe('image/png')
  })

  it('keeps a large design whole, up to 2,000,000 characters', async () => {
    const big = `<html><body><p>${'a'.repeat(1_500_000)}</p></body></html>`
    const got = await readDesignFile(enc(big), 'html')
    expect(got.ok && got.html.length).toBe(big.length)
    expect(
      await readDesignFile(enc(`<p>${'a'.repeat(2_000_001)}</p>`), 'html')
    ).toEqual({ ok: false, code: 'content_too_large' })
  })

  it('refuses a file with no HTML in it', async () => {
    expect(await readDesignFile(enc('just words'), 'html')).toEqual({
      ok: false,
      code: 'no_html'
    })
  })
})
