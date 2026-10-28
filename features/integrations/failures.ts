import type { FailureClass } from '@/features/workflow/domain/contracts'
export class ProviderFault extends Error {
  constructor(public readonly failure: FailureClass) {
    super(`Fixture provider ${failure}`)
  }
}
export function classifyFailure(error: unknown): FailureClass {
  if (error instanceof ProviderFault) return error.failure
  const e = error as { code?: string; status?: number }
  if (e?.code === '40P01' || e?.code === '08006' || e?.status === 503)
    return 'transient'
  if (e?.status === 429) return 'rate_limit'
  if (e?.status === 401 || e?.status === 403) return 'auth'
  return 'validation'
}
