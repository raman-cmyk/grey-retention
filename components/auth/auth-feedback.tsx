import { cn } from '@/lib/utils'
import type { AuthActionState } from '@/features/auth/domain/types'

/**
 * The answer of a sign-in or account form, under its button: one caption,
 * signal ink when it went wrong (the words say what to do), ink otherwise.
 */
export function AuthFeedback({ state }: { state: AuthActionState }) {
  if (!state.message) return null
  return (
    <p
      className={cn(
        'type-caption',
        state.status === 'error'
          ? 'text-[var(--signal-ink)]'
          : 'text-[var(--ink)]'
      )}
      role="status"
    >
      {state.message}
    </p>
  )
}

/** The one title of a focused screen (BRAND.md: one to four words). */
export function AuthTitle({ text }: { text: string }) {
  return <h1 className="type-title">{text}</h1>
}

/**
 * Where a new person is on the way in, for the lime panel: the account,
 * then the workspace (the store's own five steps follow on /setup).
 */
export const accountSteps = [{ name: 'Account' }, { name: 'Workspace' }]
