import type { AgentDefinition, AiCall, RunLog } from '@/features/agents/runtime'
import { runAgent } from '@/features/agents/runtime'
import type { MemoryStore } from '@/features/agents/memory'

/** Every agent answer gets this many tries (AGENT_MAP.md loops, D16). */
export const agentTries = 3

export type AgentCtx = {
  tenantId: string
  industry: string | null
  /** What the call is for; also the fallback subject. */
  callerKey: string
  memory: MemoryStore
  log: RunLog
  ai: AiCall
  now?: string
}

export type TryResult<O> =
  | { ok: true; output: O; tries: number; runId: string }
  | {
      ok: false
      /** `agent_failed`: refused (cap, provider), never retried. */
      reasonCode: 'agent_failed' | 'answer_invalid' | 'check_failed'
      tries: number
      runId?: string
      problems: string[]
    }

/**
 * Runs an agent until code's check passes: up to `agentTries` answers, each
 * retry told the exact problems with the last one. A refused call is not
 * retried (a cap or a provider stop does not change in a second).
 */
export async function tryAgent<T, O>(
  def: AgentDefinition<T, O>,
  task: (problems: string[]) => T,
  check: (output: O) => string[],
  ctx: AgentCtx
): Promise<TryResult<O>> {
  let problems: string[] = []
  let runId: string | undefined
  let reasonCode: 'answer_invalid' | 'check_failed' = 'check_failed'
  for (let tries = 1; tries <= agentTries; tries++) {
    const result = await runAgent(def, task(problems), ctx)
    runId = result.runId
    if (!result.ok) {
      if (result.code !== 'invalid_output')
        return { ok: false, reasonCode: 'agent_failed', tries, runId, problems }
      reasonCode = 'answer_invalid'
      problems = ['The answer did not match the required JSON shape.']
      continue
    }
    problems = check(result.output)
    if (!problems.length)
      return { ok: true, output: result.output, tries, runId: result.runId }
    reasonCode = 'check_failed'
  }
  return { ok: false, reasonCode, tries: agentTries, runId, problems }
}

/** Fixed words for a failed agent, by reason (never client data). */
export const failedWords: Record<
  'agent_failed' | 'answer_invalid' | 'check_failed',
  string
> = {
  agent_failed: 'could not answer (AI unavailable or the allowance is used up)',
  answer_invalid: 'kept answering in the wrong shape',
  check_failed: 'kept failing the facts check'
}
