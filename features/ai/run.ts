import 'server-only'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  AiProviderError,
  type AiFailureKind,
  type AiProvider,
  type AiProviderRequest,
  type AiProviderResponse
} from '@/lib/providers/contracts'
import { FakeAiProvider } from '@/lib/providers/fake'
import {
  GeminiProvider,
  geminiOutputTokens,
  geminiRequestBody
} from '@/lib/providers/gemini'
import {
  geminiCostMicro,
  geminiEstimateMicro,
  type AiPurpose
} from '@/lib/providers/gemini-pricing'
import {
  OpenAiResponsesProvider,
  responsesRequestBody
} from '@/features/email-generation/openai'
import {
  costMicro as openAiCostMicro,
  estimateMicro as openAiEstimateMicro,
  maxRequestBytes as openAiMaxRequestBytes
} from '@/features/email-generation/pricing'
import { aiSetup, type AiSetup } from './setup'
import type { BudgetFeature, BudgetLedger } from './budget-ledger'

const purposeFeature: Record<AiPurpose, BudgetFeature> = {
  label: 'learning',
  copy: 'copy',
  plan: 'playbook',
  review: 'learning'
}

export type AiRunResult =
  | {
      ok: true
      content: unknown
      provider: 'gemini' | 'openai' | 'fake'
      model: string
      costMicro: number
      inputTokens: number
      outputTokens: number
      settled: boolean
    }
  | {
      ok: false
      code:
        | AiFailureKind
        | 'cap_reached'
        | 'ledger_unavailable'
        | 'unsupported_model'
      retryAfterSeconds?: number
      diagnostic?: string
    }

/** Most pictures one call may carry. */
export const maxImages = 8

const runInput = z.object({
  tenantId: z.uuid().nullable(),
  callerKey: z.string().trim().min(1).max(120),
  purpose: z.enum(['label', 'copy', 'plan', 'review']),
  maxOutputTokens: z.number().int().min(1).max(65_536),
  images: z
    .array(
      z.object({
        mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
        // About 3 MB of picture per image; base64 only.
        base64: z
          .string()
          .min(16)
          .max(4_000_000)
          .regex(/^[A-Za-z0-9+/]+={0,2}$/)
      })
    )
    .max(maxImages)
    .optional()
})

/**
 * The one entry point for v2 AI calls (labelling and copy). It picks the
 * provider from server settings, reserves the request's upper-bound cost
 * against the client's allowance before anything is sent, and settles the
 * real cost afterwards, exactly once. Over the cap, nothing is sent.
 *
 * Every call is its own metered reservation (`ai:<purpose>:<callerKey>:<uuid>`),
 * so a retry is always charged and can never reuse a settled reservation.
 * Callers make their work idempotent by storing the result before marking
 * their job done. The caller must already have authorised the tenant.
 *
 * `tenantId: null` is platform work that belongs to no client (labelling
 * competitor emails in the Inspiration inbox); it is metered against the
 * platform's own daily cap instead of a client's package.
 */
export async function runAi(
  input: {
    /** The client workspace, or null for platform work. */
    tenantId: string | null
    /** What the call is for, e.g. `section:<id>`; never a raw job id. */
    callerKey: string
    purpose: AiPurpose
    request: Omit<AiProviderRequest, 'model' | 'timeoutMs'>
  },
  deps: {
    ledger: BudgetLedger
    env?: NodeJS.ProcessEnv
    fetch?: typeof fetch
    fake?: AiProvider
  }
): Promise<AiRunResult> {
  const valid = runInput.safeParse({
    tenantId: input.tenantId,
    callerKey: input.callerKey,
    purpose: input.purpose,
    maxOutputTokens: input.request.maxOutputTokens,
    images: input.request.images
  })
  if (!valid.success) return { ok: false, code: 'rejected_request' }
  const setup = aiSetup(input.purpose, deps.env)
  if (!setup.ready) return { ok: false, code: setup.reason }
  const request: AiProviderRequest = {
    ...input.request,
    model: setup.model,
    timeoutMs: setup.timeoutMs
  }
  if (setup.provider === 'fake') {
    const response = await (deps.fake ?? new FakeAiProvider()).generate(request)
    return {
      ok: true,
      content: response.content,
      provider: 'fake',
      model: 'fake',
      costMicro: 0,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      settled: true
    }
  }
  const live = liveProvider(setup, request, deps.fetch)
  let body: string
  let estimate: number
  try {
    body = live.body()
    estimate = live.estimate(body)
  } catch (error) {
    if (error instanceof AiProviderError)
      return {
        ok: false,
        code: error.kind,
        diagnostic: error.details.diagnostic
      }
    throw error
  }
  const reservation = await deps.ledger.reserve({
    tenantId: input.tenantId,
    operationId: `ai:${input.purpose}:${valid.data.callerKey}:${randomUUID()}`,
    feature: purposeFeature[input.purpose],
    estimateMicro: estimate
  })
  if (!reservation.ok) return { ok: false, code: reservation.code }
  const provider = live.provider()
  let outcome:
    | { ok: true; response: AiProviderResponse; cost: number }
    | { ok: false; error: AiProviderError; cost: number }
  try {
    const response = await provider.generate(live.request)
    outcome = {
      ok: true,
      response,
      cost: live.cost(response)
    }
  } catch (error) {
    // none: provably unbilled. usage: bill what was used. unknown (or an
    // unexpected crash): assume the whole reservation was spent.
    outcome =
      error instanceof AiProviderError
        ? {
            ok: false,
            error,
            cost:
              error.billing === 'none'
                ? 0
                : error.billing === 'usage' && error.details.usage
                  ? live.cost(error.details.usage)
                  : estimate
          }
        : {
            ok: false,
            error: new AiProviderError('unavailable', 'unknown', {
              diagnostic: 'unexpected_error'
            }),
            cost: estimate
          }
  }
  // Settle exactly once. The estimate is a proven upper bound, so the
  // settled amount never exceeds the reservation.
  let settled = true
  try {
    await deps.ledger.settle({
      tenantId: input.tenantId,
      reservationId: reservation.reservationId,
      actualMicro: Math.min(outcome.cost, estimate)
    })
  } catch {
    settled = false
  }
  if (!outcome.ok)
    return {
      ok: false,
      code: outcome.error.kind,
      retryAfterSeconds: outcome.error.details.retryAfterSeconds,
      diagnostic: outcome.error.details.diagnostic
    }
  return {
    ok: true,
    content: outcome.response.content,
    provider: setup.provider,
    model: setup.model,
    costMicro: outcome.cost,
    inputTokens: outcome.response.inputTokens,
    outputTokens: outcome.response.outputTokens,
    // false: the call was paid but not recorded; the reservation (at the
    // estimate) still counts against the cap until ops reconciles it.
    settled
  }
}

/**
 * Thinking room per effort, as Gemini's (`lib/providers/gemini.ts`; no
 * effort: the room kept when the model decides how much to think).
 */
const openAiThinkingRoom = {
  none: 0,
  low: 1_024,
  medium: 4_096,
  unset: 4_096
} as const
/** The largest answer a v2 call may ask for (`runInput`). */
const maxOutputTokens = 65_536
/** How v2 calls are sent to the second provider (REL-PRV). */
const openAiOptions = { strict: false, serviceTier: 'default' } as const

type Usage = {
  inputTokens: number
  outputTokens: number
  cachedInputTokens?: number
}

/**
 * The live provider's request body, cost ceiling, adapter and real cost.
 * REL-PRV: Gemini (D5) or, chosen by name, OpenAI's Responses API, both
 * behind the same `AiProvider` contract and metered the same way.
 */
function liveProvider(
  setup: Extract<AiSetup, { ready: true; provider: 'gemini' | 'openai' }>,
  request: AiProviderRequest,
  fetchImpl: typeof fetch | undefined
): {
  /** The request as it is sent. */
  request: AiProviderRequest
  body: () => string
  estimate: (body: string) => number
  provider: () => AiProvider
  cost: (usage: Usage) => number
} {
  if (setup.provider === 'openai') {
    const model = setup.model
    // OpenAI counts its thinking inside `max_output_tokens`: the answer room
    // asked for plus the same thinking room Gemini gets, so an answer is not
    // cut short by its own thinking. The body and the ceiling use it alike.
    const sent: AiProviderRequest = {
      ...request,
      maxOutputTokens: Math.min(
        maxOutputTokens,
        request.maxOutputTokens +
          openAiThinkingRoom[request.reasoningEffort ?? 'unset']
      )
    }
    return {
      request: sent,
      body: () => {
        // Its adapter sends text only: a call with pictures stays on Gemini.
        if (sent.images?.length)
          throw new AiProviderError('rejected_request', 'none', {
            diagnostic: 'images_unsupported'
          })
        const body = responsesRequestBody(sent, openAiOptions)
        if (Buffer.byteLength(body, 'utf8') > openAiMaxRequestBytes)
          throw new AiProviderError('rejected_request', 'none', {
            diagnostic: 'request_too_large'
          })
        return body
      },
      estimate: (body) =>
        openAiEstimateMicro(model, body, sent.maxOutputTokens),
      provider: () =>
        new OpenAiResponsesProvider({
          apiKey: setup.apiKey,
          baseUrl: setup.baseUrl,
          fetch: fetchImpl,
          options: openAiOptions
        }),
      cost: (usage) => openAiCostMicro(model, usage)
    }
  }
  const model = setup.model
  return {
    request,
    body: () => geminiRequestBody(request),
    estimate: (body) =>
      geminiEstimateMicro(
        model,
        request.images?.length
          ? geminiRequestBody({ ...request, images: [] })
          : body,
        geminiOutputTokens(request),
        request.images?.length ?? 0
      ),
    provider: () =>
      new GeminiProvider({ apiKey: setup.apiKey, fetch: fetchImpl }),
    cost: (usage) => geminiCostMicro(model, usage)
  }
}
