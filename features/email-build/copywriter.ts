import { z } from 'zod'
import { runAgent, type AgentDefinition } from '@/features/agents/runtime'
import type { AiRun, RunAi } from '@/features/assembly/assemble'
import type { BuildAgents } from './build'

/**
 * REL-AI part 2b: the Copywriter (EML-002's writer on the locked sections,
 * `assembleLocked`) through the agent runtime (MEM-001), so each call
 * carries the Brand book and the do's and don'ts for "copywriter", is
 * metered by the build's `ai` (the workspace's own allowance) and is in
 * the run log. Assembly builds the request (instructions, the store's data
 * as untrusted JSON, the answer shape); `assembleLocked` checks the answer.
 * The build has agents only with a live model (`buildAgentsFor`); the
 * answer says which provider gave it.
 */
export const copywriterVersion = '2026-11-15.1'

export function copywriterRun(
  agents: BuildAgents,
  ctx: { tenantId: string; callerKey: string; industry: string | null }
): RunAi {
  return async (request): Promise<AiRun> => {
    // Assembly always sends its answer shape; without one, no call.
    if (!request.schema) return { ok: false, code: 'rejected_request' }
    const def: AgentDefinition<null, unknown> = {
      name: 'copywriter',
      version: copywriterVersion,
      purpose: 'copy',
      instructions: request.system,
      task: () => request.user,
      schema: request.schema,
      output: z.unknown(),
      maxOutputTokens: request.maxOutputTokens,
      temperature: request.temperature,
      ...(request.reasoningEffort
        ? { reasoningEffort: request.reasoningEffort }
        : {}),
      usesBrandBook: true
    }
    const result = await runAgent(def, null, {
      tenantId: ctx.tenantId,
      industry: ctx.industry,
      callerKey: ctx.callerKey,
      memory: agents.memory,
      log: agents.log,
      ai: agents.ai
    })
    if (result.ok)
      return {
        ok: true,
        content: result.output,
        provider: result.provider,
        model: 'copywriter'
      }
    return {
      ok: false,
      code: result.code,
      ...(result.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: result.retryAfterSeconds }
        : {})
    }
  }
}
