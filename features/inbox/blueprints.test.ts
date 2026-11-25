import { describe, expect, it, vi } from 'vitest'
import { blueprint } from '@/features/design-engine/fixtures'
import { ENGINE_VERSION, forStorage } from '@/features/design-engine/stored'

vi.mock('server-only', () => ({}))

const {
  blueprintGaveUp,
  blueprintResult,
  finishBlueprint,
  inspirationBlueprint
} = await import('./blueprints')

const job = '00000000-0000-4000-8000-0000000000a1'
const lease = '00000000-0000-4000-8000-0000000000b1'
const engine = ENGINE_VERSION

/** A database that records RPCs and answers rows by table. */
function fakeDb(answers: {
  rpc?: Record<string, unknown>
  rows?: Record<string, unknown>
}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = []
  const db = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args })
      return { data: answers.rpc?.[fn] ?? null, error: null }
    },
    from: (table: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({
          data: answers.rows?.[table] ?? null,
          error: null
        })
      }
      return q
    }
  }
  return { db: db as never, calls }
}

const retried = (code: string) => ({
  fn: 'fail_platform_job',
  args: {
    job,
    lease,
    failure: code === 'timeout' ? 'timeout' : 'protocol',
    error_code: code
  }
})

describe('blueprint results', () => {
  it('stores a blueprint without its pictures and links, checked again', async () => {
    const { db, calls } = fakeDb({ rpc: { record_inbox_blueprint: 'ready' } })
    const parsed = blueprintResult.parse({
      job,
      lease,
      engine,
      blueprint: blueprint()
    })
    expect(await finishBlueprint(db, parsed)).toEqual({
      ok: true,
      state: 'ready'
    })
    expect(calls[0]!.fn).toBe('record_inbox_blueprint')
    expect(calls[0]!.args.blueprint).toEqual(forStorage(blueprint()))
    expect(JSON.stringify(calls[0]!.args.blueprint)).not.toMatch(
      /"(src|href)":"/
    )
  })

  it('a final failure from the measuring job is stored', async () => {
    const { db, calls } = fakeDb({ rpc: { record_inbox_blueprint: 'failed' } })
    await finishBlueprint(
      db,
      blueprintResult.parse({ job, lease, engine, failure: 'too_tall' })
    )
    expect(calls[0]!.args).toEqual({ job, lease, failure: 'too_tall' })
  })

  it('a blueprint this app refuses is tried again, never stored as failed', async () => {
    const { db, calls } = fakeDb({})
    expect(
      await finishBlueprint(
        db,
        blueprintResult.parse({ job, lease, engine, blueprint: { version: 9 } })
      )
    ).toEqual({ ok: true, state: 'retry' })
    expect(calls).toEqual([retried('app_not_valid')])
  })

  it('a job measured with another engine version is tried again', async () => {
    const { db, calls } = fakeDb({})
    await finishBlueprint(
      db,
      blueprintResult.parse({
        job,
        lease,
        engine: 'older',
        blueprint: blueprint()
      })
    )
    await finishBlueprint(
      db,
      blueprintResult.parse({
        job,
        lease,
        engine: 'older',
        failure: 'too_tall'
      })
    )
    expect(calls).toEqual([retried('version_skew'), retried('version_skew')])
  })

  it('a slow browser is tried again; an unknown reason or no version is refused', async () => {
    const { db, calls } = fakeDb({})
    await finishBlueprint(
      db,
      blueprintResult.parse({ job, lease, retry: 'timeout' })
    )
    expect(calls).toEqual([retried('timeout')])
    expect(
      blueprintResult.safeParse({ job, lease, engine, failure: 'whatever' })
        .success
    ).toBe(false)
    expect(
      blueprintResult.safeParse({ job, lease, blueprint: blueprint() }).success
    ).toBe(false)
    expect(blueprintResult.safeParse({ job, lease }).success).toBe(false)
  })
})

describe('an inspiration email’s blueprint for the build', () => {
  const email = '00000000-0000-4000-8000-0000000000c1'
  it('says it is waiting while the browser has not measured it', async () => {
    const { db } = fakeDb({ rpc: { request_inbox_blueprint: 'waiting' } })
    expect(await inspirationBlueprint(db, email)).toEqual({ state: 'waiting' })
  })
  it('reads a ready blueprint', async () => {
    const { db } = fakeDb({
      rpc: { request_inbox_blueprint: 'ready' },
      rows: {
        competitor_emails: { inbox_message_id: 'm1' },
        inbox_blueprints: {
          state: 'ready',
          blueprint: forStorage(blueprint()),
          failure: null
        }
      }
    })
    const got = await inspirationBlueprint(db, email)
    expect(got.state).toBe('ready')
  })
  it('gives a failure in plain words', async () => {
    const { db } = fakeDb({
      rpc: { request_inbox_blueprint: 'failed' },
      rows: {
        competitor_emails: { inbox_message_id: 'm1' },
        inbox_blueprints: {
          state: 'failed',
          blueprint: null,
          failure: 'too_tall'
        }
      }
    })
    expect(await inspirationBlueprint(db, email)).toEqual({
      state: 'failed',
      reason:
        'The email is taller than 16,000 px, the most that can be measured.'
    })
  })
  it('a job that failed four times (no row) reads as failed, never crashes', async () => {
    const { db } = fakeDb({
      rpc: { request_inbox_blueprint: 'failed' },
      rows: { competitor_emails: { inbox_message_id: 'm1' } }
    })
    expect(await inspirationBlueprint(db, email)).toEqual({
      state: 'failed',
      reason: blueprintGaveUp
    })
  })
})
