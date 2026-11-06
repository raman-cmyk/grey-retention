import 'server-only'
import {
  AiProviderError,
  type AiProvider,
  type AiProviderRequest,
  type AiProviderResponse
} from '@/lib/providers/contracts'

// Responses API adapter using native fetch, following
// https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses
// and https://developers.openai.com/api/docs/guides/error-codes (read 2026-10-29).

/** Largest accepted response body; larger bodies are aborted unread. */
export const maxResponseBytes = 1_048_576
const maxErrorBytes = 65_536

const accountCodes = new Set([
  'insufficient_quota',
  'credit_balance_exhausted',
  'organization_spend_limit_exceeded',
  'project_spend_limit_exceeded',
  'organization_usage_limit_exceeded'
])
// Only failures that prove no connection was made are known to be unbilled.
// A reset or socket error may happen after the request reached the provider.
const notConnectedCauses = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED'])

type Usage = {
  inputTokens: number
  outputTokens: number
  cachedInputTokens?: number
}

/** Provider strings are untrusted: keep only short identifier-like values. */
const token = (value: unknown, max = 64) =>
  typeof value === 'string' &&
  /^[A-Za-z0-9_.:-]+$/.test(value) &&
  value.length <= max
    ? value
    : value
      ? 'other'
      : ''

/** The exact JSON body sent; also the input to the cost ceiling. */
export function responsesRequestBody(request: AiProviderRequest) {
  if (!request.schema)
    throw new AiProviderError('rejected_request', 'none', {
      diagnostic: 'schema_required'
    })
  return JSON.stringify({
    model: request.model,
    instructions: request.system,
    input: request.user,
    max_output_tokens: request.maxOutputTokens,
    ...(request.reasoningEffort
      ? { reasoning: { effort: request.reasoningEffort } }
      : {}),
    // Pasted source and brand facts are not kept by the provider for retrieval.
    store: false,
    ...(request.safetyIdentifier
      ? { safety_identifier: request.safetyIdentifier }
      : {}),
    text: {
      format: {
        type: 'json_schema',
        name: request.schema.name,
        schema: request.schema.definition,
        strict: true
      }
    }
  })
}

function usageOf(body: unknown): Usage | undefined {
  const usage = (body as { usage?: Record<string, unknown> } | null)?.usage
  if (!usage || typeof usage !== 'object') return undefined
  const input = Number(usage.input_tokens)
  const output = Number(usage.output_tokens)
  if (
    !Number.isSafeInteger(input) ||
    !Number.isSafeInteger(output) ||
    input < 0 ||
    output < 0
  )
    return undefined
  const details = usage.input_tokens_details as
    { cached_tokens?: unknown } | undefined
  const cached = Number(details?.cached_tokens ?? 0)
  return {
    inputTokens: input,
    outputTokens: output,
    cachedInputTokens: Number.isSafeInteger(cached) && cached >= 0 ? cached : 0
  }
}

function retryAfter(headers: Headers) {
  const raw = headers.get('retry-after')
  if (!raw) return undefined
  const seconds = Number(raw)
  if (Number.isFinite(seconds))
    return Math.max(0, Math.min(300, Math.ceil(seconds)))
  const date = Date.parse(raw)
  return Number.isFinite(date)
    ? Math.max(0, Math.min(300, Math.ceil((date - Date.now()) / 1000)))
    : undefined
}

class BodyTooLarge extends Error {}

/** Reads at most `limit` bytes, cancelling the stream beyond it. */
async function readBounded(response: Response, limit: number) {
  const length = Number(response.headers.get('content-length'))
  if (Number.isFinite(length) && length > limit) {
    await response.body?.cancel().catch(() => undefined)
    throw new BodyTooLarge()
  }
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel().catch(() => undefined)
      throw new BodyTooLarge()
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

export class OpenAiResponsesProvider implements AiProvider {
  constructor(
    private readonly config: {
      apiKey: string
      baseUrl: string
      fetch?: typeof fetch
    }
  ) {}

  async generate(request: AiProviderRequest): Promise<AiProviderResponse> {
    const body = responsesRequestBody(request)
    const started = Date.now()
    const controller = new AbortController()
    const timer = setTimeout(
      () => controller.abort(),
      request.timeoutMs ?? 60_000
    )
    const doFetch = this.config.fetch ?? fetch
    let response: Response
    let text: string | null
    try {
      try {
        response = await doFetch(`${this.config.baseUrl}/responses`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.config.apiKey}`,
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
        const connected = !notConnectedCauses.has(String(cause))
        throw new AiProviderError(
          'unavailable',
          connected ? 'unknown' : 'none',
          {
            diagnostic: `network:${token(cause, 32) || 'error'}`
          }
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
    const requestId = token(response.headers.get('x-request-id'), 80)
    const diagnostic = (code: string) =>
      [String(status), code, requestId && `request:${requestId}`]
        .filter(Boolean)
        .join(' ')
    if (!response.ok) {
      const error = (
        parsed as { error?: { code?: unknown; type?: unknown } } | null
      )?.error
      const code = token(error?.code)
      const type = token(error?.type)
      if (status === 401)
        throw new AiProviderError('setup_required', 'none', {
          diagnostic: diagnostic('invalid_api_key')
        })
      if (
        status === 403 ||
        (status === 429 &&
          (accountCodes.has(code) || type === 'insufficient_quota'))
      )
        throw new AiProviderError('provider_account', 'none', {
          diagnostic: diagnostic(code || type || 'account')
        })
      if (status === 429)
        throw new AiProviderError('rate_limited', 'none', {
          retryAfterSeconds: retryAfter(response.headers),
          diagnostic: diagnostic(code || 'rate_limit')
        })
      // A server error or timeout may follow accepted work: outcome unknown.
      if (status >= 500 || status === 408 || status === 409)
        throw new AiProviderError('unavailable', 'unknown', {
          diagnostic: diagnostic(code || 'server_error')
        })
      throw new AiProviderError('rejected_request', 'none', {
        diagnostic: diagnostic(code || 'invalid_request')
      })
    }
    const usage = usageOf(parsed)
    const billing = usage ? 'usage' : 'unknown'
    const result = parsed as {
      id?: unknown
      model?: unknown
      status?: unknown
      incomplete_details?: { reason?: unknown } | null
      error?: { code?: unknown } | null
      output?: unknown
    } | null
    if (!result || typeof result !== 'object')
      throw new AiProviderError('invalid_output', 'unknown', {
        diagnostic: diagnostic('unreadable_body')
      })
    if (result.status === 'incomplete')
      throw new AiProviderError('incomplete', billing, {
        usage,
        diagnostic: diagnostic(
          `incomplete:${token(result.incomplete_details?.reason, 32) || 'unknown'}`
        )
      })
    if (result.status === 'failed') {
      const code = token(result.error?.code) || 'failed'
      throw new AiProviderError(
        code === 'rate_limit_exceeded'
          ? 'rate_limited'
          : code === 'server_error'
            ? 'unavailable'
            : 'invalid_output',
        billing,
        { usage, diagnostic: diagnostic(code) }
      )
    }
    if (result.status !== 'completed')
      throw new AiProviderError('invalid_output', billing, {
        usage,
        diagnostic: diagnostic(`status:${token(result.status, 16)}`)
      })
    const items = Array.isArray(result.output) ? result.output : []
    const message = items.find(
      (item): item is { type: string; content?: unknown } =>
        !!item &&
        typeof item === 'object' &&
        (item as { type?: unknown }).type === 'message'
    )
    const parts = (
      Array.isArray(message?.content) ? message.content : []
    ) as Array<{
      type?: unknown
      text?: unknown
    } | null>
    if (parts.some((part) => part?.type === 'refusal'))
      throw new AiProviderError('refused', billing, {
        usage,
        diagnostic: diagnostic('refusal')
      })
    const output = parts.find(
      (part) => part?.type === 'output_text' && typeof part.text === 'string'
    )?.text as string | undefined
    if (!output || !usage)
      throw new AiProviderError('invalid_output', billing, {
        usage,
        diagnostic: diagnostic(output ? 'usage_missing' : 'no_output_text')
      })
    let content: unknown
    try {
      content = JSON.parse(output)
    } catch {
      throw new AiProviderError('invalid_output', 'usage', {
        usage,
        diagnostic: diagnostic('malformed_json')
      })
    }
    return {
      content,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      latencyMs: Date.now() - started,
      providerResponseId: token(result.id, 120) || undefined,
      model: token(result.model, 80) || undefined
    }
  }
}
