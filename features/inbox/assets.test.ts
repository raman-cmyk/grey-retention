// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import type { ImageFetcher } from '@/lib/providers/image-fetch'
import { keepImages, keepInboxImages } from './assets'
import { sampleImageFetcher } from './image-fetch'

const png = Uint8Array.from(Buffer.from('89504e470d0a1a0a00000001', 'hex'))
const gif = new TextEncoder().encode('GIF89a-one')

/** A stand-in for the inbox tables, the RPCs and both buckets. */
function database(
  options: {
    messages?: Record<
      string,
      { html: string; raw?: string; synthetic?: boolean }
    >
    jobs?: string[]
    recordError?: { code: string; message: string }
    /** What storing the marked copy answers. */
    marked?: 'ok' | 'exists' | 'down'
    sectionsError?: { code: string; message: string }
    assetsState?: 'pending' | 'done'
  } = {}
) {
  const stored = new Map<string, Uint8Array>()
  const uploads: string[] = []
  const calls: { name: string; args: Record<string, unknown> }[] = []
  const jobs = [...(options.jobs ?? [])]
  const db = {
    stored,
    uploads,
    calls,
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args })
      if (name === 'claim_platform_job') {
        const id = jobs.shift()
        return {
          data: id
            ? [{ id: `job-${id}`, lease_token: 'lease', subject_key: id }]
            : [],
          error: null
        }
      }
      if (name === 'record_inbox_sections' && options.sectionsError)
        return (args.sections as unknown[]).length
          ? { data: null, error: options.sectionsError }
          : { data: 0, error: null }
      if (name === 'record_inbox_images')
        return options.recordError
          ? { data: null, error: options.recordError }
          : { data: { stored: 1, failed: 0 }, error: null }
      return { data: null, error: null }
    }),
    from: () => ({
      select: () => ({
        eq: (_: string, id: string) => ({
          single: async () => {
            const m = options.messages?.[id]
            return m
              ? {
                  data: {
                    id,
                    html_path: `fake/${id}.html`,
                    raw_path: `fake/${id}.eml`,
                    synthetic: m.synthetic ?? true,
                    assets_state: options.assetsState ?? 'pending'
                  },
                  error: null
                }
              : { data: null, error: { code: 'PGRST116', message: 'none' } }
          }
        })
      })
    }),
    storage: {
      from: (bucket: string) => ({
        download: async (path: string) => {
          const id = path.replace(/^fake\/|\.(html|eml)$/g, '')
          const m = options.messages?.[id]
          const text = path.endsWith('.html') ? m?.html : m?.raw
          return text === undefined
            ? { data: null, error: { message: 'Object not found' } }
            : { data: new Blob([text]), error: null }
        },
        upload: async (path: string, body: Uint8Array) => {
          // INB-003: the marked HTML copy goes next to the email's HTML.
          if (bucket === 'inbox-raw') {
            expect(path).toMatch(/^fake\/[a-f0-9]{64}\.marked\.html$/)
            if (options.marked === 'exists')
              return {
                data: null,
                error: {
                  message: 'The resource already exists',
                  statusCode: '409'
                }
              }
            if (options.marked === 'down')
              return {
                data: null,
                error: { message: 'Service unavailable', statusCode: '503' }
              }
            return { data: { path }, error: null }
          }
          expect(bucket).toBe('inbox-assets')
          uploads.push(path)
          if (stored.has(path))
            return {
              data: null,
              error: {
                message: 'The resource already exists',
                statusCode: '409'
              }
            }
          stored.set(path, body)
          return { data: { path }, error: null }
        }
      })
    }
  }
  return db
}
type Db = Parameters<typeof keepImages>[0]

const fetcher = (
  answers: Record<string, Uint8Array | 'broken' | 'timeout'>
): ImageFetcher => ({
  fetch: vi.fn(async (url: string) => {
    const a = answers[url] ?? 'broken'
    return typeof a === 'string'
      ? { ok: false as const, failure: a }
      : { ok: true as const, bytes: a }
  })
})

const later = () => Date.now() + 60_000

describe('keepImages', () => {
  it('stores each image once by content and records what failed and why', async () => {
    const db = database()
    const html = `<img src="https://cdn.shop.test/a.png"><img src="https://cdn.shop.test/same-again.png">
      <img src="https://cdn.shop.test/gone.png"><img src="https://cdn.shop.test/page.html">
      <img src="https://cdn.shop.test/big.png"><img src="data:image/png;base64,${Buffer.from(png).toString('base64')}">`
    const records = await keepImages(
      db as unknown as Db,
      html,
      async () => new Uint8Array(),
      fetcher({
        'https://cdn.shop.test/a.png': png,
        'https://cdn.shop.test/same-again.png': png,
        'https://cdn.shop.test/page.html': new TextEncoder().encode('<html>'),
        'https://cdn.shop.test/big.png': new Uint8Array(6 * 1024 * 1024)
      }),
      later()
    )
    expect(
      records.map((r) => [r.ordinal, r.state, r.failure ?? r.contentType])
    ).toEqual([
      [1, 'stored', 'image/png'],
      [2, 'stored', 'image/png'],
      [3, 'failed', 'broken'],
      [4, 'failed', 'not_image'],
      [5, 'failed', 'too_large'],
      [6, 'stored', 'image/png']
    ])
    // The same picture three times is one stored copy.
    expect(db.stored.size).toBe(1)
    expect([...db.stored.keys()][0]).toMatch(/^img\/[a-f0-9]{64}\.png$/)
    expect(records[0]).toMatchObject({
      sourceRef: 'https://cdn.shop.test/a.png',
      bytes: png.length
    })
  })

  it('reads cid: images from the email itself', async () => {
    const raw = [
      'From: a@shop.example',
      'Subject: Parts',
      'MIME-Version: 1.0',
      'Content-Type: multipart/related; boundary="b"',
      '',
      '--b',
      'Content-Type: text/html',
      '',
      '<img src="cid:logo@shop">',
      '--b',
      'Content-Type: image/gif',
      'Content-ID: <logo@shop>',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(gif).toString('base64'),
      '--b--',
      ''
    ].join('\r\n')
    const db = database()
    const records = await keepImages(
      db as unknown as Db,
      '<img src="cid:logo@shop"><img src="cid:missing@shop">',
      async () => new TextEncoder().encode(raw),
      fetcher({}),
      later()
    )
    expect(
      records.map((r) => [r.source, r.state, r.contentType ?? r.failure])
    ).toEqual([
      ['cid', 'stored', 'image/gif'],
      ['cid', 'failed', 'broken']
    ])
  })

  it('keeps an email under its total allowance', async () => {
    const db = database()
    const big = new Uint8Array(4 * 1024 * 1024)
    big.set(png)
    const html = Array.from(
      { length: 8 },
      (_, i) => `<img src="https://cdn.shop.test/${i}.png">`
    ).join('')
    const answers = Object.fromEntries(
      Array.from({ length: 8 }, (_, i) => {
        const copy = big.slice()
        copy[20] = i
        return [`https://cdn.shop.test/${i}.png`, copy]
      })
    )
    const records = await keepImages(
      db as unknown as Db,
      html,
      async () => new Uint8Array(),
      fetcher(answers),
      later(),
      {
        maxImageBytes: 5 * 1024 * 1024,
        maxEmailBytes: 25 * 1024 * 1024,
        imageTimeoutMs: 5_000,
        parallel: 1
      }
    )
    expect(records.filter((r) => r.state === 'stored')).toHaveLength(6)
    expect(records.filter((r) => r.failure === 'limit')).toHaveLength(2)
  })

  it('stores nothing twice on a retry', async () => {
    const db = database()
    const html = '<img src="https://cdn.shop.test/a.png">'
    const f = fetcher({ 'https://cdn.shop.test/a.png': png })
    const first = await keepImages(
      db as unknown as Db,
      html,
      async () => new Uint8Array(),
      f,
      later()
    )
    const again = await keepImages(
      db as unknown as Db,
      html,
      async () => new Uint8Array(),
      f,
      later()
    )
    expect(again).toEqual(first)
    expect(db.stored.size).toBe(1)
  })

  it('on the last attempt, records what did not fit in the time instead of trying again', async () => {
    const db = database()
    const records = await keepImages(
      db as unknown as Db,
      '<img src="https://cdn.shop.test/a.png">',
      async () => new Uint8Array(),
      fetcher({}),
      Date.now() - 1,
      undefined,
      true
    )
    expect(records).toEqual([
      {
        ordinal: 1,
        source: 'remote',
        sourceRef: 'https://cdn.shop.test/a.png',
        state: 'failed',
        failure: 'timeout'
      }
    ])
  })

  it('gives up without recording when the time is up, so the job is retried', async () => {
    const db = database()
    await expect(
      keepImages(
        db as unknown as Db,
        '<img src="https://cdn.shop.test/a.png">',
        async () => new Uint8Array(),
        fetcher({}),
        Date.now() - 1
      )
    ).rejects.toMatchObject({ kind: 'timeout', code: 'assets_out_of_time' })
  })
})

describe('keepInboxImages', () => {
  it('keeps the images of each queued email, records them and finishes the job', async () => {
    const db = database({
      jobs: ['m1'],
      messages: {
        m1: { html: '<img src="https://mail.northwind.example/hero.png">' }
      }
    })
    const run = await keepInboxImages(
      db as unknown as Db,
      { real: fetcher({}), sample: sampleImageFetcher },
      later()
    )
    expect(run).toEqual({ emails: 1, stored: 1, failed: 0, retried: 0 })
    const names = db.calls.map((c) => c.name)
    expect(names).toEqual([
      'claim_platform_job',
      'record_inbox_sections',
      'record_inbox_images',
      'finish_platform_job',
      'claim_platform_job'
    ])
    // The images were fetched and stored before the sections were recorded.
    expect(db.stored.size).toBe(1)
    expect(db.calls[1]!.args).toMatchObject({
      marked_path: expect.stringMatching(/^fake\/[a-f0-9]{64}\.marked\.html$/),
      sections: [{ ordinal: 1, kind: 'design' }]
    })
    expect(db.calls[2]!.args.images).toMatchObject([
      { ordinal: 1, state: 'stored', source: 'remote' }
    ])
  })

  const hero = {
    m1: {
      html: '<table width="600"><tr><td><img src="https://mail.northwind.example/hero.png" width="600"></td></tr><tr><td>Spring layers are here</td></tr></table>'
    }
  }
  const sweep = (db: ReturnType<typeof database>) =>
    keepInboxImages(
      db as unknown as Db,
      { real: fetcher({}), sample: sampleImageFetcher },
      later()
    )

  it('records the sections when their marked copy is already stored', async () => {
    const db = database({ jobs: ['m1'], messages: hero, marked: 'exists' })
    expect(await sweep(db)).toMatchObject({ emails: 1, retried: 0 })
    expect(
      db.calls.find((c) => c.name === 'record_inbox_sections')!.args
    ).toMatchObject({
      marked_path: expect.stringMatching(/\.marked\.html$/),
      sections: [{ ordinal: 1 }, { ordinal: 2 }]
    })
  })

  it('still keeps and records the images when the sections cannot be stored', async () => {
    const db = database({ jobs: ['m1'], messages: hero, marked: 'down' })
    expect(await sweep(db)).toMatchObject({ emails: 1, stored: 1, retried: 0 })
    expect(
      db.calls
        .filter((c) => c.name === 'record_inbox_sections')
        .map((c) => c.args)
    ).toEqual([
      { job: 'job-m1', lease: 'lease', marked_path: null, sections: [] }
    ])
    expect(db.calls.map((c) => c.name)).toContain('record_inbox_images')
    expect(db.calls.map((c) => c.name)).toContain('finish_platform_job')
  })

  it('records the email without sections when the database refuses the cut', async () => {
    const db = database({
      jobs: ['m1'],
      messages: hero,
      sectionsError: { code: '23514', message: 'Invalid sections' }
    })
    expect(await sweep(db)).toMatchObject({ emails: 1, retried: 0 })
    expect(
      db.calls.filter((c) => c.name === 'record_inbox_sections')
    ).toHaveLength(2)
  })

  it('fails the job when its lease is lost while recording the sections', async () => {
    const db = database({
      jobs: ['m1'],
      messages: hero,
      sectionsError: { code: 'PT409', message: 'Lease lost' }
    })
    expect(await sweep(db)).toMatchObject({ emails: 0, retried: 1 })
    expect(db.calls.map((c) => c.name)).not.toContain('record_inbox_images')
    expect(db.calls.map((c) => c.name)).toContain('fail_platform_job')
  })

  it('only cuts an email whose images were kept before sections existed', async () => {
    const real = fetcher({})
    const db = database({ jobs: ['m1'], messages: hero, assetsState: 'done' })
    const run = await keepInboxImages(
      db as unknown as Db,
      { real, sample: { fetch: vi.fn(sampleImageFetcher.fetch) } },
      later()
    )
    expect(run).toEqual({ emails: 1, stored: 0, failed: 0, retried: 0 })
    expect(db.calls.map((c) => c.name)).toEqual([
      'claim_platform_job',
      'record_inbox_sections',
      'finish_platform_job',
      'claim_platform_job'
    ])
    expect(db.stored.size).toBe(0)
  })

  it('uses the live fetcher only for real emails', async () => {
    const real = fetcher({ 'https://cdn.real.test/a.png': png })
    const sample = { fetch: vi.fn(sampleImageFetcher.fetch) }
    const db = database({
      jobs: ['r1'],
      messages: {
        r1: {
          html: '<img src="https://cdn.real.test/a.png">',
          synthetic: false
        }
      }
    })
    await keepInboxImages(db as unknown as Db, { real, sample }, later())
    expect(real.fetch).toHaveBeenCalledOnce()
    expect(sample.fetch).not.toHaveBeenCalled()
  })

  it('fails one email with a safe code and goes on with the next', async () => {
    const db = database({
      jobs: ['gone', 'm2'],
      messages: { m2: { html: '<p>No images</p>' } }
    })
    const run = await keepInboxImages(
      db as unknown as Db,
      { real: fetcher({}), sample: sampleImageFetcher },
      later()
    )
    expect(run).toMatchObject({ emails: 1, retried: 1 })
    expect(
      db.calls.find((c) => c.name === 'fail_platform_job')!.args
    ).toMatchObject({
      job: 'job-gone',
      failure: 'protocol',
      error_code: 'inbox_message_missing'
    })
  })

  it('names a stored copy the database cannot find', async () => {
    const db = database({
      jobs: ['m1'],
      messages: {
        m1: { html: '<img src="https://mail.northwind.example/hero.png">' }
      },
      recordError: { code: 'PT409', message: 'Stored copy missing' }
    })
    await keepInboxImages(
      db as unknown as Db,
      { real: fetcher({}), sample: sampleImageFetcher },
      later()
    )
    expect(
      db.calls.find((c) => c.name === 'fail_platform_job')!.args
    ).toMatchObject({
      error_code: 'stored_copy_missing'
    })
  })

  it('takes no job once its time is up', async () => {
    const db = database({ jobs: ['m1'] })
    const run = await keepInboxImages(
      db as unknown as Db,
      { real: fetcher({}), sample: sampleImageFetcher },
      Date.now() - 1
    )
    expect(run.emails).toBe(0)
    expect(db.calls).toEqual([])
  })
})
