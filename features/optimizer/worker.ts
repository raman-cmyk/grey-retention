import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { PersistedFixtureOptimizationProvider } from './provider'
export const optimizerJobKinds = ['optimizer.winback', 'optimizer.suppress']
export async function runOptimizerJob(
  db: SupabaseClient<Database>,
  job: Database['public']['Tables']['job_runs']['Row']
) {
  const output = await new PersistedFixtureOptimizationProvider(db).evaluate(
    job.id,
    job.lease_token!
  )
  const r = await db.rpc('finish_optimizer_job', {
    job: job.id,
    lease: job.lease_token!,
    output
  })
  if (r.error) throw r.error
}
