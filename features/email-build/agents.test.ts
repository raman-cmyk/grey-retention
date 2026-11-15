// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
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
})
