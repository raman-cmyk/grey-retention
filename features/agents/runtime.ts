import { createHash } from 'node:crypto'
import type { z } from 'zod'
import type { AiProviderRequest } from '@/lib/providers/contracts'
import type { AiPurpose } from '@/lib/providers/gemini-pricing'
import type { AiRunResult } from '@/features/ai/run'
import {
  brandBookBlock,
  lessonsBlock,
  type MemoryRule,
  type MemoryStore
} from './memory'

/**
 * The agent runtime (MEM-001, AGENT_MAP.md "Harness"). Every agent in the
 * plan is an `AgentDefinition`: a name, a prompt version, a model purpose,
 * its instructions, and a strict answer shape. `runAgent` adds the shared
 * memory (Brand book, do's and don'ts) to the instructions, sends the call
 * through `runAi` (spend cap, fake by default), checks the answer against
 * the shape, and writes one run-log entry, whatever happens.
 */

export type AgentDefinition<I, O> = {
  /** Stable agent name, e.g. "section-tagger". Do's and don'ts target it. */
  name: string
  /** Bumped whenever the instructions change, e.g. "2026-11-11.1". */
  version: string
  purpose: AiPurpose
  /** What the agent is and what it must do. Memory is appended after it. */
  instructions: string
  /** The task for this call. Untrusted content must be inside JSON here. */
  task: (input: I) => string
  /** JSON Schema sent to the model, and the zod check run on its answer. */
  schema: { name: string; definition: Record<string, unknown> }
  output: z.ZodType<O>
  maxOutputTokens: number
  temperature: number
  reasoningEffort?: 'none' | 'low' | 'medium'
  /** Agents that judge their own industry read industry rules too. */
  usesBrandBook?: boolean
}

export type RunVerdict = 'ok' | 'invalid_output' | 'failed'

export type AgentRunEntry = {
  agent: string
  version: string
  tenantId: string | null
  callerKey: string
  /** sha256 of the full prompt: same digest, same question. */
  promptDigest: string
  ruleIds: string[]
  brandBookVersion: number | null
  provider: string | null
  model: string | null
  costMicro: number
  verdict: RunVerdict
  /** Error code or validation summary; never prompt text or secrets. */
  detail: string | null
  output: unknown
}

export interface RunLog {
  record(entry: AgentRunEntry): Promise<string>
}

export class InMemoryRunLog implements RunLog {
  readonly entries: (AgentRunEntry & { id: string })[] = []
  async record(entry: AgentRunEntry) {
    const id = `run-${this.entries.length + 1}`
    this.entries.push({ ...entry, id })
    return id
  }
}

/** The `runAi` call, injected so tests and jobs choose the ledger. */
export type AiCall = (input: {
  tenantId: string | null
  callerKey: string
  purpose: AiPurpose
  request: Omit<AiProviderRequest, 'model' | 'timeoutMs'>
}) => Promise<AiRunResult>

export type AgentResult<O> =
  | { ok: true; output: O; runId: string; rules: MemoryRule[] }
  | { ok: false; code: string; runId: string; retryAfterSeconds?: number }

export function buildInstructions(
  def: { instructions: string },
  rules: readonly MemoryRule[],
  book: Parameters<typeof brandBookBlock>[0]
) {
  return [def.instructions.trim(), brandBookBlock(book), lessonsBlock(rules)]
    .filter(Boolean)
    .join('\n\n')
}

export async function runAgent<I, O>(
  def: AgentDefinition<I, O>,
  input: I,
  ctx: {
    tenantId: string | null
    industry: string | null
    /** What the call is for, e.g. `section:<id>`; never a raw job id. */
    callerKey: string
    memory: MemoryStore
    log: RunLog
    ai: AiCall
    now?: string
  }
): Promise<AgentResult<O>> {
  const now = ctx.now ?? new Date().toISOString()
  const rules = await ctx.memory.rulesFor({
    tenantId: ctx.tenantId,
    industry: ctx.industry,
    agent: def.name,
    now
  })
  const book =
    def.usesBrandBook && ctx.tenantId
      ? await ctx.memory.brandBook(ctx.tenantId)
      : null
  const system = buildInstructions(def, rules, book)
  const user = def.task(input)
  const promptDigest = createHash('sha256')
    .update(`${def.name}@${def.version}\n${system}\n${user}`)
    .digest('hex')
  const base = {
    agent: def.name,
    version: def.version,
    tenantId: ctx.tenantId,
    callerKey: ctx.callerKey,
    promptDigest,
    ruleIds: rules.map((r) => r.id),
    brandBookVersion: book?.version ?? null
  }
  const result = await ctx.ai({
    tenantId: ctx.tenantId,
    callerKey: `${def.name}:${ctx.callerKey}`,
    purpose: def.purpose,
    request: {
      system,
      user,
      maxOutputTokens: def.maxOutputTokens,
      temperature: def.temperature,
      responseKind: 'json',
      schema: def.schema,
      ...(def.reasoningEffort ? { reasoningEffort: def.reasoningEffort } : {})
    }
  })
  if (!result.ok) {
    const runId = await ctx.log.record({
      ...base,
      provider: null,
      model: null,
      costMicro: 0,
      verdict: 'failed',
      detail: result.code,
      output: null
    })
    return {
      ok: false,
      code: result.code,
      runId,
      retryAfterSeconds: result.retryAfterSeconds
    }
  }
  const parsed = def.output.safeParse(result.content)
  if (!parsed.success) {
    const runId = await ctx.log.record({
      ...base,
      provider: result.provider,
      model: result.model,
      costMicro: result.costMicro,
      verdict: 'invalid_output',
      detail: parsed.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.code}`)
        .join('; '),
      output: null
    })
    return { ok: false, code: 'invalid_output', runId }
  }
  const runId = await ctx.log.record({
    ...base,
    provider: result.provider,
    model: result.model,
    costMicro: result.costMicro,
    verdict: 'ok',
    detail: null,
    output: parsed.data
  })
  return { ok: true, output: parsed.data, runId, rules }
}
