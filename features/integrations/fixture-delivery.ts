import { ProviderFault } from './failures'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Database } from '@/lib/supabase/database.types'
import type {
  CampaignResults,
  DeliveryIdentity,
  DeliveryPackage,
  DeliveryProvider,
  Reconciliation
} from '@/features/workflow/domain/contracts'
export const identitySchema = z.object({
  id: z.uuid(),
  packageId: z.uuid(),
  state: z.enum(['prepared', 'scheduled', 'sent', 'cancelled']),
  scheduledAt: z.string().nullable()
})
const reconcileSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('found'), identity: identitySchema }),
  z.object({ outcome: z.enum(['absent', 'unknown']) })
])
/** Runtime fake provider state is persisted in Postgres, never in an application Map. */
export class PersistedFixtureDeliveryProvider implements DeliveryProvider {
  constructor(
    private db: SupabaseClient<Database>,
    private job: {
      id: string
      lease_token: string | null
      idempotency_key: string
    }
  ) {}
  private async command(command: string) {
    if (!this.job.lease_token) throw new Error('Missing job lease')
    const { data, error } = await this.db.rpc('fixture_delivery_command', {
      job: this.job.id,
      lease: this.job.lease_token,
      command
    })
    if (error) throw error
    return data
  }
  async prepare(
    input: Readonly<DeliveryPackage>,
    idempotencyKey: string
  ): Promise<DeliveryIdentity> {
    if (idempotencyKey !== this.job.idempotency_key)
      throw new Error('Idempotency mismatch')
    const identity = identitySchema.parse(await this.command('prepare'))
    if (identity.packageId !== input.id)
      throw new Error('Provider package mismatch')
    return identity
  }
  async schedule(identity: DeliveryIdentity, scheduledAt: string) {
    const result = identitySchema.parse(await this.command('schedule'))
    if (
      result.id !== identity.id ||
      Date.parse(result.scheduledAt ?? '') !== Date.parse(scheduledAt)
    )
      throw new Error('Provider schedule mismatch')
    return result
  }
  async state(id: string) {
    const result = await this.reconcile(this.job.idempotency_key)
    if (result.outcome !== 'found' || result.identity.id !== id)
      throw new Error('Provider identity unavailable')
    return result.identity
  }
  async reschedule(
    id: string,
    scheduledAt: string,
    idempotencyKey: string
  ): Promise<DeliveryIdentity> {
    if (idempotencyKey !== this.job.idempotency_key)
      throw new Error('Idempotency mismatch')
    const result = identitySchema.parse(await this.command('reschedule'))
    if (
      result.id !== id ||
      Date.parse(result.scheduledAt ?? '') !== Date.parse(scheduledAt)
    )
      throw new Error('Provider reschedule mismatch')
    return result
  }
  async probe(stage: 'before' | 'after_schedule') {
    const r = await this.db.rpc('fixture_fault_probe', {
      job: this.job.id,
      lease: this.job.lease_token!,
      stage
    })
    if (r.error) throw r.error
    const failure = z
      .enum([
        'none',
        'transient',
        'rate_limit',
        'unknown_outcome',
        'auth',
        'validation'
      ])
      .parse(r.data)
    if (failure !== 'none') throw new ProviderFault(failure)
  }
  async cancel(id: string, idempotencyKey: string) {
    if (idempotencyKey !== this.job.idempotency_key)
      throw new Error('Idempotency mismatch')
    const result = identitySchema.parse(await this.command('cancel'))
    if (result.id !== id) throw new Error('Provider identity mismatch')
    return result
  }
  async reconcile(idempotencyKey: string): Promise<Reconciliation> {
    if (idempotencyKey !== this.job.idempotency_key)
      throw new Error('Idempotency mismatch')
    return reconcileSchema.parse(await this.command('reconcile'))
  }
  async results(id: string, window: '48h' | '7d'): Promise<CampaignResults> {
    throw new Error(
      `Results for ${id} (${window}) are unavailable until V2-009.`
    )
  }
}
