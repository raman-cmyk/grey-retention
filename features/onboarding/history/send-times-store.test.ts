// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import {
  readSendTimes,
  recordSendTimes,
  sendTimesFreshDays
} from './send-times-store'
import { sendTimes } from './send-times'

const tenantId = '00000000-0000-4000-8000-000000000101'
const now = new Date('2026-11-26T12:00:00Z')
const day = 86_400_000
const entries = sendTimes(
  ['2026-11-02', '2026-11-03', '2026-11-04'].map((d) => ({
    sentAt: `${d}T14:00:00Z`,
    strategy: 'static' as const,
    recipients: 1000,
    opens: 300,
    clicks: 20,
    audienceIds: ['SegA']
  })),
  'America/New_York',
  now.getTime()
)
const row = (e: (typeof entries)[number], readAt: string) => ({
  audience_id: e.audienceId,
  facts: e.facts,
  best_hour: e.bestHour,
  best_weekday: e.bestWeekday,
  rivals: e.rivals,
  compared: e.compared,
  reason: e.reason,
  timezone: 'America/New_York',
  live: true,
  read_at: readAt
})

/** A database answering one select of `klaviyo_send_times`. */
function database(rows: unknown[], error: unknown = null) {
  const filters: [string, unknown][] = []
  const chain = {
    select: () => chain,
    eq: (c: string, v: unknown) => (filters.push([c, v]), chain),
    limit: async () => ({ data: error ? null : rows, error })
  }
  const rpc = vi.fn(async () => ({ data: 2, error: null }))
  return {
    filters,
    rpc,
    db: {
      from: (table: string) => {
        expect(table).toBe('klaviyo_send_times')
        return chain
      },
      rpc
    } as never
  }
}

describe('readSendTimes (PICK-97)', () => {
  it('reads this workspace’s rows, checked on the way out', async () => {
    const at = new Date(now.getTime() - day).toISOString()
    const { db, filters } = database(entries.map((e) => row(e, at)))
    const read = await readSendTimes(db, tenantId, now)
    expect(filters).toEqual([['tenant_id', tenantId]])
    expect(read).toEqual({
      entries,
      timezone: 'America/New_York',
      live: true,
      readAt: at
    })
  })

  it('drops a row of a shape this version does not know, keeping the rest', async () => {
    const at = new Date(now.getTime() - day).toISOString()
    const odd = [
      { ...row(entries[1]!, at), best_hour: 23 },
      { ...row(entries[1]!, at), audience_id: 'bad id' },
      { ...row(entries[1]!, at), facts: { sends: 'three' } },
      { ...row(entries[1]!, at), reason: 'guess' }
    ]
    const { db } = database([row(entries[0]!, at), ...odd])
    expect((await readSendTimes(db, tenantId, now))!.entries).toEqual([
      entries[0]
    ])
  })

  it(`is none when nothing was kept, older than ${sendTimesFreshDays} days, or from the future`, async () => {
    expect(await readSendTimes(database([]).db, tenantId, now)).toBeNull()
    const old = new Date(
      now.getTime() - (sendTimesFreshDays * day + 60_000)
    ).toISOString()
    expect(
      await readSendTimes(
        database(entries.map((e) => row(e, old))).db,
        tenantId,
        now
      )
    ).toBeNull()
    const ahead = new Date(now.getTime() + 5 * 60_000).toISOString()
    expect(
      await readSendTimes(
        database(entries.map((e) => row(e, ahead))).db,
        tenantId,
        now
      )
    ).toBeNull()
    // Just inside the window still counts.
    const edge = new Date(
      now.getTime() - (sendTimesFreshDays * day - 60_000)
    ).toISOString()
    expect(
      await readSendTimes(
        database(entries.map((e) => row(e, edge))).db,
        tenantId,
        now
      )
    ).not.toBeNull()
  })

  it('throws a failed read (the planner then changes no time)', async () => {
    await expect(
      readSendTimes(database([], { code: 'XX000' }).db, tenantId, now)
    ).rejects.toMatchObject({ code: 'XX000' })
  })
})

describe('recordSendTimes (PICK-97)', () => {
  it('sends only valid rows to the worker-only command, under the job’s lease', async () => {
    const { db, rpc } = database([])
    const bad = { ...entries[1]!, bestHour: 3 }
    expect(
      await recordSendTimes(
        db,
        { id: 'job-1', lease: 'lease-1' },
        'America/New_York',
        [...entries, bad]
      )
    ).toBe(2)
    expect(rpc).toHaveBeenCalledWith('record_send_times', {
      job: 'job-1',
      lease: 'lease-1',
      timezone: 'America/New_York',
      times: entries
    })
  })

  it('throws what the database refused', async () => {
    const db = {
      rpc: async () => ({ data: null, error: { code: 'PT409' } })
    } as never
    await expect(
      recordSendTimes(db, { id: 'j', lease: 'l' }, 'UTC', entries)
    ).rejects.toMatchObject({ code: 'PT409' })
  })
})
