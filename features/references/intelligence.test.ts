import { it, expect } from 'vitest'
import {
  detectSequences,
  escapedPreviewText,
  intelligenceProfile,
  microSchema
} from './intelligence'
import { FixtureCapture, FixtureExtraction, FixturePlaybook } from './fixtures'
const micro = (
  offerCode: string | null = 'DEMO',
  sequenceHint: string | null = 'launch'
) =>
  microSchema.parse({
    offerCode,
    sequenceHint,
    product: null,
    theme: 'Synthetic education',
    strips: ['Hero', 'CTA'],
    discountPercent: 0,
    synthetic: true
  })
it('requires a sequence hint and matching offer, and splits long gaps', () => {
  const records = [
    { id: '1', receivedAt: '2026-10-01T00:00:00Z', micro: micro() },
    { id: '2', receivedAt: '2026-10-02T00:00:00Z', micro: micro() },
    { id: '3', receivedAt: '2026-10-03T00:00:00Z', micro: micro('OTHER') },
    { id: '4', receivedAt: '2026-10-10T00:00:00Z', micro: micro('OTHER') },
    { id: '5', receivedAt: '2026-10-11T00:00:00Z', micro: micro(null, null) }
  ]
  const result = detectSequences(records)
  expect(result).toHaveLength(3)
  expect(result[0]?.evidenceIds).toEqual(['1', '2'])
  expect(result[0]?.confidence).toBe('supported')
  expect(result[1]?.confidence).toBe('candidate')
})
it('sanitizes hostile capture into text and returns incomplete evidence transparently', () => {
  const text = escapedPreviewText(
    '<script>secretFixture()</script><style>body{}</style><img src=x onerror=x><p>Original fictional note</p>'
  )
  expect(text).toBe('Original fictional note')
  expect(
    intelligenceProfile([
      { id: 'one', receivedAt: '2026-10-01T00:00:00Z', micro: micro() }
    ])
  ).toMatchObject({ complete: false, emailsPerWeek: null, discountShare: 0 })
})
it('uses original synthetic fixture capture and structural synthesis with evidence thresholds', async () => {
  const capture = await new FixtureCapture().capture('fictional.example', null)
  expect(capture.records).toHaveLength(10)
  expect(await new FixtureExtraction().extract('fixture-v1-1')).toMatchObject({
    synthetic: true,
    sequenceHint: 'launch'
  })
  await expect(new FixtureCapture().capture('real.com', null)).rejects.toThrow()
  await expect(
    new FixturePlaybook().synthesize('tenant', Array(29).fill('e'))
  ).rejects.toThrow()
  const patterns = await new FixturePlaybook().synthesize(
    'tenant',
    Array.from({ length: 30 }, (_, i) => String(i))
  )
  expect(patterns.patterns.join(' ')).not.toContain(
    'Original fictional reference'
  )
  expect(patterns.evidenceIds).toHaveLength(30)
})

it('validates fixture inbound identity and rejects extra private envelope fields', async () => {
  const { FixtureInboundTransport } = await import('./inbound')
  const id = '00000000-0000-4000-8000-000000000999',
    port = new FixtureInboundTransport(),
    batch = await new FixtureCapture().capture('source.example', null)
  const input = {
    synthetic: true,
    captureId: id,
    domain: 'source.example',
    records: batch.records
  }
  expect(
    await port.receive(input, { captureId: id, domain: 'source.example' })
  ).toHaveLength(10)
  await expect(
    port.receive(input, { captureId: id, domain: 'other.example' })
  ).rejects.toThrow()
  await expect(
    port.receive(
      { ...input, privateRules: 'must never be shared' },
      { captureId: id, domain: 'source.example' }
    )
  ).rejects.toThrow()
})
