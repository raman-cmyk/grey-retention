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
 * cost before dispatch and settles the real cost afterwards. Operation ids
 * are unique per call (see runAi), so a reservation is settled once.
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
      return { ok: false as const, code: 'ledger_unavailable' as const }
    if (
      !Number.isSafeInteger(input.estimateMicro) ||
      input.estimateMicro < 1 ||
      this.spentMicro(input.tenantId) + input.estimateMicro > this.capMicro
    )
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
    if (!r || r.tenantId !== input.tenantId || r.actualMicro !== null)
      throw new Error('Usage reservation already closed')
    if (input.actualMicro > r.estimateMicro)
      throw new Error('Actual usage exceeds reservation')
    r.actualMicro = Math.max(0, input.actualMicro)
  }
}

/** Live usage commands added by GEM-002 (service role only). */
type LiveUsageRpc = {
  (
    fn: 'reserve_ai_usage',
    args: { t: string; operation: string; feature: string; estimate: number }
  ): PromiseLike<{
    data: string | null
    error: { code?: string; message?: string } | null
  }>
  (
    fn: 'settle_ai_usage',
    args: { t: string; reservation: string; actual: number }
  ): PromiseLike<{
    data: null
    error: { code?: string; message?: string } | null
  }>
}

/**
 * Backed by the package allowance through public.reserve_ai_usage and
 * public.settle_ai_usage (migration 20260914090041, service role only). They
 * wrap private.reserve_budget / reconcile_budget, which enforce the cycle and
 * daily caps and alert owners at 80% with live wording. An `ai:` operation can
 * be reserved only once and is never auto-released, and owners can't reach
 * it through the fixture commands. Pass a service-role client.
 */
export class SupabaseBudgetLedger implements BudgetLedger {
  // The generated types gain these RPCs at the next `pnpm supabase:types`;
  // until then the signatures above describe them exactly.
  private readonly rpc: LiveUsageRpc
  constructor(db: SupabaseClient<Database>) {
    this.rpc = db.rpc.bind(db) as unknown as LiveUsageRpc
  }

  async reserve(input: Parameters<BudgetLedger['reserve']>[0]) {
    const { data, error } = await this.rpc('reserve_ai_usage', {
      t: input.tenantId,
      operation: input.operationId,
      feature: input.feature,
      estimate: input.estimateMicro
    })
    if (error || !data)
      return {
        ok: false as const,
        // Only the allowance check means "cap reached"; other check
        // violations (no active package, bad request) are setup problems.
        code:
          error?.code === '23514' &&
          /allowance reached|budget exhausted/i.test(error.message ?? '')
            ? ('cap_reached' as const)
            : ('ledger_unavailable' as const)
      }
    return { ok: true as const, reservationId: data }
  }

  async settle(input: Parameters<BudgetLedger['settle']>[0]) {
    const { error } = await this.rpc('settle_ai_usage', {
      t: input.tenantId,
      reservation: input.reservationId,
      actual: Math.max(0, Math.ceil(input.actualMicro))
    })
    if (error) throw new Error('AI usage could not be settled')
  }
}
