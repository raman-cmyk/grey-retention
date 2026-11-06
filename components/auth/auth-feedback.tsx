import type { AuthActionState } from '@/features/auth/domain/types'

export function AuthFeedback({ state }: { state: AuthActionState }) {
  if (!state.message) return null
  return (
    <p
      className={`mt-4 text-sm ${state.status === 'error' ? 'text-[var(--danger-ink)]' : 'text-success'}`}
      role="status"
    >
      {state.message}
    </p>
  )
}
