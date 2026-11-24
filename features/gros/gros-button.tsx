'use client'

import type { ComponentProps } from 'react'
import { ActionButton, type ActionResult } from '@/components/gros/action'
import { grosAction } from './actions'

/**
 * What a chat button says when it worked, in the owner's words. The
 * command's own success line is for the records; a refusal keeps its words
 * (they say what to fix).
 */
export function plainAnswer(form: FormData, result: ActionResult) {
  if (result.error || !result.message) return result
  const kind = form.get('kind')
  const message =
    kind === 'visibility'
      ? 'Saved.'
      : kind === 'ask'
        ? 'Sent.'
        : kind === 'decide'
          ? form.get('decision') === 'confirmed'
            ? 'Confirmed.'
            : 'Rejected.'
          : 'Saved.'
  return { message }
}

/** An Ask GROS button: `grosAction`, answered in plain words. */
export function GrosButton(
  props: Omit<ComponentProps<typeof ActionButton>, 'action'>
) {
  return (
    <ActionButton
      {...props}
      action={async (state, form) =>
        plainAnswer(form, await grosAction(state, form))
      }
    />
  )
}
