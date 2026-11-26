// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/server', () => ({ after: vi.fn() }))
import { checkEmailSoon, resultsSourceFor } from './live'

type Db = Parameters<typeof resultsSourceFor>[0]
const env = (vars: Record<string, string>) =>
  vars as unknown as NodeJS.ProcessEnv
function database(
  connection: { mode: string; status: string } | null,
  key: string | null = 'pk_SAMPLE0123456789abcdefghij'
) {
  const rpc = vi.fn(async () => ({ data: key, error: null }))
  const q = {
    select: () => q,
    eq: () => q,
    maybeSingle: async () => ({ data: connection, error: null })
  }
  return { db: { from: () => q, rpc } as unknown as Db, rpc }
}
const liveOn = env({ KLAVIYO_MODE: 'live' })

describe('which Klaviyo a workspace’s drafts are read in', () => {
  it('reads nothing live until the owner’s switch is on', async () => {
    const { db, rpc } = database({ mode: 'live', status: 'connected' })
    expect(await resultsSourceFor(db, 't1', env({}))).toEqual({
      kind: 'off',
      reason: 'klaviyo_off'
    })
    expect(
      await resultsSourceFor(
        db,
        't1',
        env({ KLAVIYO_MODE: 'live', KLAVIYO_API_REVISION: '2020-01-01' })
      )
    ).toEqual({ kind: 'off', reason: 'klaviyo_revision' })
    // The key is never even read.
    expect(rpc).not.toHaveBeenCalled()
  })

  it('reads only a workspace still connected live, with its stored key', async () => {
    for (const connection of [
      null,
      { mode: 'sample', status: 'connected' },
      { mode: 'live', status: 'disconnected' }
    ])
      expect(
        await resultsSourceFor(database(connection).db, 't1', liveOn)
      ).toEqual({ kind: 'off', reason: 'klaviyo_not_connected' })
    expect(
      await resultsSourceFor(
        database({ mode: 'live', status: 'connected' }, null).db,
        't1',
        liveOn
      )
    ).toEqual({ kind: 'off', reason: 'klaviyo_no_key' })
    const { db, rpc } = database({ mode: 'live', status: 'connected' })
    expect((await resultsSourceFor(db, 't1', liveOn)).kind).toBe('live')
    expect(rpc).toHaveBeenCalledWith('klaviyo_api_key', { t: 't1' })
  })
})

describe('the email page’s check (PICK-99)', () => {
  it('never holds the page: it is scheduled after the response, and the page goes on at once', () => {
    const { db, rpc } = database({ mode: 'live', status: 'connected' })
    const tasks: (() => Promise<unknown>)[] = []
    const started = Date.now()
    checkEmailSoon(db, 't1', 'b1', (task) => {
      tasks.push(task)
    })
    // Nothing ran yet: no claim, no Klaviyo; the page renders what is stored.
    expect(tasks).toHaveLength(1)
    expect(rpc).not.toHaveBeenCalled()
    expect(Date.now() - started).toBeLessThan(50)
  })

  it('without a service client, schedules nothing', () => {
    const schedule = vi.fn()
    checkEmailSoon(null, 't1', 'b1', schedule)
    expect(schedule).not.toHaveBeenCalled()
  })
})
