import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'

/** Usage features known to the per-client package allowance. */
export type BudgetFeature =
  'copy' | 'design' | 'assets' | 'playbook' | 'calendar' | 'gros' | 'learning'

export type Reservation =
  | { ok: true; reservationId: string }
  | { ok: false; code: 'cap_reached' | 'ledger_unavailable' }

/**
 * Per-client spend cap (VISION section 10). A request reserves its upper-bound
 * cost before dispatch and settles the real cost afterwards. Reserving the
 * same operation id twice returns the same reservation, so retries are safe.
 */
export interface BudgetLedger {
  reserve(input: {
    tenantId: string
    operationId: string
    feature: BudgetFeature
    estimateMicro: number
  }): Promise<Reservation>
  settle(input: {
    tenantId: string
    reservationId: string
    actualMicro: number
  }): Promise<void>
}

/** Test and local double with the same cap semantics. */
export class InMemoryBudgetLedger implements BudgetLedger {
  readonly reservations = new Map<
    string,
    {
      tenantId: string
      operationId: string
      estimateMicro: number
      actualMicro: number | null
    }
  >()
  constructor(private readonly capMicro: number) {}

  spentMicro(tenantId: string) {
    let total = 0
    for (const r of this.reservations.values())
      if (r.tenantId === tenantId) total += r.actualMicro ?? r.estimateMicro
    return total
  }

  async reserve(input: Parameters<BudgetLedger['reserve']>[0]) {
    const id = `${input.tenantId}:${input.operationId}`
    if (this.reservations.has(id))
      return { ok: true as const, reservationId: id }
    if (this.spentMicro(input.tenantId) + input.estimateMicro > this.capMicro)
      return { ok: false as const, code: 'cap_reached' as const }
    this.reservations.set(id, {
      tenantId: input.tenantId,
      operationId: input.operationId,
      estimateMicro: input.estimateMicro,
      actualMicro: null
    })
    return { ok: true as const, reservationId: id }
  }

  async settle(input: Parameters<BudgetLedger['settle']>[0]) {
    const r = this.reservations.get(input.reservationId)
    if (r && r.tenantId === input.tenantId)
      r.actualMicro = Math.max(0, input.actualMicro)
  }
}

/**
 * Backed by the package allowance: public.reserve_fixture_usage and
 * public.reconcile_fixture_usage (service role only) wrap
 * private.reserve_budget / reconcile_budget, which enforce the cycle and
 * daily caps and alert owners at 80%. The names predate live providers; they
 * meter the client's real allowance.
 */
export class SupabaseBudgetLedger implements BudgetLedger {
  constructor(private readonly db: SupabaseClient<Database>) {}

  async reserve(input: Parameters<BudgetLedger['reserve']>[0]) {
    const { data, error } = await this.db.rpc('reserve_fixture_usage', {
      t: input.tenantId,
      operation: input.operationId,
      feature: input.feature,
      estimate: input.estimateMicro
    })
    if (error)
      return {
        ok: false as const,
        code:
          error.code === '23514'
            ? ('cap_reached' as const)
            : ('ledger_unavailable' as const)
      }
    return { ok: true as const, reservationId: data }
  }

  async settle(input: Parameters<BudgetLedger['settle']>[0]) {
    const { error } = await this.db.rpc('reconcile_fixture_usage', {
      t: input.tenantId,
      reservation: input.reservationId,
      actual: Math.max(0, Math.ceil(input.actualMicro))
    })
    if (error) throw new Error('AI usage could not be settled')
  }
}
