// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { blueprint } from '@/features/design-engine/fixtures'
import { ENGINE_VERSION } from '@/features/design-engine/stored'
import { copyFailures, type CopyInput, type CopyRecord } from './library-copy'

vi.mock('server-only', () => ({}))
// The carry-on runs the worker; the ports and the job's side never need it.
vi.mock('./worker', () => ({ runEmailBuilds: vi.fn(async () => ({ ran: 1 })) }))

const { libraryPortsFor, visibleEmail, withPhotoLinks, copyPhotoLinkSeconds } =
  await import('./library-copy-live')
const { copyJobs, copyResult, finishCopy, runCopiedBuilds } =
  await import('./copy-jobs')
const { runEmailBuilds } = await import('./worker')

const tenant = '00000000-0000-4000-8000-000000000101'
const build = '00000000-0000-4000-8000-0000000000c1'
const job = '00000000-0000-4000-8000-0000000000a1'
const lease = '00000000-0000-4000-8000-0000000000b1'
const message = '00000000-0000-4000-8000-0000000000d1'

type Rows = Record<string, unknown[]>

/**
 * A database that records RPCs, storage calls and reads, and answers rows
 * by table (each filter checked against the row's own column).
 */
function fakeDb(answers: {
  rows?: Rows
  rpc?: Record<string, { data?: unknown; error?: unknown }>
  signed?: { signedUrl: string | null; error: string | null }[]
}) {
  const calls: { fn: string; args: unknown }[] = []
  const db = {
    rpc: async (fn: string, args: unknown) => {
      calls.push({ fn, args })
      const a = answers.rpc?.[fn] ?? {}
      return { data: a.data ?? null, error: a.error ?? null }
    },
    from: (table: string) => {
      let rows = [...(answers.rows?.[table] ?? [])] as Record<string, unknown>[]
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => {
          rows = rows.filter((r) => !(c in r) || r[c] === v)
          return q
        },
        in: (c: string, v: unknown[]) => {
          rows = rows.filter((r) => !(c in r) || v.includes(r[c]))
          return q
        },
        gte: () => q,
        lte: () => q,
        order: () => q,
        limit: () => q,
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        then: (done: (v: unknown) => unknown) =>
          Promise.resolve({ data: rows, error: null, count: rows.length }).then(
            done
          )
      }
      return q
    },
    storage: {
      from: (bucket: string) => ({
        createSignedUrls: async (paths: string[], seconds: number) => {
          calls.push({ fn: `sign:${bucket}`, args: { paths, seconds } })
          return {
            data:
              answers.signed ??
              paths.map((p) => ({
                path: p,
                signedUrl: `https://store.example/s/${p}?token=t`,
                error: null
              })),
            error: null
          }
        },
        createSignedUrl: async (path: string) => {
          calls.push({ fn: `sign:${bucket}`, args: { path } })
          return {
            data: { signedUrl: `https://store.example/s/${path}?token=t` },
            error: null
          }
        },
        createSignedUploadUrl: async (path: string) => {
          calls.push({ fn: `upload:${bucket}`, args: { path } })
          return {
            data: { signedUrl: `https://store.example/u/${path}?token=t` },
            error: null
          }
        }
      })
    }
  }
  return { db: db as never, calls }
}

const followed: Rows = {
  competitor_emails: [
    {
      id: 'e1',
      capture_id: 'pine',
      inbox_message_id: message,
      synthetic: false
    }
  ],
  competitor_subscriptions: [{ capture_id: 'pine', tenant_id: tenant }],
  competitor_hidden: [],
  brand_profiles: [{ synthetic: false, tenant_id: tenant }],
  competitor_captures: [
    { id: 'pine', brand_name: 'Pine & Co', domain: 'pine.example' }
  ]
}

describe('which inspiration email a brand may copy (DES-ENGINE-002b2)', () => {
  it('one of a brand it follows, with the other brand’s names for the leak check', async () => {
    const { db } = fakeDb({ rows: followed })
    expect(await visibleEmail(db, tenant, 'e1')).toEqual({
      ok: true,
      messageId: message,
      sourceNames: ['Pine & Co', 'pine.example']
    })
  })

  it('never one of a brand it hid, does not follow, or an email that is gone', async () => {
    expect(
      await visibleEmail(
        fakeDb({
          rows: {
            ...followed,
            competitor_hidden: [{ capture_id: 'pine', tenant_id: tenant }]
          }
        }).db,
        tenant,
        'e1'
      )
    ).toEqual({ ok: false })
    expect(
      await visibleEmail(
        fakeDb({ rows: { ...followed, competitor_subscriptions: [] } }).db,
        tenant,
        'e1'
      )
    ).toEqual({ ok: false })
    expect(
      await visibleEmail(fakeDb({ rows: followed }).db, tenant, 'gone')
    ).toEqual({ ok: false })
  })

  it('a sample brand’s email only for a sample workspace', async () => {
    const sample = (workspace: boolean) =>
      fakeDb({
        rows: {
          ...followed,
          competitor_emails: [
            { ...followed.competitor_emails![0]!, synthetic: true }
          ],
          competitor_subscriptions: [],
          brand_profiles: [{ synthetic: workspace, tenant_id: tenant }]
        }
      }).db
    expect((await visibleEmail(sample(true), tenant, 'e1')).ok).toBe(true)
    expect((await visibleEmail(sample(false), tenant, 'e1')).ok).toBe(false)
  })

  it('the blueprint port says each state in plain words, and never asks for an email it may not see', async () => {
    const hidden = fakeDb({
      rows: {
        ...followed,
        competitor_hidden: [{ capture_id: 'pine', tenant_id: tenant }]
      }
    })
    const ports = libraryPortsFor(hidden.db, { tenant, build, lease })
    expect(await ports.blueprint('e1')).toEqual({
      state: 'unusable',
      reason: 'you no longer follow its brand, or you hid it in Inspiration'
    })
    expect(hidden.calls).toEqual([])
    const states = async (answer: string, rows: Rows = {}) =>
      libraryPortsFor(
        fakeDb({
          rows: { ...followed, ...rows },
          rpc: { request_inbox_blueprint: { data: answer } }
        }).db,
        { tenant, build, lease }
      ).blueprint('e1')
    expect(await states('waiting')).toEqual({ state: 'waiting' })
    expect(await states('none')).toEqual({
      state: 'unusable',
      reason: 'it has no stored copy that can be measured'
    })
    expect(await states('unphotographed')).toEqual({
      state: 'unusable',
      reason: expect.stringContaining('no screenshot')
    })
    expect(
      await states('ready', {
        inbox_blueprints: [{ state: 'ready', blueprint: blueprint() }]
      })
    ).toEqual({
      state: 'ready',
      messageId: message,
      sourceNames: ['Pine & Co', 'pine.example']
    })
    expect(
      await states('ready', {
        inbox_blueprints: [
          { state: 'failed', blueprint: null, failure: 'too_tall' }
        ]
      })
    ).toMatchObject({ state: 'unusable' })
  })
})

const input = {
  brand: {
    name: 'Cedar Studio',
    site: 'https://cedar.example',
    ink: '#111111',
    background: '#ffffff',
    accent: '#2f4a3a',
    dark: '#1d2a22',
    headingFont: 'Poppins',
    bodyFont: 'Poppins',
    logo: null
  },
  products: [],
  words: { headline: ['Hi'], body: [], button: [] },
  rules: { offer: null, maxDiscountPercent: 0 },
  vocabulary: ['Cedar Studio'],
  sourceNames: ['Pine & Co'],
  mode: 'klaviyo'
} as CopyInput

const record = (over: Partial<CopyRecord> = {}): CopyRecord => ({
  html: '<img src="https://email-copies.invalid/0.jpg" alt="Cedar candle"><img src="https://email-copies.invalid/1.jpg" alt="Cedar candle">',
  sections: [{ ordinal: 1, kind: 'hero', result: 'copied', reason: null }],
  pass: true,
  leaks: [],
  footerAdded: false,
  photos: [0, 1],
  ...over
})

describe('the copy port (DES-ENGINE-002b2)', () => {
  it('asks for the copy once, under the build’s lease, and reads it queued', async () => {
    const { db, calls } = fakeDb({
      rpc: { request_email_copy: { data: { state: 'queued' } } }
    })
    const port = libraryPortsFor(db, { tenant, build, lease })
    expect(await port.copy(message, input, 10)).toEqual({ state: 'queued' })
    expect(calls).toEqual([
      {
        fn: 'request_email_copy',
        args: { build, lease, message, input, photos: 10 }
      }
    ])
  })

  it('signs a done copy’s cut photos for a year in the workspace’s own folder', async () => {
    const { db, calls } = fakeDb({
      rpc: {
        request_email_copy: { data: { state: 'done', result: record() } }
      }
    })
    const got = await libraryPortsFor(db, { tenant, build, lease }).copy(
      message,
      input,
      10
    )
    expect(calls[1]).toEqual({
      fn: 'sign:email-copies',
      args: {
        paths: [`${tenant}/${build}/0.jpg`, `${tenant}/${build}/1.jpg`],
        seconds: copyPhotoLinkSeconds
      }
    })
    expect(copyPhotoLinkSeconds).toBe(365 * 24 * 3600)
    expect(got.state).toBe('done')
    if (got.state !== 'done') return
    expect(got.record.html).not.toContain('email-copies.invalid')
    expect(got.record.html).toContain(
      `https://store.example/s/${tenant}/${build}/1.jpg?token=t`
    )
  })

  it('a placeholder with no stored photo, or an unreadable record, is a failed copy', async () => {
    const left = fakeDb({
      rpc: {
        request_email_copy: {
          data: { state: 'done', result: record({ photos: [0] }) }
        }
      }
    })
    expect(
      await libraryPortsFor(left.db, { tenant, build, lease }).copy(
        message,
        input,
        10
      )
    ).toEqual({ state: 'failed', reason: copyFailures.copy_failed })
    const odd = fakeDb({
      rpc: { request_email_copy: { data: { state: 'done', result: {} } } }
    })
    expect(
      await libraryPortsFor(odd.db, { tenant, build, lease }).copy(
        message,
        input,
        10
      )
    ).toEqual({ state: 'failed', reason: copyFailures.copy_failed })
  })

  it('a failed copy says why; a lost lease throws (the step is tried again)', async () => {
    const failed = fakeDb({
      rpc: {
        request_email_copy: {
          data: { state: 'failed', failure: 'copy_job_failed' }
        }
      }
    })
    expect(
      await libraryPortsFor(failed.db, { tenant, build, lease }).copy(
        message,
        input,
        10
      )
    ).toEqual({ state: 'failed', reason: copyFailures.copy_job_failed })
    const gone = fakeDb({
      rpc: {
        request_email_copy: {
          error: { code: 'PT409', details: 'no_blueprint' }
        }
      }
    })
    expect(
      await libraryPortsFor(gone.db, { tenant, build, lease }).copy(
        message,
        input,
        10
      )
    ).toEqual({ state: 'failed', reason: copyFailures.blueprint_gone })
    const lost = fakeDb({
      rpc: {
        request_email_copy: {
          error: { code: 'PT409', message: 'Lease unavailable' }
        }
      }
    })
    await expect(
      libraryPortsFor(lost.db, { tenant, build, lease }).copy(
        message,
        input,
        10
      )
    ).rejects.toMatchObject({ code: 'PT409' })
  })

  it('never stores an input the browser job could not read', async () => {
    const { db, calls } = fakeDb({})
    expect(
      await libraryPortsFor(db, { tenant, build, lease }).copy(
        message,
        { ...input, vocabulary: 'x' } as never,
        10
      )
    ).toEqual({ state: 'failed', reason: copyFailures.input_invalid })
    expect(calls).toEqual([])
  })

  it('replaces every copy of a placeholder', () => {
    expect(
      withPhotoLinks(
        'a https://email-copies.invalid/0.jpg b https://email-copies.invalid/0.jpg',
        new Map([[0, 'https://x/0']])
      )
    ).toBe('a https://x/0 b https://x/0')
  })
})

const queued = {
  build_id: build,
  tenant_id: tenant,
  inbox_message_id: message,
  state: 'queued',
  input,
  photos: 3
}
const handOutRows: Rows = {
  email_copies: [queued],
  email_builds: [{ id: build, state: 'build_queued', step: 'design' }],
  inbox_blueprints: [{ state: 'ready', blueprint: blueprint() }],
  inbox_messages: [{ marked_html_path: 'marked/m1.html' }]
}
const claimed = {
  claim_email_copy: {
    data: [{ id: job, subject_key: build, lease_token: lease, attempt: 1 }]
  }
}

describe('the copy browser job’s side in the app (DES-ENGINE-002b2)', () => {
  it('hands out one copy: its input, the blueprint, a short link to the original and upload links in the workspace’s folder', async () => {
    const { db, calls } = fakeDb({ rows: handOutRows, rpc: claimed })
    const got = await copyJobs(db, ENGINE_VERSION)
    expect(got.skew).toBe(false)
    expect(got.jobs).toHaveLength(1)
    const j = got.jobs[0]!
    expect(j).toMatchObject({ job, lease, engine: ENGINE_VERSION, input })
    expect(j.html).toContain('marked/m1.html')
    expect(j.uploads.map((u) => u.index)).toEqual([0, 1, 2])
    expect(
      calls.filter((c) => c.fn === 'upload:email-copies').map((c) => c.args)
    ).toEqual([0, 1, 2].map((i) => ({ path: `${tenant}/${build}/${i}.jpg` })))
    // The photo hosts are the server's own fixed list, never the store's.
    expect(j.origins).toContain('https://cdn.shopify.com')
    expect(j.origins).not.toContain('https://cedar.example')
  })

  it('claims nothing for a browser on another engine version', async () => {
    const { db, calls } = fakeDb({ rows: handOutRows, rpc: claimed })
    expect(await copyJobs(db, 'old')).toEqual({ jobs: [], skew: true })
    expect(calls).toEqual([])
  })

  it.each([
    [
      'the build moved on',
      { email_builds: [{ id: build, state: 'drafted' }] },
      'build_moved_on'
    ],
    [
      'the input is unreadable',
      { email_copies: [{ ...queued, input: {} }] },
      'input_invalid'
    ],
    ['the blueprint is gone', { inbox_blueprints: [] }, 'blueprint_gone'],
    [
      'the original is gone',
      { inbox_messages: [{ marked_html_path: null }] },
      'source_missing'
    ]
  ])('records a copy that can never be made: %s', async (_, rows, failure) => {
    const { db, calls } = fakeDb({
      rows: { ...handOutRows, ...rows },
      rpc: claimed
    })
    expect((await copyJobs(db, ENGINE_VERSION)).jobs).toEqual([])
    expect(calls.at(-1)).toEqual({
      fn: 'record_email_copy',
      args: { job, lease, failure }
    })
  })

  it('records a copy, a final failure, or a try again; another engine version hands the job back', async () => {
    const done = fakeDb({ rpc: { record_email_copy: { data: 'done' } } })
    expect(
      await finishCopy(
        done.db,
        copyResult.parse({
          job,
          lease,
          engine: ENGINE_VERSION,
          record: record()
        })
      )
    ).toEqual({ ok: true, state: 'done' })
    expect(done.calls[0]).toEqual({
      fn: 'record_email_copy',
      args: { job, lease, result: record() }
    })
    const again = fakeDb({})
    await finishCopy(
      again.db,
      copyResult.parse({ job, lease, retry: 'timeout' })
    )
    expect(again.calls[0]).toEqual({
      fn: 'fail_platform_job',
      args: { job, lease, failure: 'timeout', error_code: 'timeout' }
    })
    const skew = fakeDb({})
    await finishCopy(
      skew.db,
      copyResult.parse({ job, lease, engine: 'old', failure: 'copy_failed' })
    )
    expect(skew.calls[0]).toEqual({
      fn: 'release_email_copy',
      args: { job, lease }
    })
    const refused = fakeDb({
      rpc: { record_email_copy: { error: { code: '23514' } } }
    })
    expect(
      await finishCopy(
        refused.db,
        copyResult.parse({
          job,
          lease,
          engine: ENGINE_VERSION,
          record: record()
        })
      )
    ).toEqual({ ok: false, code: '23514' })
  })

  it('refuses a result of the wrong shape', () => {
    for (const bad of [
      { job, lease, engine: ENGINE_VERSION, failure: 'leaked' },
      { job: 'x', lease, retry: 'timeout' },
      {
        job,
        lease,
        engine: ENGINE_VERSION,
        record: { ...record(), photos: [30] }
      }
    ])
      expect(copyResult.safeParse(bad).success).toBe(false)
  })

  it('carries on only the builds whose copies are in, with the switch on', async () => {
    const rows: Rows = {
      email_copies: [{ build_id: build, state: 'done' }],
      email_builds: [{ id: build, state: 'build_queued', step: 'design' }]
    }
    expect(
      await runCopiedBuilds(fakeDb({ rows }).db, {
        deadline: Date.now() + 60_000,
        env: {}
      })
    ).toEqual({ off: true, builds: 0, ran: 0 })
    expect(
      await runCopiedBuilds(fakeDb({ rows }).db, {
        deadline: Date.now() + 60_000,
        env: { DESIGN_LIBRARY_COPY: 'on' }
      })
    ).toEqual({ off: false, builds: 1, ran: 1 })
    expect(runEmailBuilds).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ build, library: true })
    )
  })
})
