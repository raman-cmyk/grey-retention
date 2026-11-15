// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { InMemoryMemoryStore } from '@/features/agents/memory'
import {
  InMemoryRunLog,
  type AgentDefinition,
  type AiCall
} from '@/features/agents/runtime'
import { agentTries, tryAgent } from './retry'

const def: AgentDefinition<{ problems: string[] }, { n: number }> = {
  name: 'counter',
  version: '1',
  purpose: 'label',
  instructions: 'Answer with a number.',
  task: (t) => JSON.stringify(t),
  schema: { name: 'n', definition: { type: 'object' } },
  output: z.object({ n: z.number() }),
  maxOutputTokens: 10,
  temperature: 0
}
const answers = (...ns: number[]) => {
  const queue = [...ns]
  return vi.fn<AiCall>(async () => ({
    ok: true,
    content: { n: queue.shift() ?? 0 },
    provider: 'gemini',
    model: 'test',
    costMicro: 0,
    inputTokens: 1,
    outputTokens: 1,
    settled: true
  }))
}
const ctx = (ai: AiCall, fits?: () => boolean) => ({
  tenantId: '00000000-0000-4000-8000-000000000101',
  industry: null,
  callerKey: 'k',
  memory: new InMemoryMemoryStore(),
  log: new InMemoryRunLog(),
  ai,
  ...(fits ? { fits } : {})
})
/** Passes only the number 3. */
const check = (o: { n: number }) => (o.n === 3 ? [] : [`${o.n} is not 3.`])

describe('tryAgent with a time limit (REL-AI part 2b)', () => {
  it('stops before a later try that would not fit, and goes on from its tries with the same problems', async () => {
    const ai = answers(1, 3)
    const task = vi.fn((problems: string[]) => ({ problems }))
    let left = 0
    const first = await tryAgent(
      def,
      task,
      check,
      ctx(ai, () => left-- > 0)
    )
    expect(first).toMatchObject({
      ok: false,
      paused: true,
      tries: 1,
      reasonCode: 'check_failed',
      problems: ['1 is not 3.']
    })
    if (first.ok) return
    const next = await tryAgent(def, task, check, ctx(ai), {
      tries: first.tries,
      problems: first.problems,
      reasonCode: 'check_failed'
    })
    expect(next).toMatchObject({ ok: true, output: { n: 3 }, tries: 2 })
    expect(ai).toHaveBeenCalledTimes(2)
    expect(task.mock.calls.map((c) => c[0])).toEqual([[], ['1 is not 3.']])
  })

  it('a try already spent is not made again: all tries spent is a give-up', async () => {
    const ai = answers(3)
    const result = await tryAgent(
      def,
      (problems) => ({ problems }),
      check,
      ctx(ai),
      {
        tries: agentTries,
        problems: ['1 is not 3.'],
        reasonCode: 'check_failed'
      }
    )
    expect(result).toMatchObject({ ok: false, reasonCode: 'check_failed' })
    expect(ai).not.toHaveBeenCalled()
  })

  it('without a time limit, behaves as before', async () => {
    const ai = answers(1, 2, 4)
    const result = await tryAgent(
      def,
      (problems) => ({ problems }),
      check,
      ctx(ai)
    )
    expect(result).toMatchObject({
      ok: false,
      reasonCode: 'check_failed',
      tries: agentTries
    })
    expect(result.ok || result.paused).toBeFalsy()
  })
})
