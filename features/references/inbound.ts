import { z } from 'zod'
import { escapedPreviewText } from './intelligence'
const envelopeSchema = z.strictObject({
  synthetic: z.literal(true),
  captureId: z.uuid(),
  domain: z.string().regex(/^[a-z0-9][a-z0-9.-]*\.example$/),
  records: z
    .array(
      z.strictObject({
        externalId: z.string().regex(/^fixture-v1-[0-9]$/),
        receivedAt: z.iso.datetime(),
        subject: z.string().min(1).max(200),
        html: z.string().max(20000)
      })
    )
    .max(10)
})
export type InboundEnvelope = z.infer<typeof envelopeSchema>
export interface InboundCaptureTransport {
  receive(
    input: unknown,
    expected: { captureId: string; domain: string }
  ): Promise<
    { externalId: string; receivedAt: string; subject: string; text: string }[]
  >
}
/** Fixture-only transport; there is no public endpoint or live mailbox in this build. */
export class FixtureInboundTransport implements InboundCaptureTransport {
  async receive(
    input: unknown,
    expected: { captureId: string; domain: string }
  ) {
    const envelope = envelopeSchema.parse(input)
    if (
      envelope.captureId !== expected.captureId ||
      envelope.domain !== expected.domain
    )
      throw new Error('Capture envelope identity mismatch')
    return envelope.records.map((r) => ({
      externalId: r.externalId,
      receivedAt: r.receivedAt,
      subject: r.subject,
      text: escapedPreviewText(r.html)
    }))
  }
}
