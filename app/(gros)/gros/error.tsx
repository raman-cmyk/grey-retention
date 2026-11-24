'use client'

import { Button } from '@/components/gros/button'
import { AppPage } from '@/components/gros/nav'
import { ErrorState } from '@/components/gros/states'

/** Ask GROS could not open: what happened, what to do, one button. */
export default function AskError({ retry }: { retry: () => void }) {
  return (
    <AppPage current="ask" title="Ask GROS">
      <ErrorState
        title="Chats did not open"
        reason="We could not read your chats just now. They are safe. Try again in a minute."
        action={<Button label="Try again" onClick={retry} />}
      />
    </AppPage>
  )
}
