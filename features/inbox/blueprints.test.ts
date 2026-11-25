import { describe, expect, it, vi } from 'vitest'
import { blueprint } from '@/features/design-engine/fixtures'
import { forStorage } from '@/features/design-engine/stored'

vi.mock('server-only', () => ({}))

const { blueprintResult, finishBlueprint, inspirationBlueprint } =
  await import('./blueprints')

const job = '00000000-0000-4000-8000-0000000000a1'
const lease = '00000000-0000-4000-8000-0000000000b1'

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
        single: async () => ({
          data: answers.rows?.[table] ?? null,
          error: null
        })
      }
      return q
    }
  }
  return { db: db as never, calls }
}

describe('blueprint results', () => {
  it('stores a blueprint without its pictures and links, checked again', async () => {
    const { db, calls } = fakeDb({ rpc: { record_inbox_blueprint: 'ready' } })
    const parsed = blueprintResult.parse({ job, lease, blueprint: blueprint() })
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

  it('a blueprint that is not valid is stored as failed, never as ready', async () => {
    const { db, calls } = fakeDb({ rpc: { record_inbox_blueprint: 'failed' } })
    await finishBlueprint(
      db,
      blueprintResult.parse({ job, lease, blueprint: { version: 9 } })
    )
    expect(calls[0]!.args).toEqual({ job, lease, failure: 'not_valid' })
  })

  it('a slow browser is tried again; an unknown reason is refused', async () => {
    const { db, calls } = fakeDb({})
    await finishBlueprint(
      db,
      blueprintResult.parse({ job, lease, retry: 'timeout' })
    )
    expect(calls[0]).toEqual({
      fn: 'fail_platform_job',
      args: { job, lease, failure: 'timeout', error_code: 'timeout' }
    })
    expect(
      blueprintResult.safeParse({ job, lease, failure: 'whatever' }).success
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
})
