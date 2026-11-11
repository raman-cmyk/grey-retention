// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { liveBatchMs } from '@/features/inbox/label'
import { inboxTagging } from './live'
import { sampleAsk } from './passes'

const db = {
  rpc: async () => ({ data: null, error: null }),
  from: () => ({})
} as unknown as Parameters<typeof inboxTagging>[0]

describe('inboxTagging', () => {
  it('uses the sample rules, with no pictures and no batch time, while no live model is set up', () => {
    for (const env of [
      { AI_DEFAULT_PROVIDER: 'fake', GEMINI_API_KEY: 'k' },
      {}
    ] as unknown as NodeJS.ProcessEnv[])
      expect(inboxTagging(db, env)).toEqual({
        ask: sampleAsk,
        pictures: false,
        batchMs: 0
      })
  })

  it('asks the agents live, with pictures and a batch time, once Gemini is set up', () => {
    const live = inboxTagging(db, {
      GEMINI_API_KEY: 'test-key'
    } as unknown as NodeJS.ProcessEnv)
    expect(live.ask).not.toBe(sampleAsk)
    expect(live).toMatchObject({ pictures: true, batchMs: liveBatchMs })
  })
})
