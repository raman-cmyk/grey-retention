'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { Route } from 'next'
import type { FormResult } from '@/components/ui/action-form'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { createClient } from '@/lib/supabase/server'
import {
  normalizeSourceUrl,
  pastedLimits,
  pastedReferenceSchema,
  readablePastedText
} from './pasted'

const fields = [
  'requestKey',
  'subject',
  'body',
  'sourceDescription',
  'sourceUrl'
] as const

export async function importPastedReference(
  _: FormResult,
  form: FormData
): Promise<FormResult> {
  const context = await requireRequestContext('client')
  if (context.tenantRole !== 'owner')
    return { error: 'Ask your workspace owner to add reference emails.' }
  const raw = Object.fromEntries(
    fields.map((key) => {
      const value = form.get(key)
      return [key, typeof value === 'string' ? value : '']
    })
  )
  if (raw.body.length > pastedLimits.body)
    return {
      error: `This email is too long to paste. Keep it under ${pastedLimits.body.toLocaleString('en')} characters.`
    }
  const parsed = pastedReferenceSchema.safeParse(raw)
  if (!parsed.success)
    return {
      error:
        'Add a subject line (up to 200 characters) and the email text, then try again.'
    }
  const x = parsed.data
  const sourceUrl = normalizeSourceUrl(x.sourceUrl)
  if (sourceUrl === null)
    return {
      error:
        'Use a full web address starting with http:// or https://, or leave it blank.'
    }
  // The original is saved exactly as received; only the preview normalizes.
  const readable = readablePastedText(x.body)
  if (!readable)
    return {
      error:
        'We could not find readable text in this email. Paste the text people see, not only code or images.'
    }
  const db = await createClient()
  if (!db || process.env.AUTH_MODE === 'demo')
    return {
      error: 'Please sign in again to save this email. Your text is still here.'
    }
  const result = await db.rpc('import_pasted_reference', {
    t: context.tenantId,
    request_key: x.requestKey,
    input: {
      subject: x.subject,
      body: x.body,
      readable_text: readable,
      source_description: x.sourceDescription,
      source_url: sourceUrl
    }
  })
  if (result.error || !result.data)
    return {
      error:
        result.error?.code === 'PT409'
          ? 'This form was already used to save a different email. Reload the page to paste another one.'
          : result.error?.code === '42501'
            ? 'Ask your workspace owner to add reference emails.'
            : result.error?.code === '23514'
              ? 'Check the subject, email text and web address, then try again.'
              : 'We could not save this email. Your text is still here; try again.'
    }
  for (const path of ['/get-started', '/first-draft', '/import-reference'])
    revalidatePath(path)
  // Next step of the simple flow: choose to rewrite it or copy it.
  redirect(`/create-email/${result.data}` as Route)
}
