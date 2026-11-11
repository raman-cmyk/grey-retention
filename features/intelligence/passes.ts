import type { MemoryStore } from '@/features/agents/memory'
import {
  runAgent,
  type AgentDefinition,
  type AiCall,
  type RunLog
} from '@/features/agents/runtime'
import { confidentFrom, type Tagged, type TagPass } from './taxonomy'

/** One agent call's answer, as the tagging agents need it. */
export type AiRun =
  | { ok: true; content: unknown; provider: 'gemini' | 'fake'; model: string }
  | { ok: false; code: string; retryAfterSeconds?: number }

/**
 * The two model tiers a tagging agent uses (AGENT_MAP §1): `label`
 * (Flash-Lite) first, then `review` (Flash) when the first answer is
 * unsure. Both get the agent's pictures.
 */
export type Tier = 'label' | 'review'

/**
 * Runs one agent call. In the sweep it is `agentAsk` (MEM-001's runAgent:
 * memory, run log, metered `runAi` on the platform budget); with no AI
 * set up it is `sampleAsk`; tests pass their own.
 */
export type Ask = <I, O>(
  def: AgentDefinition<I, O>,
  input: I,
  call: {
    /** What the call is for, e.g. `section:<id>`; never a raw job id. */
    callerKey: string
    tier: Tier
    /** The competitor's industry, for industry-wide do's and don'ts. */
    industry: string | null
  }
) => Promise<AiRun>

/**
 * Failures worth another try of the whole job. Anything else (a refused or
 * rejected request, a missing setup, a spent budget) would only pay again
 * for the same answer.
 */
const retryableCodes = new Set([
  'rate_limited',
  'unavailable',
  'timeout',
  'incomplete',
  'ledger_unavailable'
])

/** A tagging call that failed in a way the job should try again. */
export class TagError extends Error {
  readonly retryable: boolean
  constructor(
    readonly code: string,
    readonly retryAfterSeconds?: number
  ) {
    super(`Tagging failed: ${code}`)
    this.name = 'TagError'
    this.retryable = retryableCodes.has(code)
  }
}

/** How long a job waits when the platform's AI budget is spent. */
export const budgetWaitSeconds = 3_600
/** The shortest wait after a rate limit. */
export const rateLimitWaitSeconds = 300

/**
 * When a failed call puts its job back without using up a try (D16: it
 * simply runs later): the platform's AI budget is spent (an hour), or the
 * provider is rate limiting (its own wait, at least five minutes). Every
 * other job would be refused too, so the run stops. Null for any other
 * failure, which uses a try as usual.
 */
export function waitFor(
  error: unknown
): { delaySeconds: number; reason: string } | null {
  if (!(error instanceof TagError)) return null
  if (error.code === 'cap_reached')
    return { delaySeconds: budgetWaitSeconds, reason: 'ai_cap_reached' }
  if (error.code === 'rate_limited')
    return {
      delaySeconds: Math.min(
        86_400,
        Math.max(rateLimitWaitSeconds, Math.ceil(error.retryAfterSeconds ?? 0))
      ),
      reason: 'ai_rate_limited'
    }
  return null
}

/**
 * Asks one agent with the `label` tier, then, when its answer is
 * unreadable or unsure, once more with the `review` tier. Still unsure, or
 * refused: `untagged` (D16: left out of search, no person asked). When the
 * AI port answers with its fake, the honest sample rules answer instead
 * (`pass: 'sample'`).
 */
export async function twoPass<I, T extends { confidence: number }>(input: {
  ask: Ask
  def: AgentDefinition<I, T>
  input: I
  callerKey: string
  industry: string | null
  sample: () => T
}): Promise<Tagged<T>> {
  const call = { callerKey: input.callerKey, industry: input.industry }
  const fast = await input.ask(input.def, input.input, {
    ...call,
    tier: 'label'
  })
  if (fast.ok && fast.provider === 'fake')
    return trusted(input.sample(), 'sample', null)
  // An unreadable answer is unsure, not a failure: the larger model tries.
  if (!fast.ok && fast.code !== 'invalid_output') return failed(fast, 'fast')
  const first = fast.ok ? input.def.output.safeParse(fast.content) : null
  if (fast.ok && first?.success && first.data.confidence >= confidentFrom)
    return trusted(first.data, 'fast', fast.model)
  const strong = await input.ask(input.def, input.input, {
    ...call,
    tier: 'review'
  })
  if (strong.ok && strong.provider === 'fake')
    return trusted(input.sample(), 'sample', null)
  if (!strong.ok && strong.code !== 'invalid_output')
    return failed(strong, 'strong')
  const second = strong.ok ? input.def.output.safeParse(strong.content) : null
  if (strong.ok && second?.success && second.data.confidence >= confidentFrom)
    return trusted(second.data, 'strong', strong.model)
  return {
    state: 'untagged',
    pass: 'strong',
    model: strong.ok ? strong.model : null,
    reason: 'unsure'
  }
}

/** The sample rules say `untagged` themselves below the threshold. */
function trusted<T extends { confidence: number }>(
  labels: T,
  pass: TagPass,
  model: string | null
): Tagged<T> {
  return labels.confidence >= confidentFrom
    ? { state: 'tagged', labels, pass, model }
    : { state: 'untagged', pass, model, reason: 'unsure' }
}

function failed<T>(
  result: { ok: false; code: string; retryAfterSeconds?: number },
  pass: TagPass
): Tagged<T> {
  if (result.code === 'refused')
    return { state: 'untagged', pass, model: null, reason: 'refused' }
  throw new TagError(result.code, result.retryAfterSeconds)
}

/**
 * Answers like the AI port's fake, so the honest sample rules tag
 * everything, and nothing is metered or logged. The sweep uses it while no
 * live model is set up.
 */
export const sampleAsk: Ask = async () => ({
  ok: true,
  content: null,
  provider: 'fake',
  model: 'fake'
})

/**
 * The live `Ask`: MEM-001's `runAgent` with the shared memory, the run log
 * and the metered AI call, for platform work (no client: `tenantId: null`,
 * the platform's daily budget, GEM-003). The tier is the call's purpose.
 * Which provider answered is read from the AI call itself, so a fake
 * answer still means "use the sample rules".
 */
export function agentAsk(ctx: {
  ai: AiCall
  memory: MemoryStore
  log: RunLog
}): Ask {
  return async (def, input, call) => {
    const seen: { provider?: 'gemini' | 'fake'; model?: string } = {}
    const ai: AiCall = async (request) => {
      const result = await ctx.ai(request)
      if (result.ok) {
        seen.provider = result.provider
        seen.model = result.model
      }
      return result
    }
    const result = await runAgent(def, input, {
      tenantId: null,
      industry: call.industry,
      callerKey: call.callerKey,
      memory: ctx.memory,
      log: ctx.log,
      ai,
      purpose: call.tier
    })
    if (seen.provider === 'fake')
      return { ok: true, content: null, provider: 'fake', model: 'fake' }
    if (!result.ok)
      return {
        ok: false,
        code: result.code,
        retryAfterSeconds: result.retryAfterSeconds
      }
    return {
      ok: true,
      content: result.output,
      provider: 'gemini',
      model: seen.model ?? 'unknown'
    }
  }
}
