// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { InMemoryMemoryStore, type MemoryRule } from '@/features/agents/memory'
import { InMemoryRunLog, type AiCall } from '@/features/agents/runtime'
import { copywriterRun, copywriterVersion } from './copywriter'

const tenantId = '00000000-0000-4000-8000-000000000101'
const rule = (over: Partial<MemoryRule> = {}): MemoryRule => ({
  id: 'rule-1',
  tenantId,
  industry: null,
  kind: 'dont',
  rule: 'Never open with a question in the subject.',
  why: 'Three sends with question subjects were opened less.',
  appliesTo: ['copywriter'],
  confidence: 0.9,
  source: 'results',
  evidenceCount: 3,
  status: 'active',
  expiresAt: null,
  createdAt: '2026-11-01T00:00:00Z',
  ...over
})
const request = {
  system: 'You write the words for one marketing email.',
  user: 'Data (JSON): {"products":["Linen throw"]}',
  maxOutputTokens: 4000,
  temperature: 0.7,
  reasoningEffort: 'low' as const,
  responseKind: 'json' as const,
  schema: { name: 'email', definition: { type: 'object' } }
}
const answer = (content: unknown) =>
  ({
    ok: true,
    content,
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    costMicro: 120,
    inputTokens: 10,
    outputTokens: 10,
    settled: true
  }) as const

describe('the Copywriter on the agent path (REL-AI part 2b)', () => {
  it('writes with its do’s and don’ts, metered and in the run log', async () => {
    const ai = vi.fn<AiCall>(async () => answer({ subject: 'Hello' }))
    const log = new InMemoryRunLog()
    const memory = new InMemoryMemoryStore([
      rule(),
      rule({ id: 'rule-2', appliesTo: ['brand-inspector'], rule: 'Not mine.' })
    ])
    const run = copywriterRun(
      { memory, log, ai },
      { tenantId, callerKey: 'email-build:b1', industry: 'home' }
    )
    expect(await run(request)).toEqual({
      ok: true,
      content: { subject: 'Hello' },
      provider: 'gemini',
      model: 'copywriter'
    })
    const call = ai.mock.calls[0][0]
    expect(call).toMatchObject({
      tenantId,
      callerKey: 'copywriter:email-build:b1',
      purpose: 'copy'
    })
    expect(call.request.system).toContain(request.system)
    expect(call.request.system).toContain(
      'Never open with a question in the subject.'
    )
    expect(call.request.system).not.toContain('Not mine.')
    expect(call.request).toMatchObject({
      user: request.user,
      schema: request.schema,
      maxOutputTokens: 4000,
      temperature: 0.7,
      reasoningEffort: 'low',
      responseKind: 'json'
    })
    expect(log.entries).toHaveLength(1)
    expect(log.entries[0]).toMatchObject({
      agent: 'copywriter',
      version: copywriterVersion,
      verdict: 'ok',
      ruleIds: ['rule-1'],
      costMicro: 120
    })
  })

  it('passes a failed call on with its code and wait, logged', async () => {
    const ai = vi.fn<AiCall>(async () => ({
      ok: false,
      code: 'rate_limited',
      retryAfterSeconds: 20
    }))
    const log = new InMemoryRunLog()
    const run = copywriterRun(
      { memory: new InMemoryMemoryStore(), log, ai },
      { tenantId, callerKey: 'b1', industry: null }
    )
    expect(await run(request)).toEqual({
      ok: false,
      code: 'rate_limited',
      retryAfterSeconds: 20
    })
    expect(log.entries[0]).toMatchObject({
      verdict: 'failed',
      detail: 'rate_limited'
    })
  })

  it('makes no call without an answer shape', async () => {
    const ai = vi.fn<AiCall>()
    const run = copywriterRun(
      { memory: new InMemoryMemoryStore(), log: new InMemoryRunLog(), ai },
      { tenantId, callerKey: 'b1', industry: null }
    )
    expect(await run({ ...request, schema: undefined })).toEqual({
      ok: false,
      code: 'rejected_request'
    })
    expect(ai).not.toHaveBeenCalled()
  })
})
