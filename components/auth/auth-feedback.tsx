import type { AuthActionState } from '@/features/auth/domain/types'

export function AuthFeedback({ state }: { state: AuthActionState }) {
  if (!state.message) return null
  return (
    <p
      className={`mt-4 text-sm ${state.status === 'error' ? 'text-[#ffb4aa]' : 'text-[#b8f1ce]'}`}
      role="status"
    >
      {state.message}
    </p>
  )
}
