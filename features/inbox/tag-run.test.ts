// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { runTagging, tagRunMs } from './tag-run'

type Db = Parameters<typeof runTagging>[0]
const db = {} as unknown as Db
const counts = { emails: 2, sections: 9, untagged: 1, retried: 1, deferred: 0 }

describe('runTagging', () => {
  afterEach(() => vi.restoreAllMocks())

  it('tags with the sample rules when no live model is set up', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const label = vi.fn(async () => counts)
    const before = Date.now()
    const run = await runTagging(db, {
      env: { AI_DEFAULT_PROVIDER: 'fake' } as unknown as NodeJS.ProcessEnv,
      label
    })
    expect(run).toEqual({ state: 'done', live: false, ...counts })
    const [, , deadline, options] = label.mock.calls[0] as unknown as [
      unknown,
      unknown,
      number,
      { pictures: boolean; batchMs: number }
    ]
    expect(options).toEqual({ pictures: false, batchMs: 0 })
    expect(deadline).toBeGreaterThanOrEqual(before + tagRunMs)
    expect(deadline).toBeLessThanOrEqual(Date.now() + tagRunMs)
  })

  it('gives the run its own time, well under the 60-second route limit', () => {
    expect(tagRunMs).toBeLessThanOrEqual(50_000)
  })

  it('reports a failure with a code and never throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const label = vi.fn(async () => {
      throw Object.assign(new Error('x'), { code: 'PGRST301' })
    })
    expect(
      await runTagging(db, {
        env: { AI_DEFAULT_PROVIDER: 'fake' } as unknown as NodeJS.ProcessEnv,
        label,
        budgetMs: 10
      })
    ).toEqual({ state: 'failed', code: 'PGRST301' })
  })
})
