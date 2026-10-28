import type {
  AiProvider,
  AiProviderRequest,
  AiProviderResponse
} from '@/lib/providers/contracts'

/**
 * Deterministic stand-in used only when EMAIL_REWRITE_PROVIDER=sample. Its
 * output is saved and shown as a "sample rewrite", never as AI writing.
 */
export class SampleRewriteProvider implements AiProvider {
  async generate(request: AiProviderRequest): Promise<AiProviderResponse> {
    const input = JSON.parse(request.user) as {
      brand: { name: string }
      allowed_links: string[]
      source_email: { segments: { id: number; text: string }[] }
    }
    const name = input.brand.name
    return {
      content: {
        subject: `Sample subject for ${name}`,
        alternative_subjects: [`A note from ${name}`, `${name}, in brief`],
        preheader: 'Sample preview text written without AI.',
        body: `Sample body for ${name}.\n\nReplace this text with your own words, or set up AI rewriting for a real rewrite.`,
        cta_label: `Visit ${name}`,
        cta_url: input.allowed_links[0],
        segments: input.source_email.segments.map((segment, index) => ({
          id: segment.id,
          text: index === 0 ? name : 'Sample text'
        })),
        review_notes: ['This is sample text, not an AI rewrite.']
      },
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0
    }
  }
}
