'use client'

import { Button } from '@/components/gros/button'
import { FocusShell } from '@/components/gros/steps'
import { SetupError } from '@/features/onboarding/setup-error'

/** Setup could not open: what happened, what to do, one button. */
export default function SetupErrorPage({ retry }: { retry: () => void }) {
  return (
    <FocusShell>
      <SetupError
        title="Setup did not open"
        reason="We could not read your setup just now. What you saved is safe."
        action={<Button label="Try again" onClick={retry} />}
      />
    </FocusShell>
  )
}
