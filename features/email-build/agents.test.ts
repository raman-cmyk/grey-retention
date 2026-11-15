// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
const { runAi } = vi.hoisted(() => ({
  runAi: vi.fn(async () => ({ ok: false as const, code: 'cap_reached' }))
}))
vi.mock('@/features/ai/run', () => ({ runAi }))
import { agentCallMs, agentEnv, buildAgentsFor, emailAgentsOn } from './agents'

const db = { rpc: () => null, from: () => null } as never
const env = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv

describe('the agents switch for "Create email" (REL-AI part 2)', () => {
  it('is off unless the owner turns it on, even with a Gemini key', () => {
    expect(emailAgentsOn(env({}))).toBe(false)
    expect(emailAgentsOn(env({ EMAIL_BUILD_AGENTS: 'yes' }))).toBe(false)
    expect(emailAgentsOn(env({ EMAIL_BUILD_AGENTS: ' on ' }))).toBe(true)
    expect(buildAgentsFor(db, env({ GEMINI_API_KEY: 'k' }))).toBeNull()
    expect(buildAgentsFor(db, env({}))).toBeNull()
  })

  it('stays on the code path with the fake model, even when switched on', () => {
    expect(
      buildAgentsFor(
        db,
        env({
          EMAIL_BUILD_AGENTS: 'on',
          AI_DEFAULT_PROVIDER: 'fake',
          GEMINI_API_KEY: 'k'
        })
      )
    ).toBeNull()
  })

  it('gives the agents when switched on with a live model, each call capped', () => {
    const agents = buildAgentsFor(
      db,
      env({
        EMAIL_BUILD_AGENTS: 'on',
        GEMINI_API_KEY: 'k'
      })
    )
    expect(agents).not.toBeNull()
    expect(Object.keys(agents!).sort()).toEqual(['ai', 'log', 'memory'])
    expect(
      Number(
        agentEnv(env({ GEMINI_API_KEY: 'k', GEMINI_TIMEOUT_MS: '60000' }))
          .GEMINI_TIMEOUT_MS
      )
    ).toBeLessThanOrEqual(agentCallMs)
  })

  it('sends every agent call through runAi with the capped timeout, on the workspace', async () => {
    const agents = buildAgentsFor(
      db,
      env({
        EMAIL_BUILD_AGENTS: 'on',
        GEMINI_API_KEY: 'k',
        GEMINI_TIMEOUT_MS: '60000'
      })
    )!
    await agents.ai({
      tenantId: '00000000-0000-4000-8000-000000000101',
      callerKey: 'email-build:b1',
      purpose: 'copy',
      request: { system: 's', user: 'u' } as never
    })
    const [call, opts] = runAi.mock.calls[0] as unknown as [
      { tenantId: string },
      { env: NodeJS.ProcessEnv }
    ]
    expect(call.tenantId).toBe('00000000-0000-4000-8000-000000000101')
    expect(Number(opts.env.GEMINI_TIMEOUT_MS)).toBeLessThanOrEqual(agentCallMs)
  })
})
