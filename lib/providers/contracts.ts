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

export interface AiProviderRequest {
  system: string
  user: string
  model: string
  maxOutputTokens: number
  temperature: number
  responseKind: 'json' | 'text'
}

export interface AiProviderResponse {
  content: unknown
  inputTokens: number
  outputTokens: number
  latencyMs: number
}

export interface AiProvider {
  generate(request: AiProviderRequest): Promise<AiProviderResponse>
}
