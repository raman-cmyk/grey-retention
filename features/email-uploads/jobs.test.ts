// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  blueprint,
  image,
  section,
  text
} from '@/features/design-engine/fixtures'
import { ENGINE_VERSION, forStorage } from '@/features/design-engine/stored'
import { checkOwn, checkUpload } from './measure'
import { picturePlaceholder } from './prepare'

vi.mock('server-only', () => ({}))

const { finishUpload, uploadJobs, uploadResult, uploadsWaiting } =
  await import('./jobs')

const job = '00000000-0000-4000-8000-0000000000a1'
const lease = '00000000-0000-4000-8000-0000000000b1'
const upload = '00000000-0000-4000-8000-0000000000c1'
const tenant = '00000000-0000-4000-8000-0000000000d1'
const on = { DESIGN_UPLOAD_COPY: 'on' }

function fakeDb(answers: {
  rpc?: Record<string, unknown>
  errors?: Record<string, { code: string; message?: string }>
  rows?: Record<string, unknown>
  signed?: string | null
  /** The prepared HTML's tag as stored now. */
  etag?: string
}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = []
  const db = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args })
      const error = answers.errors?.[fn]
      if (error) {
        delete answers.errors![fn]
        return { data: null, error }
      }
      return { data: answers.rpc?.[fn] ?? null, error: null }
    },
    from: (table: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        in: () => q,
        lte: () => Promise.resolve({ count: 3, error: null }),
        maybeSingle: async () => ({
          data: answers.rows?.[table] ?? null,
          error: null
        })
      }
      return q
    },
    storage: {
      from: () => ({
        list: async () => ({
          data: [
            { name: 'email.html', metadata: { eTag: answers.etag ?? '"e1"' } }
          ],
          error: null
        }),
        createSignedUrl: async (path: string) => {
          calls.push({ fn: 'sign', args: { path } })
          return answers.signed === null
            ? { data: null, error: { message: 'no' } }
            : {
                data: { signedUrl: `https://db.test/sign/${path}` },
                error: null
              }
        }
      })
    }
  }
  return { db: db as never, calls }
}

const own = () =>
  blueprint({
    sections: [
      section({
        items: [
          image({ src: picturePlaceholder(0, 'image/png') }),
          image({ src: picturePlaceholder(5, 'image/png') }),
          image({ src: 'https://images.example/kept.png' })
        ]
      })
    ]
  })

describe('an uploaded email’s blueprint as kept (DES-ENGINE-003)', () => {
  it('keeps another brand’s email bare: no picture, no link', () => {
    const got = checkUpload(own(), 'other', 0)
    expect(got.ok && got.blueprint).toEqual(forStorage(own()))
    expect(JSON.stringify(got)).not.toMatch(/"(src|href)":"/)
  })

  it('keeps an own design’s stored pictures and links, and only its own', () => {
    const got = checkOwn(own(), 1)
    expect(got.ok).toBe(true)
    if (!got.ok) return
    const srcs = got.blueprint.sections[0]!.items.map((i) =>
      i.type === 'image' ? i.src : null
    )
    // Picture 5 is not one of its 1 stored pictures.
    expect(srcs).toEqual([
      picturePlaceholder(0, 'image/png'),
      null,
      'https://images.example/kept.png'
    ])
    expect(JSON.stringify(got.blueprint)).toContain(
      '"href":"https://example.com/"'
    )
  })

  it('refuses a blueprint too large to keep, counted in bytes', () => {
    const big = blueprint({
      sections: [
        section({
          items: [
            text({
              runs: Array.from({ length: 70 }, () => ({
                text: 'é'.repeat(4_000)
              }))
            })
          ]
        })
      ]
    })
    expect(JSON.stringify(big).length).toBeLessThan(500_000)
    expect(checkUpload(big, 'own', 0)).toMatchObject({
      ok: false,
      failure: 'stored_too_large'
    })
    expect(checkUpload(big, 'other', 0)).toMatchObject({
      ok: false,
      failure: 'stored_too_large'
    })
  })

  it('refuses what is not a blueprint', () => {
    expect(checkOwn({ version: 9 }, 0)).toEqual({
      ok: false,
      failure: 'not_valid',
      retry: false
    })
  })
})

describe('the upload measuring job (DES-ENGINE-003)', () => {
  it('hands out nothing with the owner’s switch off, nor to another engine version', async () => {
    const { db, calls } = fakeDb({})
    expect(await uploadJobs(db, ENGINE_VERSION, {})).toEqual({
      jobs: [],
      skew: false,
      off: true
    })
    expect(await uploadJobs(db, 'old', on)).toEqual({ jobs: [], skew: true })
    expect(await uploadsWaiting(db, {})).toBe(0)
    expect(calls).toEqual([])
  })

  it('hands out one upload: its prepared HTML as a signed link, its kind and its pictures', async () => {
    const { db, calls } = fakeDb({
      rpc: {
        claim_email_upload: [
          {
            id: job,
            subject_key: upload,
            lease_token: lease,
            tenant_id: tenant,
            design: 'own',
            pictures: 2,
            html_etag: '"e1"'
          }
        ],
        email_upload_jobs_waiting: 3
      }
    })
    expect(await uploadJobs(db, ENGINE_VERSION, on)).toEqual({
      jobs: [
        {
          job,
          lease,
          design: 'own',
          pictures: 2,
          html: `https://db.test/sign/${tenant}/${upload}/email.html`
        }
      ],
      skew: false
    })
    expect(calls.map((c) => c.fn)).toEqual(['claim_email_upload', 'sign'])
    expect(await uploadsWaiting(db, on)).toBe(3)
  })

  it('never measures a prepared HTML that changed since it was pinned', async () => {
    const { db, calls } = fakeDb({
      etag: '"other"',
      rpc: {
        claim_email_upload: [
          {
            id: job,
            subject_key: upload,
            lease_token: lease,
            tenant_id: tenant,
            design: 'own',
            pictures: 0,
            html_etag: '"e1"'
          }
        ]
      }
    })
    expect((await uploadJobs(db, ENGINE_VERSION, on)).jobs).toEqual([])
    expect(calls.at(-1)).toEqual({
      fn: 'record_email_upload',
      args: { job, lease, failure: 'file_changed' }
    })
    expect(calls.map((c) => c.fn)).not.toContain('sign')
  })

  it('gives a job back as a retry when its link cannot be signed', async () => {
    const { db, calls } = fakeDb({
      signed: null,
      rpc: {
        claim_email_upload: [
          {
            id: job,
            subject_key: upload,
            lease_token: lease,
            tenant_id: tenant,
            design: 'other',
            pictures: 0,
            html_etag: '"e1"'
          }
        ]
      }
    })
    expect((await uploadJobs(db, ENGINE_VERSION, on)).jobs).toEqual([])
    expect(calls.at(-1)).toEqual({
      fn: 'fail_platform_job',
      args: {
        job,
        lease,
        failure: 'protocol',
        error_code: 'upload_link_failed'
      }
    })
  })

  it('checks a blueprint again for the upload’s own kind, read from the job, before storing it', async () => {
    const { db, calls } = fakeDb({
      rpc: { record_email_upload: 'ready' },
      rows: {
        platform_jobs: { subject_key: upload },
        email_uploads: { design: 'other', pictures: [] }
      }
    })
    const done = await finishUpload(
      db,
      uploadResult.parse({
        job,
        lease,
        engine: ENGINE_VERSION,
        blueprint: own()
      })
    )
    expect(done).toEqual({ ok: true, state: 'ready' })
    expect(calls[0]).toEqual({
      fn: 'record_email_upload',
      args: { job, lease, blueprint: forStorage(own()) }
    })
  })

  it('stores a refused blueprint as failed, a table refusal with its reason', async () => {
    const { db, calls } = fakeDb({
      rpc: { record_email_upload: 'failed' },
      errors: {
        record_email_upload: {
          code: '23514',
          message: "Another brand's blueprint keeps a picture or link"
        }
      },
      rows: {
        platform_jobs: { subject_key: upload },
        email_uploads: { design: 'own', pictures: [{}] }
      }
    })
    await finishUpload(
      db,
      uploadResult.parse({
        job,
        lease,
        engine: ENGINE_VERSION,
        blueprint: own()
      })
    )
    expect(calls.map((c) => c.args.failure)).toEqual([undefined, 'not_bare'])
    const bad = fakeDb({
      rpc: { record_email_upload: 'failed' },
      rows: {
        platform_jobs: { subject_key: upload },
        email_uploads: { design: 'own', pictures: [] }
      }
    })
    await finishUpload(
      bad.db,
      uploadResult.parse({
        job,
        lease,
        engine: ENGINE_VERSION,
        blueprint: { version: 3 }
      })
    )
    expect(bad.calls[0]!.args).toEqual({ job, lease, failure: 'not_valid' })
  })

  it('hands back a result of another engine version without a try, and retries a slow browser', async () => {
    const a = fakeDb({})
    expect(
      await finishUpload(
        a.db,
        uploadResult.parse({ job, lease, engine: 'old', failure: 'too_tall' })
      )
    ).toEqual({ ok: true, state: 'retry' })
    expect(a.calls).toEqual([
      { fn: 'release_email_upload', args: { job, lease } }
    ])
    const b = fakeDb({})
    await finishUpload(
      b.db,
      uploadResult.parse({ job, lease, retry: 'timeout' })
    )
    expect(b.calls).toEqual([
      {
        fn: 'fail_platform_job',
        args: { job, lease, failure: 'timeout', error_code: 'timeout' }
      }
    ])
  })

  it('refuses a result that is not one', () => {
    expect(uploadResult.safeParse({ job, lease }).success).toBe(false)
    expect(
      uploadResult.safeParse({ job, lease, engine: 'x', failure: 'whatever' })
        .success
    ).toBe(false)
  })
})
