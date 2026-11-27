// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { cutBlocks } from '@/features/design-engine/blocks'
import { blueprint, section } from '@/features/design-engine/fixtures'
import { ENGINE_VERSION } from '@/features/design-engine/stored'

vi.mock('server-only', () => ({}))
const { blockJobs, blockRows, blockResult, finishBlocks } =
  await import('./jobs')

const job = '00000000-0000-4000-8000-0000000000a1'
const lease = '00000000-0000-4000-8000-0000000000b1'
const message = '00000000-0000-4000-8000-0000000000c1'

/** A fake database answering the job's calls. */
function fakeDb(o: {
  claim?: unknown[]
  known?: string[]
  stored?: unknown
  knownError?: boolean
}) {
  const calls: { fn: string; args: unknown }[] = []
  const rpc = vi.fn(async (fn: string, args?: unknown) => {
    calls.push({ fn, args })
    if (fn === 'claim_library_blocks')
      return { data: o.claim ?? [], error: null }
    if (fn === 'known_library_blocks')
      return o.knownError
        ? { data: null, error: { code: 'XX000' } }
        : { data: o.known ?? [], error: null }
    if (fn === 'record_library_blocks')
      return { data: { state: 'done' }, error: null }
    return { data: null, error: null }
  })
  const chain = (data: unknown) => {
    const c: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in']) c[m] = () => c
    c.maybeSingle = async () => ({ data, error: null })
    return c
  }
  const from = vi.fn((table: string) =>
    table === 'platform_jobs'
      ? chain({ subject_key: `inbox:${message}` })
      : chain(o.stored === undefined ? null : { blueprint: o.stored })
  )
  return { db: { rpc, from } as never, calls }
}

const twoAlike = blueprint({
  sections: [section({ ordinal: 1 }), section({ ordinal: 2 })]
})

describe('the block job, the app side (DES-ENGINE-004)', () => {
  it('hands out nothing to a browser on another engine version, claiming nothing', async () => {
    const { db, calls } = fakeDb({})
    expect(await blockJobs(db, 'old')).toEqual({ jobs: [], skew: true })
    expect(calls).toEqual([])
  })

  it('hands out each new structure once, on its own with its stored words', async () => {
    const { db, calls } = fakeDb({
      claim: [
        {
          id: job,
          subject_key: `inbox:${message}`,
          lease_token: lease,
          tenant_id: null,
          blueprint: twoAlike
        }
      ]
    })
    const got = await blockJobs(db, ENGINE_VERSION)
    expect(got.jobs).toHaveLength(1)
    expect(got.jobs[0]!.checks.map((c) => c.ordinal)).toEqual([1])
    expect(got.jobs[0]!.checks[0]!.blueprint.sections).toHaveLength(1)
    expect(calls.find((c) => c.fn === 'known_library_blocks')?.args).toEqual({
      t: null,
      prints: [cutBlocks(twoAlike).blocks[0]!.fingerprint]
    })
  })

  it('records at once, with no drawing, a source whose structures the library has', async () => {
    const print = cutBlocks(twoAlike).blocks[0]!.fingerprint
    const { db, calls } = fakeDb({
      claim: [
        {
          id: job,
          subject_key: `inbox:${message}`,
          lease_token: lease,
          tenant_id: null,
          blueprint: twoAlike
        }
      ],
      known: [print]
    })
    expect((await blockJobs(db, ENGINE_VERSION)).jobs).toEqual([])
    const recorded = calls.find((c) => c.fn === 'record_library_blocks')
    const blocks = (recorded?.args as { blocks: { quality: string }[] }).blocks
    expect(blocks.map((b) => b.quality)).toEqual(['passed', 'passed'])
  })

  it('puts a job back when the library cannot be read', async () => {
    const { db, calls } = fakeDb({
      claim: [
        {
          id: job,
          subject_key: `inbox:${message}`,
          lease_token: lease,
          tenant_id: null,
          blueprint: twoAlike
        }
      ],
      knownError: true
    })
    expect((await blockJobs(db, ENGINE_VERSION)).jobs).toEqual([])
    expect(calls.at(-1)?.fn).toBe('fail_platform_job')
  })

  it('takes quality from the size, the library or the browser, never a block from the browser', () => {
    const cut = cutBlocks(
      blueprint({
        sections: [
          section({ ordinal: 1 }),
          section({ ordinal: 2, kind: 'text', height: 4 }),
          section({ ordinal: 3, height: 300 }),
          section({ ordinal: 4, height: 700 })
        ]
      })
    )
    const [a, , c, d] = cut.blocks
    const rows = blockRows(
      cut,
      new Set([a!.fingerprint]),
      new Map([
        [c!.fingerprint, { pass: false, failure: 'not_drawn' as const }]
      ])
    )
    expect(rows.map((r) => [r.ordinal, r.quality, r.failure])).toEqual([
      [1, 'passed', null],
      [2, 'failed', 'too_small'],
      [3, 'failed', 'not_drawn'],
      [4, 'failed', 'not_checked']
    ])
    void d
    // The browser's report holds verdicts only.
    expect(
      blockResult.safeParse({
        job,
        lease,
        engine: ENGINE_VERSION,
        checks: [{ ordinal: 1, pass: true, blueprint: {} }]
      }).success
    ).toBe(true)
    const parsed = blockResult.parse({
      job,
      lease,
      engine: ENGINE_VERSION,
      checks: [{ ordinal: 1, pass: true, blueprint: {} }]
    })
    expect('blueprint' in (parsed as { checks: object[] }).checks[0]!).toBe(
      false
    )
  })

  it('finishes from the stored blueprint cut again, with the browser’s verdicts', async () => {
    const { db, calls } = fakeDb({ stored: twoAlike })
    const done = await finishBlocks(db, {
      job,
      lease,
      engine: ENGINE_VERSION,
      checks: [{ ordinal: 1, pass: true }]
    })
    expect(done).toEqual({ ok: true, state: 'done' })
    const args = calls.find((c) => c.fn === 'record_library_blocks')!.args as {
      blocks: { ordinal: number; quality: string }[]
    }
    expect(args.blocks.map((b) => [b.ordinal, b.quality])).toEqual([
      [1, 'passed'],
      [2, 'passed']
    ])
  })

  it('tries a result of another engine version again, recording nothing', async () => {
    const { db, calls } = fakeDb({ stored: twoAlike })
    expect(
      await finishBlocks(db, { job, lease, engine: 'old', checks: [] })
    ).toEqual({ ok: true, state: 'retry' })
    expect(calls.map((c) => c.fn)).toEqual(['fail_platform_job'])
  })
})
