// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const live = vi.hoisted(() => ({ inboxTagging: vi.fn() }))
vi.mock('@/features/intelligence/live', () => live)
import { liveBatchMs } from './label'
import { runTagging, tagCallTimeoutMs, tagRunMs } from './tag-run'

type Db = Parameters<typeof runTagging>[0]
const db = {} as unknown as Db
const counts = { emails: 2, sections: 9, untagged: 1, retried: 1, deferred: 0 }
const env = (values: Record<string, string>) =>
  values as unknown as NodeJS.ProcessEnv
const ask = vi.fn()

describe('runTagging', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    live.inboxTagging.mockReset()
  })

  it('tags with the sample rules when no live model is set up', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    live.inboxTagging.mockReturnValue({ ask, pictures: false, batchMs: 0 })
    const label = vi.fn(async () => counts)
    const before = Date.now()
    const run = await runTagging(db, {
      env: env({ AI_DEFAULT_PROVIDER: 'fake' }),
      label
    })
    expect(run).toEqual({ state: 'done', live: false, ...counts })
    const [, passedAsk, deadline, options] = label.mock.calls[0] as unknown as [
      unknown,
      unknown,
      number,
      { pictures: boolean; batchMs: number }
    ]
    expect(passedAsk).toBe(ask)
    expect(options).toEqual({ pictures: false, batchMs: 0 })
    expect(deadline).toBeGreaterThanOrEqual(before + tagRunMs)
    expect(deadline).toBeLessThanOrEqual(Date.now() + tagRunMs)
  })

  it('runs live with pictures and caps every call so the run ends inside the route limit', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    live.inboxTagging.mockReturnValue({
      ask,
      pictures: true,
      batchMs: liveBatchMs
    })
    const label = vi.fn(async () => counts)
    const run = await runTagging(db, {
      env: env({ GEMINI_API_KEY: 'synthetic', GEMINI_TIMEOUT_MS: '60000' }),
      label
    })
    expect(run).toMatchObject({ state: 'done', live: true })
    const passed = live.inboxTagging.mock.calls[0]![1] as NodeJS.ProcessEnv
    expect(passed.GEMINI_API_KEY).toBe('synthetic')
    expect(passed.GEMINI_TIMEOUT_MS).toBe(String(tagCallTimeoutMs))
    expect((label.mock.calls[0] as unknown as unknown[])[3]).toEqual({
      pictures: true,
      batchMs: liveBatchMs
    })
  })

  it('keeps a shorter configured call timeout, and caps a missing one', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    live.inboxTagging.mockReturnValue({ ask, pictures: true, batchMs: 0 })
    const label = vi.fn(async () => counts)
    await runTagging(db, { env: env({ GEMINI_TIMEOUT_MS: '6000' }), label })
    await runTagging(db, { env: env({}), label })
    expect(
      live.inboxTagging.mock.calls.map(
        (c) => (c[1] as NodeJS.ProcessEnv).GEMINI_TIMEOUT_MS
      )
    ).toEqual(['6000', String(tagCallTimeoutMs)])
  })

  it('leaves room for the last piece of work (two capped calls) inside 60 seconds', () => {
    // Work may start up to the deadline; a section can need two calls one
    // after the other, plus picture downloads and database writes.
    expect(tagRunMs + 2 * tagCallTimeoutMs + 10_000).toBeLessThanOrEqual(60_000)
  })

  it('reports a failure with a code and never throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    live.inboxTagging.mockReturnValue({ ask, pictures: false, batchMs: 0 })
    const label = vi.fn(async () => {
      throw Object.assign(new Error('x'), { code: 'PGRST301' })
    })
    expect(
      await runTagging(db, {
        env: env({ AI_DEFAULT_PROVIDER: 'fake' }),
        label,
        budgetMs: 10
      })
    ).toEqual({ state: 'failed', code: 'PGRST301' })
  })
})
