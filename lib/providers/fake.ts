import type {
  AiProvider,
  AiProviderRequest,
  AiProviderResponse,
  ConnectionHealth,
  ExternalRecord,
  Page,
  RetentionProvider
} from './contracts'

const emptyPage: Page<ExternalRecord> = { items: [], nextCursor: null }

export class FakeRetentionProvider implements RetentionProvider {
  async verifyConnection(): Promise<ConnectionHealth> {
    return {
      ok: true,
      checkedAt: new Date().toISOString(),
      latencyMs: 0,
      message: 'Fixture connection ready'
    }
  }

  async listLists() {
    return emptyPage
  }

  async listSegments() {
    return emptyPage
  }

  async listCampaigns() {
    return emptyPage
  }

  async listFlows() {
    return emptyPage
  }

  async listMetrics() {
    return emptyPage
  }
}

export class FakeAiProvider implements AiProvider {
  async generate(request: AiProviderRequest): Promise<AiProviderResponse> {
    return {
      content:
        request.responseKind === 'json'
          ? { fixture: true, message: 'Synthetic provider response' }
          : 'Synthetic provider response',
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0
    }
  }
}
