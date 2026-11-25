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
const {
  cleanCopyPhotos,
  copiesWaiting,
  copyJobs,
  copyResult,
  finishCopy,
  runCopiedBuilds
} = await import('./copy-jobs')
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
  /** Stored objects by folder: name, tag, size (`list`). */
  files?: Record<
    string,
    { name: string; id: string | null; eTag?: string; size?: number }[]
  >
  /** Files `download` reads, by path. */
  texts?: Record<string, string>
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
        lt: () => q,
        is: () => q,
        neq: (c: string, v: unknown) => {
          rows = rows.filter((r) => !(c in r) || r[c] !== v)
          return q
        },
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
        list: async (folder: string) => {
          calls.push({ fn: `list:${bucket}`, args: { folder } })
          return {
            data: (answers.files?.[folder] ?? []).map((f) => ({
              name: f.name,
              id: f.id,
              metadata: { eTag: f.eTag, size: f.size }
            })),
            error: null
          }
        },
        download: async (path: string) => {
          calls.push({ fn: `download:${bucket}`, args: { path } })
          const text = answers.texts?.[path]
          return text === undefined
            ? { data: null, error: { message: 'missing' } }
            : { data: new Blob([text]), error: null }
        },
        remove: async (paths: string[]) => {
          calls.push({ fn: `remove:${bucket}`, args: { paths } })
          return { data: [], error: null }
        },
        createSignedUploadUrl: async (path: string, options?: unknown) => {
          calls.push({ fn: `upload:${bucket}`, args: { path, options } })
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

  const claimLease = '00000000-0000-4000-8000-0000000000e1'
  const folder = `${tenant}/${build}/${claimLease}`
  const pinnedRecord = (over: Partial<CopyRecord> = {}) => ({
    ...record(over),
    stored: [0, 1].map((index) => ({
      index,
      path: `${folder}/${index}.jpg`,
      etag: `"e${index}"`,
      size: 1000 + index
    }))
  })
  const storedFiles = {
    [folder]: [0, 1].map((i) => ({
      name: `${i}.jpg`,
      id: `f${i}`,
      eTag: `"e${i}"`,
      size: 1000 + i
    }))
  }

  it('signs a done copy’s pinned photos for 30 days, after checking each is still the one recorded', async () => {
    const { db, calls } = fakeDb({
      rpc: {
        request_email_copy: { data: { state: 'done', result: pinnedRecord() } }
      },
      files: storedFiles
    })
    const got = await libraryPortsFor(db, { tenant, build, lease }).copy(
      message,
      input,
      10
    )
    expect(calls[1]).toEqual({ fn: 'list:email-copies', args: { folder } })
    expect(calls[2]).toEqual({
      fn: 'sign:email-copies',
      args: {
        paths: [`${folder}/0.jpg`, `${folder}/1.jpg`],
        seconds: copyPhotoLinkSeconds
      }
    })
    expect(copyPhotoLinkSeconds).toBe(30 * 24 * 3600)
    expect(got.state).toBe('done')
    if (got.state !== 'done') return
    expect(got.record.html).not.toContain('email-copies.invalid')
    expect(got.record.html).toContain(
      `https://store.example/s/${folder}/1.jpg?token=t`
    )
  })

  it('never signs a photo that changed or went after the copy was recorded, or one outside the build’s folder', async () => {
    const changed = fakeDb({
      rpc: {
        request_email_copy: { data: { state: 'done', result: pinnedRecord() } }
      },
      files: {
        [folder]: [
          { name: '0.jpg', id: 'f0', eTag: '"e0"', size: 1000 },
          { name: '1.jpg', id: 'f1', eTag: '"other"', size: 1001 }
        ]
      }
    })
    expect(
      await libraryPortsFor(changed.db, { tenant, build, lease }).copy(
        message,
        input,
        10
      )
    ).toEqual({ state: 'failed', reason: copyFailures.photo_changed })
    expect(changed.calls.some((c) => c.fn === 'sign:email-copies')).toBe(false)
    const gone = fakeDb({
      rpc: {
        request_email_copy: { data: { state: 'done', result: pinnedRecord() } }
      },
      files: {}
    })
    expect(
      await libraryPortsFor(gone.db, { tenant, build, lease }).copy(
        message,
        input,
        10
      )
    ).toEqual({ state: 'failed', reason: copyFailures.photo_changed })
    const other = '00000000-0000-4000-8000-0000000000c9'
    const elsewhere = fakeDb({
      rpc: {
        request_email_copy: {
          data: {
            state: 'done',
            result: {
              ...pinnedRecord(),
              stored: pinnedRecord().stored.map((p) => ({
                ...p,
                path: p.path.replace(build, other)
              }))
            }
          }
        }
      },
      files: storedFiles
    })
    expect(
      await libraryPortsFor(elsewhere.db, { tenant, build, lease }).copy(
        message,
        input,
        10
      )
    ).toEqual({ state: 'failed', reason: copyFailures.copy_failed })
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
  inbox_messages: [{ marked_html_path: 'marked/m1.html' }],
  platform_jobs: [{ id: job, kind: 'design.copy', subject_key: build }]
}
const claimed = {
  claim_email_copy: {
    data: [{ id: job, subject_key: build, lease_token: lease, attempt: 1 }]
  }
}
const on = { DESIGN_LIBRARY_COPY: 'on' }

describe('the copy browser job’s side in the app (DES-ENGINE-002b2)', () => {
  it('hands out one copy: its input, the blueprint, a short link to the original and upload links in its own claim’s folder that never overwrite', async () => {
    const { db, calls } = fakeDb({ rows: handOutRows, rpc: claimed })
    const got = await copyJobs(db, ENGINE_VERSION, on)
    expect(got.skew).toBe(false)
    expect(got.jobs).toHaveLength(1)
    const j = got.jobs[0]!
    expect(j).toMatchObject({ job, lease, engine: ENGINE_VERSION, input })
    expect(j.html).toContain('marked/m1.html')
    expect(j.uploads.map((u) => u.index)).toEqual([0, 1, 2])
    expect(
      calls.filter((c) => c.fn === 'upload:email-copies').map((c) => c.args)
    ).toEqual(
      [0, 1, 2].map((i) => ({
        path: `${tenant}/${build}/${lease}/${i}.jpg`,
        options: undefined
      }))
    )
    // The photo hosts are the server's own fixed list, never the store's.
    expect(j.origins).toContain('https://cdn.shopify.com')
    expect(j.origins).not.toContain('https://cedar.example')
  })

  it('claims nothing with the switch off, or for a browser on another engine version', async () => {
    const { db, calls } = fakeDb({ rows: handOutRows, rpc: claimed })
    expect(await copyJobs(db, ENGINE_VERSION, {})).toEqual({
      jobs: [],
      skew: false,
      off: true
    })
    expect(await copiesWaiting(db, {})).toBe(0)
    expect(await copyJobs(db, 'old', on)).toEqual({ jobs: [], skew: true })
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
    expect((await copyJobs(db, ENGINE_VERSION, on)).jobs).toEqual([])
    expect(calls.at(-1)).toEqual({
      fn: 'record_email_copy',
      args: { job, lease, failure }
    })
  })

  const original =
    '<table><tr><td><p>Pine and Co summer edit for everyone</p></td></tr></table>'
  const clean = {
    rows: handOutRows,
    texts: { 'marked/m1.html': original }
  }

  it('checks the copy for leaks again itself before recording it', async () => {
    const done = fakeDb({
      ...clean,
      rpc: { record_email_copy: { data: 'done' } }
    })
    const ok = record({
      html: '<p>Cedar Studio</p>',
      photos: []
    })
    expect(
      await finishCopy(
        done.db,
        copyResult.parse({ job, lease, engine: ENGINE_VERSION, record: ok })
      )
    ).toEqual({ ok: true, state: 'done' })
    expect(done.calls).toContainEqual({
      fn: 'download:inbox-raw',
      args: { path: 'marked/m1.html' }
    })
    expect(done.calls.at(-1)).toEqual({
      fn: 'record_email_copy',
      args: { job, lease, result: ok }
    })
    // The browser job said no leak; the app finds the other brand's words.
    const leaked = fakeDb({
      ...clean,
      rpc: { record_email_copy: { data: 'failed' } }
    })
    await finishCopy(
      leaked.db,
      copyResult.parse({
        job,
        lease,
        engine: ENGINE_VERSION,
        record: record({
          html: '<p>Cedar Studio summer edit for everyone</p>',
          photos: []
        })
      })
    )
    expect(leaked.calls.at(-1)).toEqual({
      fn: 'record_email_copy',
      args: { job, lease, failure: 'copy_leaked' }
    })
    expect(copyFailures.copy_leaked).toContain('other brand')
    // The original cannot be read now: nothing is recorded (tried later).
    const unreadable = fakeDb({ rows: handOutRows })
    expect(
      await finishCopy(
        unreadable.db,
        copyResult.parse({ job, lease, engine: ENGINE_VERSION, record: ok })
      )
    ).toEqual({ ok: false, code: 'leak_check_unavailable' })
    expect(unreadable.calls.some((c) => c.fn === 'record_email_copy')).toBe(
      false
    )
  })

  it('records a final failure or a try again; another engine version hands the job back', async () => {
    const again = fakeDb({})
    await finishCopy(
      again.db,
      copyResult.parse({ job, lease, retry: 'engine_error' })
    )
    expect(again.calls[0]).toEqual({
      fn: 'fail_platform_job',
      args: { job, lease, failure: 'protocol', error_code: 'engine_error' }
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
          failure: 'copy_failed'
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
    ).toEqual({ off: true, builds: 0, ran: 0, cleaned: 0 })
    expect(
      await runCopiedBuilds(fakeDb({ rows }).db, {
        deadline: Date.now() + 60_000,
        env: on
      })
    ).toMatchObject({ off: false, builds: 1, ran: 1 })
    expect(runEmailBuilds).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ build, library: true })
    )
  })

  it('removes the photos no email needs, once, and keeps those a drafted copy still shows', async () => {
    const other = '00000000-0000-4000-8000-0000000000c2'
    const kept = '00000000-0000-4000-8000-0000000000c3'
    const at = new Date().toISOString()
    const { db, calls } = fakeDb({
      rows: {
        email_copies: [
          { build_id: build, tenant_id: tenant, state: 'done', updated_at: at },
          {
            build_id: other,
            tenant_id: tenant,
            state: 'failed',
            updated_at: at
          },
          { build_id: kept, tenant_id: tenant, state: 'done', updated_at: at }
        ],
        email_builds: [
          // Drawn with coded blocks instead: its copy is not needed.
          { id: build, state: 'drafted', library: null },
          { id: other, state: 'drafted', library: null },
          // The copy is the email: kept for its 30 days.
          { id: kept, state: 'drafted', library: { sections: [] } }
        ]
      },
      files: {
        [`${tenant}/${build}`]: [{ name: lease, id: null }],
        [`${tenant}/${build}/${lease}`]: [{ name: '0.jpg', id: 'f0' }]
      }
    })
    expect(await cleanCopyPhotos(db)).toBe(2)
    expect(calls).toContainEqual({
      fn: 'remove:email-copies',
      args: { paths: [`${tenant}/${build}/${lease}/0.jpg`] }
    })
    expect(
      calls.filter((c) => c.fn === 'clean_email_copy').map((c) => c.args)
    ).toEqual([{ build }, { build: other }])
  })
})
