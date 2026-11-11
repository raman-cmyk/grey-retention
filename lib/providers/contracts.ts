export type Page<T> = {
  items: T[]
  nextCursor: string | null
}

export type ConnectionHealth = {
  ok: boolean
  checkedAt: string
  latencyMs: number
  message: string
}

export interface ExternalRecord {
  externalId: string
  updatedAt?: string
  raw: Record<string, unknown>
}

export interface RetentionProvider {
  verifyConnection(): Promise<ConnectionHealth>
  listLists(cursor?: string): Promise<Page<ExternalRecord>>
  listSegments(cursor?: string): Promise<Page<ExternalRecord>>
  listCampaigns(cursor?: string): Promise<Page<ExternalRecord>>
  listFlows(cursor?: string): Promise<Page<ExternalRecord>>
  listMetrics(cursor?: string): Promise<Page<ExternalRecord>>
}

export type AiImage = {
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp'
  /** Base64 without a data: prefix. */
  base64: string
}

export interface AiProviderRequest {
  system: string
  user: string
  model: string
  maxOutputTokens: number
  temperature: number
  responseKind: 'json' | 'text'
  /** Strict JSON Schema for structured output; required by real JSON adapters. */
  schema?: { name: string; definition: Record<string, unknown> }
  reasoningEffort?: 'none' | 'low' | 'medium'
  timeoutMs?: number
  /** Hashed, non-identifying end-user identifier for provider abuse checks. */
  safetyIdentifier?: string
  /**
   * Pictures sent with the task (section crops, email screenshots). Only
   * JPEG, PNG and WebP; the adapter sends them after the task text.
   */
  images?: AiImage[]
}

export interface AiProviderResponse {
  content: unknown
  inputTokens: number
  outputTokens: number
  latencyMs: number
  cachedInputTokens?: number
  providerResponseId?: string
  model?: string
}

export interface AiProvider {
  generate(request: AiProviderRequest): Promise<AiProviderResponse>
}

/**
 * Typed provider failure. `billing` says whether the provider may have
 * charged: `none` (rejected before work), `usage` (usage is attached) or
 * `unknown` (the outcome could not be observed, so assume the full estimate).
 */
export type AiFailureKind =
  | 'setup_required'
  | 'provider_account'
  | 'rate_limited'
  | 'unavailable'
  | 'timeout'
  | 'refused'
  | 'incomplete'
  | 'invalid_output'
  | 'rejected_request'

export class AiProviderError extends Error {
  constructor(
    readonly kind: AiFailureKind,
    readonly billing: 'none' | 'usage' | 'unknown',
    readonly details: {
      usage?: {
        inputTokens: number
        outputTokens: number
        cachedInputTokens?: number
      }
      retryAfterSeconds?: number
      /** Redacted diagnostic: status/code only, never prompt or output text. */
      diagnostic?: string
    } = {}
  ) {
    super(`AI provider ${kind}`)
  }
}
