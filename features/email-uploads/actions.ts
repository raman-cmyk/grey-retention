'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { ActionResult } from '@/components/gros/action'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { addUploadFile, deleteUploadFiles, uploadForm } from './intake'
import { uploadLimits, uploadRefusal, uploadsHref } from './limits'
import { uploadCopyOn } from './switch'

/**
 * DES-ENGINE-003: "Add your own email" (the owner or an admin of the
 * workspace; the database checks the role again under its lock). Thin:
 * the steps are `intake.ts`.
 */

const off = 'Adding your own emails is not turned on yet.'

async function session() {
  const context = await requireRequestContext('client')
  if (context.tenantRole !== 'owner' && context.tenantRole !== 'admin')
    return { error: uploadRefusal('not_allowed') } as const
  if (!uploadCopyOn(process.env)) return { error: off } as const
  const db = await createClient()
  const service = createServiceClient()
  if (!db || !service || process.env.AUTH_MODE === 'demo')
    return { error: 'Please sign in again, then add the email.' } as const
  return { context, db, service } as const
}

export async function addUpload(
  _: ActionResult,
  form: FormData
): Promise<ActionResult> {
  const s = await session()
  if ('error' in s) return { error: s.error }
  const parsed = uploadForm.safeParse({
    requestKey: form.get('requestKey'),
    name: form.get('name') ?? '',
    design: form.get('design')
  })
  const file = form.get('file')
  if (!(file instanceof File) || !file.size)
    return { error: 'Choose an email file (.html or .eml).' }
  if (!parsed.success)
    return {
      error: form.get('design')
        ? 'Reload the page and add the email again.'
        : 'Choose whose design this is.'
    }
  if (file.size > uploadLimits.fileBytes)
    return { error: uploadRefusal('too_large') }
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes.length !== file.size)
    return { error: 'The upload was not complete. Choose the file again.' }
  const done = await addUploadFile({
    db: s.db,
    service: s.service,
    tenantId: s.context.tenantId,
    form: parsed.data,
    file: { name: file.name, bytes }
  })
  if (!done.ok) return { error: done.error }
  revalidatePath(uploadsHref)
  revalidatePath('/inspiration')
  return {
    message:
      done.missing > 0
        ? `Added. ${done.missing === 1 ? '1 picture is' : `${done.missing} pictures are`} on a site GROS doesn’t load pictures from; see below.`
        : 'Added. GROS is reading its design.'
  }
}

export async function deleteUpload(
  _: ActionResult,
  form: FormData
): Promise<ActionResult> {
  const s = await session()
  if ('error' in s) return { error: s.error }
  const id = z.uuid().safeParse(form.get('upload'))
  if (!id.success) return { error: 'Reload the page and try again.' }
  const done = await deleteUploadFiles({
    db: s.db,
    service: s.service,
    tenantId: s.context.tenantId,
    uploadId: id.data
  })
  if (!done.ok) return { error: done.error }
  revalidatePath(uploadsHref)
  return { message: 'Deleted.' }
}
