// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))

const selects: string[] = []
let missingStep = false
let runOver: Record<string, unknown> = {}
let buildOver: Record<string, unknown> = {}
/** The push rows the plan reads (REL-084c), or an error. */
let pushes: { data: unknown; error: unknown } = { data: [], error: null }
const pushReads: unknown[][] = []
const run = {
  id: '00000000-0000-4000-8000-00000000e101',
  state: 'planned',
  error_code: null as string | null,
  start_on: '2099-01-01',
  pulse: null,
  plan: null
}
const build = {
  id: '00000000-0000-4000-8000-00000000b101',
  slot: 0,
  state: 'build_queued',
  sample_draft: false,
  error_code: null as string | null
}
/** A query that answers once it is awaited, whatever is chained before. */
const answer = (result: unknown) => {
  const query: Record<string, unknown> = {
    then: (done: (r: unknown) => unknown) => Promise.resolve(result).then(done)
  }
  for (const name of ['eq', 'order', 'limit', 'in'])
    query[name] = (...args: unknown[]) => {
      if (result === pushes) pushReads.push([name, ...args])
      return query
    }
  return query
}
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (table: string) => ({
      select: (columns: string) => {
        if (table === 'strategy_runs')
          return answer({ data: [{ ...run, ...runOver }], error: null })
        if (table === 'klaviyo_draft_pushes') {
          pushReads.push(['select', columns])
          return answer(pushes)
        }
        selects.push(columns)
        if (missingStep && columns.includes('step'))
          return answer({ data: null, error: { code: '42703' } })
        return answer({
          data: [
            missingStep ? build : { ...build, step: 'copy', ...buildOver }
          ],
          error: null
        })
      }
    })
  })
}))

const { latestPlanRun } = await import('./load')

beforeEach(() => {
  missingStep = false
  runOver = {}
  buildOver = {}
  pushes = { data: [], error: null }
  pushReads.length = 0
})

describe('the plan read model', () => {
  it('says which step an email is on', async () => {
    missingStep = false
    const read = await latestPlanRun(run.id, 'UTC')
    expect(read.ok && read.run?.builds[0]).toMatchObject({
      state: 'build_queued',
      step: 'copy'
    })
  })

  it('still loads the plan while the step column is not there yet (app live before the migration)', async () => {
    missingStep = true
    selects.length = 0
    const read = await latestPlanRun(run.id, 'UTC')
    expect(selects).toEqual([
      'id,slot,state,step,sample_draft,error_code,push_key',
      'id,slot,state,sample_draft,error_code,push_key'
    ])
    expect(read.ok && read.run?.builds[0]).toMatchObject({
      state: 'build_queued',
      step: 'sections'
    })
  })

  it('says why a failed build or plan stopped, in plain words, also for a code without its own (REL-084)', async () => {
    missingStep = false
    buildOver = { state: 'failed', error_code: 'klaviyo_unavailable' }
    let read = await latestPlanRun(run.id, 'UTC')
    expect(read.ok && read.run?.builds[0].reason).toBe(
      'Klaviyo could not be reached. Try again later.'
    )
    buildOver = { state: 'failed', error_code: 'something_new' }
    read = await latestPlanRun(run.id, 'UTC')
    expect(read.ok && read.run?.builds[0].reason).toBe(
      'Something went wrong while it was being made. Try again.'
    )
    buildOver = {}
    read = await latestPlanRun(run.id, 'UTC')
    expect(read.ok && read.run?.reason).toBeNull()
    runOver = { state: 'failed', error_code: 'out_of_date' }
    read = await latestPlanRun(run.id, 'UTC')
    expect(read.ok && read.run).toMatchObject({
      state: 'failed',
      reason: 'Its 15 days began before the plan was ready.'
    })
    runOver = {}
  })

  it('says which refusal it was when Klaviyo, or the last check before it, refused the draft (REL-084c)', async () => {
    const key = '00000000-0000-4000-8000-00000000c101'
    buildOver = {
      state: 'failed',
      error_code: 'klaviyo_rejected',
      push_key: key
    }
    pushes = {
      data: [{ push_key: key, reason: 'externally_modified' }],
      error: null
    }
    let read = await latestPlanRun(run.id, 'UTC')
    expect(read.ok && read.run?.builds[0].reason).toBe(
      'Its draft was changed or deleted in Klaviyo, so it was left as it is.'
    )
    // Only its own workspace's refused pushes, by its push key.
    expect(pushReads).toEqual([
      ['select', 'push_key,reason'],
      ['eq', 'tenant_id', run.id],
      ['eq', 'state', 'refused'],
      ['in', 'push_key', [key]]
    ])
    // A refusal without words, no push row, or the read failing: the general words.
    for (const p of [
      { data: [{ push_key: key, reason: 'something_new' }], error: null },
      { data: [], error: null },
      { data: null, error: { code: 'XX000' } }
    ]) {
      pushes = p
      read = await latestPlanRun(run.id, 'UTC')
      expect(read.ok && read.run?.builds[0].reason).toBe(
        'Klaviyo, or the last check before Klaviyo, refused it.'
      )
    }
    // Another failure never reads the pushes.
    pushReads.length = 0
    buildOver = {
      state: 'failed',
      error_code: 'klaviyo_unavailable',
      push_key: key
    }
    await latestPlanRun(run.id, 'UTC')
    expect(pushReads).toEqual([])
  })

  it('gives a reason to a build in a state it does not know (shown as failed)', async () => {
    buildOver = { state: 'cancelled', error_code: null }
    const read = await latestPlanRun(run.id, 'UTC')
    expect(read.ok && read.run?.builds[0]).toMatchObject({
      state: 'failed',
      reason: 'Something went wrong while it was being made. Try again.'
    })
  })
})

describe('a planned email’s send time (REL-DAT)', () => {
  it('has passed at and after its store-time send time, and for a time the clock skips', async () => {
    const { sendTimePassed } = await import('./load')
    const zone = 'Australia/Melbourne'
    const slot = { date: '2026-11-17', time: '10:00' }
    // 10:00 in Melbourne on 17 Nov 2026 is 23:00 UTC on the 16th.
    expect(sendTimePassed(slot, zone, new Date('2026-11-16T22:59:59Z'))).toBe(
      false
    )
    expect(sendTimePassed(slot, zone, new Date('2026-11-16T23:00:00Z'))).toBe(
      true
    )
    expect(
      sendTimePassed(
        { date: '2026-10-04', time: '02:30' },
        zone,
        new Date('2026-01-01T00:00:00Z')
      )
    ).toBe(true)
  })
})
