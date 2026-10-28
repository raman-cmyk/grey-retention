import 'server-only'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { FixtureInboundTransport } from './inbound'
import { FixtureCapture, FixtureExtraction, FixturePlaybook } from './fixtures'
import { detectSequences, microSchema } from './intelligence'
export const referenceJobKinds = ['competitors.capture', 'playbook.synthesize']
export async function runReferenceJob(
  db: SupabaseClient<Database>,
  job: Database['public']['Tables']['job_runs']['Row']
) {
  if (job.kind === 'competitors.capture') {
    const input = z.object({ captureId: z.uuid() }).parse(job.input)
    const capture = await db
      .from('competitor_captures')
      .select('domain,cursor')
      .eq('id', input.captureId)
      .single()
    if (capture.error) throw new Error('Capture access unavailable')
    const batch = await new FixtureCapture(job.created_at).capture(
      capture.data.domain,
      capture.data.cursor
    )
    const received = await new FixtureInboundTransport().receive(
      {
        synthetic: true,
        captureId: input.captureId,
        domain: capture.data.domain,
        records: batch.records
      },
      { captureId: input.captureId, domain: capture.data.domain }
    )
    const records = await Promise.all(
      received.map(async (r) => ({
        ...r,
        micro: microSchema.parse(
          await new FixtureExtraction().extract(r.externalId)
        )
      }))
    )
    const sequences = detectSequences(
      records.map((r) => ({
        id: r.externalId,
        receivedAt: r.receivedAt,
        micro: r.micro
      }))
    ).map((s) => ({
      key: s.key,
      externalIds: s.evidenceIds,
      confidence: s.confidence,
      pattern: s.pattern
    }))
    const result = await db.rpc('finish_capture_job', {
      job: job.id,
      lease: job.lease_token!,
      output: {
        synthetic: true,
        records: records.map((r) => ({
          externalId: r.externalId,
          receivedAt: r.receivedAt,
          subject: r.subject,
          text: r.text,
          micro: r.micro
        })),
        sequences
      }
    })
    if (result.error) throw result.error
  } else if (job.kind === 'playbook.synthesize') {
    const subs = await db
      .from('competitor_subscriptions')
      .select('capture_id')
      .eq('tenant_id', job.tenant_id)
      .eq('active', true)
    if (subs.error) throw new Error('Subscriptions unavailable')
    const evidence = await db
      .from('competitor_emails')
      .select('id')
      .in(
        'capture_id',
        (subs.data ?? []).map((s) => s.capture_id)
      )
    if (evidence.error) throw new Error('Evidence unavailable')
    const output = await new FixturePlaybook().synthesize(
      job.tenant_id,
      (evidence.data ?? []).map((e) => e.id)
    )
    const result = await db.rpc('finish_playbook_job', {
      job: job.id,
      lease: job.lease_token!,
      output
    })
    if (result.error) throw result.error
  } else throw new Error('Unsupported reference job')
}
