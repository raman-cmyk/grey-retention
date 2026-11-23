// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
vi.mock('server-only', () => ({}))
const { runAi } = vi.hoisted(() => ({
  runAi: vi.fn(async () => ({ ok: false as const, code: 'cap_reached' }))
}))
vi.mock('@/features/ai/run', () => ({ runAi }))
import { InMemoryMemoryStore } from '@/features/agents/memory'
import { InMemoryRunLog, type AiCall } from '@/features/agents/runtime'
import {
  boundedStrategyAgents,
  strategyAgentsFor,
  strategyAgentsOn,
  strategyBudgetMs,
  strategyCallMs,
  strategySlackMs
} from './agents'

const db = { rpc: () => null, from: () => null } as never
const env = (over: Record<string, string> = {}) =>
  ({
    NODE_ENV: 'test',
    STRATEGY_AGENTS: 'on',
    GEMINI_API_KEY: 'synthetic-only',
    ...over
  }) as NodeJS.ProcessEnv
const call: Parameters<AiCall>[0] = {
  tenantId: '00000000-0000-4000-8000-000000000101',
  callerKey: 'brief-writer:synthetic',
  purpose: 'plan',
  request: { system: 'Synthetic', user: '{}' } as never
}
beforeEach(() => vi.clearAllMocks())

describe('owner-controlled strategy agents', () => {
  it('fits the background action budget on every page that starts planning', () => {
    for (const page of ['home', 'plan']) {
      const source = readFileSync(
        new URL(`../../app/(gros)/${page}/page.tsx`, import.meta.url),
        'utf8'
      )
      const duration = Number(
        /export const maxDuration = (\d+)/.exec(source)?.[1]
      )
      expect(duration * 1000, page).toBeGreaterThan(
        strategyBudgetMs + strategySlackMs
      )
    }
  })
  it('is off by default and does not inherit the email or provider switch', () => {
    for (const flag of [undefined, '', 'ON', 'yes', ' on ']) {
      const settings = {
        NODE_ENV: 'test' as const,
        GEMINI_API_KEY: 'synthetic-only',
        STRATEGY_AGENTS: flag
      }
      expect(strategyAgentsOn(settings)).toBe(false)
      expect(strategyAgentsFor(db, settings)).toBeNull()
    }
    expect(
      strategyAgentsFor(db, {
        NODE_ENV: 'test',
        EMAIL_BUILD_AGENTS: 'on',
        GEMINI_API_KEY: 'synthetic-only'
      })
    ).toBeNull()
    expect(runAi).not.toHaveBeenCalled()
  })

  it('requires ready live models for both planning and review, never bypassing fake mode', () => {
    for (const settings of [
      env({ AI_DEFAULT_PROVIDER: 'fake' }),
      env({ GEMINI_API_KEY: '' }),
      env({ GEMINI_PLAN_MODEL: 'unpriced-model' }),
      env({ GEMINI_REVIEW_MODEL: 'unpriced-model' })
    ])
      expect(strategyAgentsFor(db, settings)).toBeNull()
    expect(runAi).not.toHaveBeenCalled()
  })

  it('uses tenant-metered runAi for each purpose with capped Gemini/OpenAI timeouts', async () => {
    for (const settings of [
      env({ GEMINI_TIMEOUT_MS: '60000' }),
      env({
        AI_V2_PROVIDER: 'openai',
        OPENAI_API_KEY: 'synthetic-only',
        OPENAI_TIMEOUT_MS: '60000'
      })
    ]) {
      const agents = strategyAgentsFor(db, settings)!
      expect(agents).not.toBeNull()
      for (const purpose of ['plan', 'review'] as const)
        await agents.ai({ ...call, purpose })
    }
    expect(runAi).toHaveBeenCalledTimes(4)
    for (const args of runAi.mock.calls as unknown as [
      Parameters<AiCall>[0],
      { env: NodeJS.ProcessEnv; ledger: unknown }
    ][]) {
      expect(args[0].tenantId).toBe(call.tenantId)
      expect(args[1].ledger).toBeDefined()
      expect(Number(args[1].env.GEMINI_TIMEOUT_MS)).toBeLessThanOrEqual(
        strategyCallMs
      )
      expect(Number(args[1].env.OPENAI_TIMEOUT_MS)).toBeLessThanOrEqual(
        strategyCallMs
      )
    }
  })

  it('refuses new spending as soon as a full call plus save slack cannot fit', async () => {
    const ai = vi.fn<AiCall>(async () => ({ ok: false, code: 'cap_reached' }))
    let clock = 0
    const until = strategyCallMs + strategySlackMs + 1
    const bounded = boundedStrategyAgents(
      {
        ai,
        memory: new InMemoryMemoryStore(),
        log: new InMemoryRunLog()
      },
      until,
      () => clock
    )
    expect(bounded.fits!()).toBe(true)
    await bounded.ai(call)
    clock = 1
    expect(bounded.fits!()).toBe(false)
    expect(await bounded.ai(call)).toEqual({ ok: false, code: 'unavailable' })
    expect(ai).toHaveBeenCalledTimes(1)
  })
})
