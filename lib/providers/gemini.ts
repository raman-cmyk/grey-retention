import 'server-only'
import {
  AiProviderError,
  type AiProvider,
  type AiProviderRequest,
  type AiProviderResponse
} from './contracts'
import {
  BodyTooLarge,
  readBounded,
  retryAfterSeconds,
  safeToken
} from './bounded-read'

// Gemini generateContent adapter using native fetch, following
// https://ai.google.dev/api/generate-content (read 2026-11-07). The key goes
// in the x-goog-api-key header, never in the URL, so it can't leak into logs.

export const geminiBaseUrl = 'https://generativelanguage.googleapis.com/v1beta'
export const maxResponseBytes = 1_048_576
const maxErrorBytes = 65_536
/** Fixed categories only: provider messages can echo private input. */
function requestRejection(body: unknown): string | undefined {
  const message = (body as { error?: { message?: unknown } } | null)?.error
    ?.message
  if (typeof message !== 'string') return undefined
  if (/schema|too many states/i.test(message)) return 'schema_rejected'
  if (/thinking|reasoning/i.test(message)) return 'thinking_rejected'
  return undefined
}
const notConnectedCauses = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED'])
const refusalReasons = new Set([
  'SAFETY',
  'RECITATION',
  'BLOCKLIST',
  'PROHIBITED_CONTENT',
  'SPII',
  'LANGUAGE'
])
const thinkingBudgets = { none: 0, low: 1_024, medium: 4_096 } as const
/** 2.5 Pro cannot switch thinking off; this is its smallest budget. */
const proMinThinking = 128
/**
 * Room kept for thinking when the model decides how much to think itself:
 * any 3.x model, and 2.5 Flash or Pro with no effort set. 2.5 Flash-Lite
 * does not think unless asked.
 */
export const selfThinkingAllowance = 4_096
/**
 * AI-MDL-001: room kept for a 3.x model asked to think at `MEDIUM`, or left
 * to its own default (`MEDIUM` on 3.8 Flash, `HIGH` on 3 Flash Preview). A
 * level caps depth, not tokens, and Google says 3.8 Flash uses more tokens
 * by design, so the answer room of a planning agent (2,000 to 3,000) would
 * otherwise be eaten by thinking and come back `incomplete`. Not measured
 * yet: the paid live run of the golden set checks it.
 */
export const deepThinkingAllowance = 16_384
/** The largest answer the supported models give. */
const maxModelOutput = 65_536

/** 2.5 models take a thinking budget; 3.x models take a level instead. */
const isGemini25 = (model: string) => model.startsWith('gemini-2.5')

/**
 * Models that still take `temperature`. Google ignores it from 3.6 Flash and
 * 3.5 Flash-Lite on and says later models will refuse it (read 2026-11-24),
 * so a model added to the price table gets none unless listed here.
 */
const takesTemperature = (model: string) =>
  isGemini25(model) ||
  model === 'gemini-3.1-flash-lite' ||
  model === 'gemini-3-flash-preview'

/**
 * The 3.x models that take the `MINIMAL` thinking level (Google's thinking
 * guide, read 2026-11-24). 3.8 Flash refuses it, so "none" asks it for `LOW`.
 */
const minimalThinkingModels = new Set([
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3-flash-preview'
])

/**
 * The thinking budget sent for this request, or null when none is sent
 * (3.x models take a level instead; no effort means the model's default).
 */
export function geminiThinkingBudget(
  request: Pick<AiProviderRequest, 'model' | 'reasoningEffort'>
): number | null {
  if (!request.reasoningEffort || !isGemini25(request.model)) return null
  const budget = thinkingBudgets[request.reasoningEffort]
  return request.model.startsWith('gemini-2.5-pro')
    ? Math.max(budget, proMinThinking)
    : budget
}

/**
 * AI-MDL-001: the thinking level sent to a 3.x model, or null when none is
 * sent (2.5 models, which refuse a level, or no effort: the model's
 * default). Without a level 3 Flash Preview thinks at `HIGH` by default,
 * which ran past the 15-second agent call cap in the first live run
 * (24 November 2026). The effort maps to the level of the same name; "none"
 * is `MINIMAL` where the model has it and `LOW` where it does not.
 */
export function geminiThinkingLevel(
  request: Pick<AiProviderRequest, 'model' | 'reasoningEffort'>
): 'MINIMAL' | 'LOW' | 'MEDIUM' | null {
  if (!request.reasoningEffort || isGemini25(request.model)) return null
  if (request.reasoningEffort === 'medium') return 'MEDIUM'
  if (request.reasoningEffort === 'low') return 'LOW'
  return minimalThinkingModels.has(request.model) ? 'MINIMAL' : 'LOW'
}

/** Output kept for thinking on this request. */
function thinkingRoom(
  request: Pick<AiProviderRequest, 'model' | 'reasoningEffort'>
) {
  const budget = geminiThinkingBudget(request)
  if (budget !== null) return budget
  if (request.model.startsWith('gemini-2.5-flash-lite')) return 0
  if (isGemini25(request.model)) return selfThinkingAllowance
  const level = geminiThinkingLevel(request)
  return level === 'MINIMAL' || level === 'LOW'
    ? selfThinkingAllowance
    : deepThinkingAllowance
}

/**
 * Gemini counts thinking tokens as output, so a cut-off at
 * `maxOutputTokens` can land inside the thinking and leave no answer
 * (`incomplete`). `maxOutputTokens` in a request is the room for the answer;
 * the thinking room is added on top here, and the cost estimate uses the
 * same number. The total never goes over the model's largest answer, so an
 * answer room near 65,536 with thinking gets less than it asked for.
 */
export function geminiOutputTokens(
  request: Pick<
    AiProviderRequest,
    'model' | 'reasoningEffort' | 'maxOutputTokens'
  >
) {
  return Math.min(
    maxModelOutput,
    request.maxOutputTokens + thinkingRoom(request)
  )
}

/** The exact JSON body sent; also the input to the cost ceiling. */
export function geminiRequestBody(request: AiProviderRequest) {
  if (request.responseKind === 'json' && !request.schema)
    throw new AiProviderError('rejected_request', 'none', {
      diagnostic: 'schema_required'
    })
  const budget = geminiThinkingBudget(request)
  const level = geminiThinkingLevel(request)
  return JSON.stringify({
    systemInstruction: { parts: [{ text: request.system }] },
    contents: [
      {
        role: 'user',
        parts: [
          { text: request.user },
          ...(request.images ?? []).map((image) => ({
            inlineData: { mimeType: image.mediaType, data: image.base64 }
          }))
        ]
      }
    ],
    generationConfig: {
      maxOutputTokens: geminiOutputTokens(request),
      ...(takesTemperature(request.model)
        ? { temperature: request.temperature }
        : {}),
      ...(request.responseKind === 'json'
        ? {
            responseMimeType: 'application/json',
            responseJsonSchema: request.schema!.definition
          }
        : {}),
      // 2.5 models take a thinking budget, 3.x models a thinking level.
      ...(budget !== null
        ? { thinkingConfig: { thinkingBudget: budget } }
        : {}),
      ...(level !== null ? { thinkingConfig: { thinkingLevel: level } } : {})
    }
  })
}

type Usage = {
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
}

function count(value: unknown) {
  const n = Number(value ?? 0)
  return Number.isSafeInteger(n) && n >= 0 ? n : null
}

/** Thinking tokens are billed as output, so they count as output here. */
export function geminiUsage(body: unknown): Usage | undefined {
  const meta = (body as { usageMetadata?: Record<string, unknown> } | null)
    ?.usageMetadata
  if (!meta || typeof meta !== 'object') return undefined
  // Missing counts mean the bill is unknown, not zero.
  if (meta.promptTokenCount === undefined) return undefined
  if (
    meta.candidatesTokenCount === undefined &&
    meta.thoughtsTokenCount === undefined
  )
    return undefined
  const input = count(meta.promptTokenCount)
  const candidates = count(meta.candidatesTokenCount)
  const thoughts = count(meta.thoughtsTokenCount)
  const cached = count(meta.cachedContentTokenCount)
  if (input === null || candidates === null || thoughts === null)
    return undefined
  return {
    inputTokens: input,
    outputTokens: candidates + thoughts,
    cachedInputTokens: Math.min(cached ?? 0, input)
  }
}

/** Gemini puts its own retry hint in error.details (RetryInfo "30s"). */
function retryHint(body: unknown, headers: Headers) {
  const fromHeader = retryAfterSeconds(headers)
  if (fromHeader !== undefined) return fromHeader
  const details = (body as { error?: { details?: unknown } } | null)?.error
    ?.details
  if (!Array.isArray(details)) return undefined
  for (const d of details) {
    const delay = (d as { retryDelay?: unknown } | null)?.retryDelay
    if (typeof delay === 'string' && /^\d+(\.\d+)?s$/.test(delay))
      return Math.max(0, Math.min(300, Math.ceil(parseFloat(delay))))
  }
  return undefined
}

function errorReasons(body: unknown) {
  const details = (body as { error?: { details?: unknown } } | null)?.error
    ?.details
  return Array.isArray(details)
    ? details.map((d) => safeToken((d as { reason?: unknown })?.reason))
    : []
}

export class GeminiProvider implements AiProvider {
  constructor(
    private readonly config: {
      apiKey: string
      baseUrl?: string
      fetch?: typeof fetch
    }
  ) {}

  async generate(request: AiProviderRequest): Promise<AiProviderResponse> {
    const body = geminiRequestBody(request)
    if (!/^[a-z0-9.-]+$/.test(request.model))
      throw new AiProviderError('rejected_request', 'none', {
        diagnostic: 'invalid_model'
      })
    const started = Date.now()
    const controller = new AbortController()
    const timer = setTimeout(
      () => controller.abort(),
      request.timeoutMs ?? 60_000
    )
    const doFetch = this.config.fetch ?? fetch
    const url = `${this.config.baseUrl ?? geminiBaseUrl}/models/${request.model}:generateContent`
    let response: Response
    let text: string | null
    try {
      try {
        response = await doFetch(url, {
          method: 'POST',
          headers: {
            'x-goog-api-key': this.config.apiKey,
            'content-type': 'application/json'
          },
          body,
          signal: controller.signal,
          redirect: 'error',
          cache: 'no-store'
        })
      } catch (error) {
        if (controller.signal.aborted)
          throw new AiProviderError('timeout', 'unknown', {
            diagnostic: 'timeout'
          })
        const cause = (error as { cause?: { code?: unknown } })?.cause?.code
        throw new AiProviderError(
          'unavailable',
          notConnectedCauses.has(String(cause)) ? 'none' : 'unknown',
          { diagnostic: `network:${safeToken(cause, 32) || 'error'}` }
        )
      }
      try {
        text = await readBounded(
          response,
          response.ok ? maxResponseBytes : maxErrorBytes
        )
      } catch (error) {
        if (controller.signal.aborted)
          throw new AiProviderError('timeout', 'unknown', {
            diagnostic: 'timeout'
          })
        if (error instanceof BodyTooLarge && !response.ok) text = null
        else
          throw new AiProviderError('invalid_output', 'unknown', {
            diagnostic:
              error instanceof BodyTooLarge ? 'response_too_large' : 'body_read'
          })
      }
    } finally {
      clearTimeout(timer)
    }
    let parsed: unknown = null
    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      parsed = null
    }
    const status = response.status
    if (!response.ok) {
      const code = safeToken(
        (parsed as { error?: { status?: unknown } } | null)?.error?.status
      )
      const reasons = errorReasons(parsed)
      const diagnostic = [
        String(status),
        code,
        ...reasons,
        ...(status === 400 ? [requestRejection(parsed)] : [])
      ]
        .filter(Boolean)
        .join(' ')
      if (
        status === 401 ||
        status === 403 ||
        reasons.includes('API_KEY_INVALID') ||
        code === 'UNAUTHENTICATED' ||
        code === 'PERMISSION_DENIED'
      )
        throw new AiProviderError('setup_required', 'none', { diagnostic })
      if (status === 429)
        throw new AiProviderError('rate_limited', 'none', {
          retryAfterSeconds: retryHint(parsed, response.headers),
          diagnostic
        })
      // Billing not enabled, or the free tier isn't offered for this project.
      if (code === 'FAILED_PRECONDITION')
        throw new AiProviderError('provider_account', 'none', { diagnostic })
      if (status >= 500 || status === 408)
        throw new AiProviderError('unavailable', 'unknown', { diagnostic })
      throw new AiProviderError('rejected_request', 'none', { diagnostic })
    }
    const result = parsed as {
      candidates?: unknown
      promptFeedback?: { blockReason?: unknown } | null
      responseId?: unknown
      modelVersion?: unknown
    } | null
    if (!result || typeof result !== 'object')
      throw new AiProviderError('invalid_output', 'unknown', {
        diagnostic: `${status} unreadable_body`
      })
    const usage = geminiUsage(result)
    const billing = usage ? 'usage' : 'unknown'
    const blocked = safeToken(result.promptFeedback?.blockReason, 32)
    if (blocked)
      throw new AiProviderError('refused', billing, {
        usage,
        diagnostic: `prompt_blocked:${blocked}`
      })
    const candidate = (
      Array.isArray(result.candidates) ? result.candidates[0] : undefined
    ) as
      | {
          finishReason?: unknown
          content?: { parts?: unknown } | null
        }
      | undefined
    if (!candidate)
      throw new AiProviderError('invalid_output', billing, {
        usage,
        diagnostic: 'no_candidate'
      })
    const finish = safeToken(candidate.finishReason, 40)
    if (finish === 'MAX_TOKENS' || finish === 'CONTINUATION')
      throw new AiProviderError('incomplete', billing, {
        usage,
        diagnostic: `incomplete:${finish}`
      })
    if (refusalReasons.has(finish))
      throw new AiProviderError('refused', billing, {
        usage,
        diagnostic: `finish:${finish}`
      })
    if (finish !== 'STOP')
      throw new AiProviderError('invalid_output', billing, {
        usage,
        diagnostic: `finish:${finish || 'missing'}`
      })
    const parts = Array.isArray(candidate.content?.parts)
      ? (candidate.content.parts as Array<{
          text?: unknown
          thought?: unknown
        } | null>)
      : []
    const output = parts
      .filter((p) => p && p.thought !== true && typeof p.text === 'string')
      .map((p) => p!.text as string)
      .join('')
    if (!output || !usage)
      throw new AiProviderError('invalid_output', billing, {
        usage,
        diagnostic: output ? 'usage_missing' : 'no_output_text'
      })
    let content: unknown = output
    if (request.responseKind === 'json') {
      try {
        content = JSON.parse(output)
      } catch {
        throw new AiProviderError('invalid_output', 'usage', {
          usage,
          diagnostic: 'malformed_json'
        })
      }
    }
    return {
      content,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      latencyMs: Date.now() - started,
      providerResponseId: safeToken(result.responseId, 120) || undefined,
      model: safeToken(result.modelVersion, 80) || undefined
    }
  }
}
