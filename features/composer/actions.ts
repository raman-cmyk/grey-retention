'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { Route } from 'next'
import type { FormResult } from '@/components/ui/action-form'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { pastedLimits } from '@/features/references/pasted'
import {
  savePastedReference,
  type SaveFailure
} from '@/features/references/pasted-save'
import { isLinkOnly, outcomeFor } from './compose'
import { subjectFromPaste } from './subject'

// The composer has no subject or web-address field, so it words some save
// failures differently from the paste form.
const composerMessages: Partial<Record<SaveFailure, string>> = {
  invalid: 'Paste the email text, then try again.',
  conflict:
    'This box was already used to save a different email. Copy your text, reload the page and paste it again.',
  rejected:
    'This email could not be saved. A workspace can keep up to 500 added emails; if you have reached that, contact support.'
}

/**
 * Composer submit: saves the pasted email like the paste form does, then opens
 * the existing "What should we make?" page with the chosen outcome marked.
 * It never starts a rewrite or a copy on its own.
 */
export async function composeEmail(
  _: FormResult,
  form: FormData
): Promise<FormResult> {
  const context = await requireRequestContext('client')
  if (context.tenantRole !== 'owner')
    return { error: 'Ask your workspace owner to add reference emails.' }
  const read = (key: string) => {
    const value = form.get(key)
    return typeof value === 'string' ? value : ''
  }
  const body = read('body')
  // Bound the input before any parsing: server actions accept large bodies.
  if (body.length > pastedLimits.body)
    return {
      error: `This email is too long. Keep it under ${pastedLimits.body.toLocaleString('en')} characters, or upload the file instead.`
    }
  const outcome = outcomeFor(read('mode'))
  if (!outcome)
    return { error: 'Choose Exact or Rebrand. Adapt is not available yet.' }
  if (!body.trim()) return { error: 'Paste an email first.' }
  if (isLinkOnly(body))
    return {
      error:
        'Reading an email from a link is not available yet. Open the email, copy its text or HTML, and paste it here.'
    }
  const saved = await savePastedReference(context, {
    requestKey: read('requestKey'),
    subject: subjectFromPaste(body),
    body,
    sourceDescription: 'Pasted in the composer',
    sourceUrl: ''
  })
  if (saved.error !== undefined)
    return { error: composerMessages[saved.reason] ?? saved.error }
  for (const path of ['/get-started', '/first-draft', '/import-reference'])
    revalidatePath(path)
  redirect(`/create-email/${saved.id}?mode=${outcome}` as Route)
}
