import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import {
  optimizerPayloadSchema,
  type ProfileOptimizationProvider
} from './contracts'
export class PersistedFixtureOptimizationProvider implements ProfileOptimizationProvider {
  constructor(private db: SupabaseClient<Database>) {}
  async evaluate(job: string, lease: string) {
    const r = await this.db.rpc('fixture_optimizer_payload', { job, lease })
    if (r.error) throw r.error
    return optimizerPayloadSchema.parse(r.data)
  }
}
export class DisabledLiveOptimizationProvider implements ProfileOptimizationProvider {
  async evaluate(): Promise<never> {
    throw new Error(
      'Live suppression and messaging are unavailable; no account transport is configured.'
    )
  }
}
