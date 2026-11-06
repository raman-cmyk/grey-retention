'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { Route } from 'next'
import type { FormResult } from '@/components/ui/action-form'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { savePastedReference, type PastedReferenceInput } from './pasted-save'

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
  ) as PastedReferenceInput
  const saved = await savePastedReference(context, raw)
  if (saved.error !== undefined) return { error: saved.error }
  for (const path of ['/get-started', '/first-draft', '/import-reference'])
    revalidatePath(path)
  // Next step of the simple flow: choose to rewrite it or copy it.
  redirect(`/create-email/${saved.id}` as Route)
}
