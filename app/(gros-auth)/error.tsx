'use client'

import { Button } from '@/components/gros/button'
import { FocusShell } from '@/components/gros/steps'
import { SetupError } from '@/features/onboarding/setup-error'

/** A sign-in or account screen could not open: what happened, one button. */
export default function AuthError({ retry }: { retry: () => void }) {
  return (
    <FocusShell>
      <SetupError
        title="Page did not open"
        reason="We could not open this page just now. Try again in a minute."
        action={<Button label="Try again" onClick={retry} />}
      />
    </FocusShell>
  )
}
