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

/** The exact JSON body sent; also the input to the cost ceiling. */
export function geminiRequestBody(request: AiProviderRequest) {
  if (request.responseKind === 'json' && !request.schema)
    throw new AiProviderError('rejected_request', 'none', {
      diagnostic: 'schema_required'
    })
  return JSON.stringify({
    systemInstruction: { parts: [{ text: request.system }] },
    contents: [{ role: 'user', parts: [{ text: request.user }] }],
    generationConfig: {
      maxOutputTokens: request.maxOutputTokens,
      temperature: request.temperature,
      ...(request.responseKind === 'json'
        ? {
            responseMimeType: 'application/json',
            responseJsonSchema: request.schema!.definition
          }
        : {}),
      // Thinking budgets apply to 2.5 models; 3.x models choose their own.
      ...(request.reasoningEffort && request.model.startsWith('gemini-2.5')
        ? {
            thinkingConfig: {
              thinkingBudget: thinkingBudgets[request.reasoningEffort]
            }
          }
        : {})
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
      const diagnostic = [String(status), code, ...reasons]
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
