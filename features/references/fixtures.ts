import type {
  CapturePort,
  ExtractionPort,
  PlaybookPort
} from '@/features/workflow/domain/contracts'
import { microSchema } from './intelligence'
export class FixtureCapture implements CapturePort {
  constructor(private anchor = '2026-10-01T12:00:00Z') {}
  async capture(domain: string, cursor: string | null) {
    if (
      !/^[a-z0-9][a-z0-9.-]*\.example$/.test(domain) ||
      (cursor && cursor !== 'fixture-v1')
    )
      throw new Error('Only fictional capture sources are available')
    const epoch = Date.parse(this.anchor)
    return {
      records: Array.from({ length: 10 }, (_, n) => ({
        externalId: `fixture-v1-${n}`,
        receivedAt: new Date(epoch - (9 - n) * 86400000).toISOString(),
        subject: `Original fictional reference ${n + 1} from ${domain}`,
        html: `<h1>Fictional ${n < 3 ? 'launch note' : 'collection note'} ${n + 1}</h1><p>Original synthetic capture used to study layout and cadence only.</p>${n === 0 ? '<script>hostileFixture()</script><img src="https://tracking.invalid/pixel" onerror="hostileFixture()">' : ''}`
      })),
      nextCursor: 'fixture-v1',
      synthetic: true
    }
  }
}
export class FixtureExtraction implements ExtractionPort {
  async extract(captureId: string) {
    const n = Number(captureId.split('-').at(-1))
    if (!Number.isInteger(n) || n < 0 || n > 9)
      throw new Error('Unknown fixture capture evidence')
    return microSchema.parse({
      offerCode: n < 3 ? 'FICTIONAL-LAUNCH' : null,
      product: null,
      theme: n < 3 ? 'Product education sequence' : 'Evergreen editorial',
      strips: ['Hero', 'Story', 'One CTA', 'Footer'],
      discountPercent: n < 2 ? 10 : 0,
      sequenceHint: n < 3 ? 'launch' : null,
      synthetic: true
    })
  }
}
export class FixturePlaybook implements PlaybookPort {
  async synthesize(tenantId: string, evidenceIds: string[]) {
    if (!tenantId || evidenceIds.length < 30)
      throw new Error('At least three complete capture sources are required')
    return {
      patterns: [
        'Use a hero, one focused explanation and a single clear CTA.',
        'Treat sequence clusters as candidates; owner offer rules and cadence guards take precedence.'
      ],
      evidenceIds,
      synthetic: true
    }
  }
}
