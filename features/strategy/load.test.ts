// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))

const selects: string[] = []
let missingStep = false
const run = {
  id: '00000000-0000-4000-8000-00000000e101',
  state: 'planned',
  start_on: '2099-01-01',
  pulse: null,
  plan: null
}
const build = {
  id: '00000000-0000-4000-8000-00000000b101',
  slot: 0,
  state: 'build_queued',
  sample_draft: false,
  error_code: null
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
          return answer({ data: [run], error: null })
        selects.push(columns)
        if (missingStep && columns.includes('step'))
          return answer({ data: null, error: { code: '42703' } })
        return answer({
          data: [missingStep ? build : { ...build, step: 'copy' }],
          error: null
        })
      }
    })
  })
}))

const { latestPlanRun } = await import('./load')

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
})
