// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))

const selects: string[] = []
let missingStep = false
let runOver: Record<string, unknown> = {}
let buildOver: Record<string, unknown> = {}
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
  for (const name of ['eq', 'order', 'limit']) query[name] = () => query
  return query
}
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (table: string) => ({
      select: (columns: string) => {
        if (table === 'strategy_runs')
          return answer({ data: [{ ...run, ...runOver }], error: null })
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
      'id,slot,state,step,sample_draft,error_code',
      'id,slot,state,sample_draft,error_code'
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
    // REL-084c: refused by the app's own checks, said by that build's reason.
    buildOver = { state: 'failed', error_code: 'klaviyo_refused_final_checks' }
    read = await latestPlanRun(run.id, 'UTC')
    expect(read.ok && read.run?.builds[0].reason).toBe(
      'The last check before Klaviyo found a problem (its size, footer or pictures). Try again.'
    )
    buildOver = { state: 'failed', error_code: 'klaviyo_refused_toString' }
    read = await latestPlanRun(run.id, 'UTC')
    expect(read.ok && read.run?.builds[0].reason).toBe(
      'Something went wrong while it was being made. Try again.'
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
