'use server'

import { createHash } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { Route } from 'next'
import { z } from 'zod'
import type { FormResult } from '@/components/ui/action-form'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { fileImportSetup } from './config'
import {
  failureMessage,
  fileKind,
  fileLimits,
  mediaTypes,
  safeFileName
} from './limits'
import { parseEmailFile } from './parse'
import { importBucket, runEmailFileImport } from './worker'

const notSetUp =
  'File upload is not set up for this workspace yet. You can paste the email instead.'
const keepFile = 'Your file is still selected; try again.'

function admissionMessage(
  code: string | undefined,
  message: string | undefined
) {
  if (code === 'PT409')
    return 'This form was already used for a different file. Choose the file again to start over.'
  if (code === '42501')
    return 'Ask your workspace owner to add reference emails.'
  if (message === 'File upload limit reached; try again later')
    return 'You have uploaded many files in the last hour. Try again later, or paste the email instead.'
  if (message === 'File storage limit reached')
    return 'This workspace has used its storage for uploaded files. Paste the email instead.'
  if (message === 'Imported reference limit reached')
    return 'This workspace has reached its limit for added emails.'
  return `We could not start this upload. ${keepFile}`
}

async function owner() {
  const context = await requireRequestContext('client')
  if (context.tenantRole !== 'owner')
    return {
      error: 'Ask your workspace owner to add reference emails.'
    } as const
  const db = await createClient()
  if (!db || process.env.AUTH_MODE === 'demo')
    return { error: `Please sign in again. ${keepFile}` } as const
  return { context, db } as const
}

/** Processes the queued file now; the progress page resumes it if this stops. */
async function processFile(tenantId: string, importId: string) {
  const worker = createServiceClient()
  if (!worker) return
  await runEmailFileImport(worker, tenantId, importId).catch(() => 'failed')
}

async function destination(
  db: NonNullable<Awaited<ReturnType<typeof createClient>>>,
  tenantId: string,
  importId: string
) {
  const row = await db
    .from('email_file_imports')
    .select('state,reference_import_id')
    .eq('tenant_id', tenantId)
    .eq('id', importId)
    .maybeSingle()
  return row.data?.state === 'succeeded' && row.data.reference_import_id
    ? (`/create-email/${row.data.reference_import_id}` as Route)
    : (`/import-reference/files/${importId}` as Route)
}

const uploadSchema = z.object({
  requestKey: z.uuid(),
  title: z.string().trim().max(fileLimits.title)
})

/**
 * Upload one email file. Order: validate bytes and parse (nothing stored yet) →
 * durable admission (receipt + capacity reservation, under the tenant lock) →
 * immutable private write → finalize (job enqueued once) → process. A retry
 * with the same request key resumes from wherever the previous attempt stopped.
 */
export async function uploadEmailFile(
  _: FormResult,
  form: FormData
): Promise<FormResult> {
  const session = await owner()
  if ('error' in session) return { error: session.error }
  const { context, db } = session
  if (!fileImportSetup(context.tenantId).ready) return { error: notSetUp }
  const parsedForm = uploadSchema.safeParse({
    requestKey: form.get('requestKey'),
    title: form.get('title') ?? ''
  })
  const file = form.get('file')
  if (!parsedForm.success || !(file instanceof File))
    return { error: 'Choose an email file to upload.' }
  const fileName = safeFileName(file.name)
  const kind = fileKind(fileName)
  if (!fileName || !kind) return { error: failureMessage('unsupported_type') }
  if (file.size === 0)
    return { error: 'This file is empty. Choose another file.' }
  if (file.size > fileLimits.rawBytes)
    return { error: failureMessage('too_large') }
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes.length !== file.size)
    return { error: `The upload was incomplete. ${keepFile}` }
  // Bounded validation before any storage is used; the worker re-reads the
  // stored bytes and is the only path that saves parsed output.
  const parsed = await parseEmailFile(bytes, kind, {
    fileName,
    title: parsedForm.data.title
  })
  if (!parsed.ok) return { error: failureMessage(parsed.code) }
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const admitted = await db.rpc('admit_email_file_upload', {
    t: context.tenantId,
    request_key: parsedForm.data.requestKey,
    input: {
      sha256,
      byteSize: bytes.length,
      kind,
      fileName,
      title: parsedForm.data.title
    }
  })
  const admission = admitted.data?.[0]
  if (admitted.error || !admission)
    return {
      error: admissionMessage(admitted.error?.code, admitted.error?.message)
    }
  if (admission.needs_upload) {
    // Grants can change between admission and write; recheck right before it.
    if (!fileImportSetup(context.tenantId).ready) return { error: notSetUp }
    const service = createServiceClient()
    if (!service) return { error: notSetUp }
    const stored = await service.storage
      .from(importBucket)
      .upload(admission.storage_path, bytes, {
        contentType: mediaTypes[kind],
        upsert: false
      })
    // Content-addressed and write-once: an existing object is the same admitted
    // path (another request or a lost response); the worker verifies its hash.
    if (stored.error && !/exists/i.test(stored.error.message))
      return { error: `The upload did not finish. ${keepFile}` }
  }
  if (admission.state === 'uploading') {
    const finalized = await db.rpc('finalize_email_file_upload', {
      t: context.tenantId,
      import: admission.import_id
    })
    if (finalized.error)
      return { error: `The upload did not finish. ${keepFile}` }
  }
  await processFile(context.tenantId, admission.import_id)
  for (const path of ['/import-reference', '/get-started', '/first-draft'])
    revalidatePath(path)
  redirect(await destination(db, context.tenantId, admission.import_id))
}

export async function retryEmailFile(
  _: FormResult,
  form: FormData
): Promise<FormResult> {
  const session = await owner()
  if ('error' in session) return { error: session.error }
  const { context, db } = session
  const id = z.uuid().safeParse(form.get('importId'))
  if (!id.success) return { error: 'Reload the page and try again.' }
  if (!fileImportSetup(context.tenantId).ready) return { error: notSetUp }
  const retried = await db.rpc('retry_email_file_import', {
    t: context.tenantId,
    import: id.data
  })
  if (retried.error)
    return {
      error:
        retried.error.message === 'Retry limit reached'
          ? 'This file has been retried several times. Upload it again or paste the email instead.'
          : retried.error.code === '42501'
            ? 'Only an active owner who uploaded this file can retry it. Upload it again yourself.'
            : 'This file cannot be retried. Choose another file or paste the email instead.'
    }
  await processFile(context.tenantId, id.data)
  revalidatePath(`/import-reference/files/${id.data}`)
  redirect(await destination(db, context.tenantId, id.data))
}

/** Polled while a file is queued: resumes due work, then reports persisted state. */
export async function checkFileImport(importId: string) {
  const context = await requireRequestContext('client')
  if (!z.uuid().safeParse(importId).success)
    return { state: 'unknown' as const }
  const db = await createClient()
  if (!db) return { state: 'unknown' as const }
  const read = () =>
    db
      .from('email_file_imports')
      .select('state')
      .eq('tenant_id', context.tenantId)
      .eq('id', importId)
      .maybeSingle()
  const before = await read()
  if (!before.data) return { state: 'unknown' as const }
  if (
    context.tenantRole === 'owner' &&
    ['queued', 'processing'].includes(before.data.state) &&
    fileImportSetup(context.tenantId).ready
  )
    await processFile(context.tenantId, importId)
  const after = await read()
  return { state: after.data?.state ?? before.data.state }
}
