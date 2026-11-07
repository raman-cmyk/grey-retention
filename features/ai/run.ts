import 'server-only'
import {
  AiProviderError,
  type AiFailureKind,
  type AiProvider,
  type AiProviderRequest
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
  copy: 'copy'
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

/**
 * The one entry point for v2 AI calls (labelling and copy). It picks the
 * provider from server settings, reserves the request's upper-bound cost
 * against the client's allowance before anything is sent, and settles the
 * real cost afterwards. Over the cap, nothing is sent.
 */
export async function runAi(
  input: {
    tenantId: string
    /** Stable per logical attempt, so a retry reuses its reservation. */
    operationId: string
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
      outputTokens: response.outputTokens
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
    body,
    request.maxOutputTokens
  )
  const reservation = await deps.ledger.reserve({
    tenantId: input.tenantId,
    operationId: input.operationId,
    feature: purposeFeature[input.purpose],
    estimateMicro: estimate
  })
  if (!reservation.ok) return { ok: false, code: reservation.code }
  const settle = (actualMicro: number) =>
    deps.ledger.settle({
      tenantId: input.tenantId,
      reservationId: reservation.reservationId,
      actualMicro
    })
  const provider = new GeminiProvider({
    apiKey: setup.apiKey,
    fetch: deps.fetch
  })
  try {
    const response = await provider.generate(request)
    const cost = geminiCostMicro(setup.model, response)
    await settle(cost)
    return {
      ok: true,
      content: response.content,
      provider: 'gemini',
      model: setup.model,
      costMicro: cost,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens
    }
  } catch (error) {
    if (!(error instanceof AiProviderError)) {
      await settle(estimate)
      throw error
    }
    // none: provably unbilled. usage: bill what was used. unknown: assume
    // the whole reservation was spent.
    await settle(
      error.billing === 'none'
        ? 0
        : error.billing === 'usage' && error.details.usage
          ? geminiCostMicro(setup.model, error.details.usage)
          : estimate
    )
    return {
      ok: false,
      code: error.kind,
      retryAfterSeconds: error.details.retryAfterSeconds,
      diagnostic: error.details.diagnostic
    }
  }
}
