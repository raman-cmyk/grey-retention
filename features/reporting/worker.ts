import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { z } from 'zod'
import { PersistedFixtureDeliveryProvider } from '@/features/integrations/fixture-delivery'
export const reportingJobKinds = [
  'results.pull',
  'reports.digest',
  'learning.synthesize'
]
export async function runReportingJob(
  db: SupabaseClient<Database>,
  job: Database['public']['Tables']['job_runs']['Row']
) {
  if (job.kind === 'results.pull') {
    const input = z
      .object({ deliveryId: z.uuid(), window: z.enum(['48h', '7d']) })
      .parse(job.input)
    const output = await new PersistedFixtureDeliveryProvider(db, job).results(
      input.deliveryId,
      input.window
    )
    const r = await db.rpc('finish_result_job', {
      job: job.id,
      lease: job.lease_token!,
      output
    })
    if (r.error) throw r.error
  } else {
    const r =
      job.kind === 'reports.digest'
        ? await db.rpc('finish_result_digest', {
            job: job.id,
            lease: job.lease_token!
          })
        : await db.rpc('finish_learning_job', {
            job: job.id,
            lease: job.lease_token!
          })
    if (r.error) throw r.error
  }
}
