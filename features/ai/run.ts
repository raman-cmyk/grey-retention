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
import { GeminiProvider, geminiRequestBody } from '@/lib/providers/gemini'
import {
  geminiCostMicro,
  geminiEstimateMicro,
  type AiPurpose
} from '@/lib/providers/gemini-pricing'
import { aiSetup } from './setup'
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
      provider: 'gemini' | 'fake'
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
  let body: string
  try {
    body = geminiRequestBody(request)
  } catch (error) {
    if (error instanceof AiProviderError)
      return {
        ok: false,
        code: error.kind,
        diagnostic: error.details.diagnostic
      }
    throw error
  }
  const estimate = geminiEstimateMicro(
    setup.model,
    request.images?.length
      ? geminiRequestBody({ ...request, images: [] })
      : body,
    request.maxOutputTokens,
    request.images?.length ?? 0
  )
  const reservation = await deps.ledger.reserve({
    tenantId: input.tenantId,
    operationId: `ai:${input.purpose}:${valid.data.callerKey}:${randomUUID()}`,
    feature: purposeFeature[input.purpose],
    estimateMicro: estimate
  })
  if (!reservation.ok) return { ok: false, code: reservation.code }
  const provider = new GeminiProvider({
    apiKey: setup.apiKey,
    fetch: deps.fetch
  })
  let outcome:
    | { ok: true; response: AiProviderResponse; cost: number }
    | { ok: false; error: AiProviderError; cost: number }
  try {
    const response = await provider.generate(request)
    outcome = {
      ok: true,
      response,
      cost: geminiCostMicro(setup.model, response)
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
                  ? geminiCostMicro(setup.model, error.details.usage)
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
    provider: 'gemini',
    model: setup.model,
    costMicro: outcome.cost,
    inputTokens: outcome.response.inputTokens,
    outputTokens: outcome.response.outputTokens,
    // false: the call was paid but not recorded; the reservation (at the
    // estimate) still counts against the cap until ops reconciles it.
    settled
  }
}
