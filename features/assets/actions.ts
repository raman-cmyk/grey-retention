'use server'
import { createHash } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import type { FormResult } from '@/components/ui/action-form'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { createClient } from '@/lib/supabase/server'
import {
  inspectAsset,
  unpackAssetZip,
  intakeLimits,
  type IntakeFile,
  type IntakeFailure
} from './archive'
import { persistPrivateAsset } from './intake'
export async function importAssets(
  _state: FormResult,
  form: FormData
): Promise<FormResult> {
  const context = await requireRequestContext('client'),
    db = await createClient()
  if (!db || process.env.AUTH_MODE === 'demo')
    return { error: 'Supabase authentication required.' }
  const picked = form
    .getAll('files')
    .filter((f): f is File => f instanceof File && f.size > 0)
  if (
    !picked.length ||
    picked.length > intakeLimits.files ||
    picked.reduce((n, f) => n + f.size, 0) > intakeLimits.compressed
  )
    return {
      error:
        'Choose up to 100 raster files or one ZIP; total upload maximum 10 MiB.'
    }
  let files: IntakeFile[] = [],
    failures: IntakeFailure[] = [],
    source: 'upload' | 'zip' = 'upload'
  try {
    if (picked.some((f) => /\.zip$/i.test(f.name))) {
      if (picked.length !== 1) throw new Error('Upload one ZIP at a time.')
      source = 'zip'
      const batch = unpackAssetZip(
        new Uint8Array(await picked[0]!.arrayBuffer())
      )
      files = batch.files
      failures = batch.failures
    } else
      for (const file of picked) {
        try {
          files.push(
            inspectAsset(file.name, new Uint8Array(await file.arrayBuffer()))
          )
        } catch {
          failures.push({
            name: file.name.slice(0, 250),
            error: 'invalid_file'
          })
        }
      }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Invalid archive.'
    }
  }
  const manifest = files.map((f) => [
    f.name,
    createHash('sha256').update(f.bytes).digest('hex')
  ])
  const key = createHash('sha256')
    .update(
      JSON.stringify({
        actor: context.userId,
        source,
        manifest,
        failures: failures.map((f) => f.name)
      })
    )
    .digest('hex')
  const started = await db.rpc('begin_asset_import', {
    t: context.tenantId,
    key,
    source
  })
  if (started.error || !started.data)
    return { error: 'Import could not start. Check workspace access.' }
  const importId = started.data
  let stored = 0,
    duplicates = 0,
    failed = failures.length
  for (const f of files) {
    try {
      const asset = await persistPrivateAsset(
        db,
        context.tenantId,
        context.userId,
        f,
        source
      )
      const recorded = await db.rpc('record_import_item', {
        t: context.tenantId,
        import_id: importId,
        filename: f.name,
        asset: asset.id,
        status: asset.duplicate ? 'duplicate' : 'stored'
      })
      if (recorded.error) throw new Error('metadata_unavailable')
      if (asset.duplicate) duplicates++
      else stored++
    } catch (error) {
      failed++
      const code =
        error instanceof Error &&
        ['storage_unavailable', 'metadata_unavailable'].includes(error.message)
          ? error.message
          : 'invalid_file'
      await db.rpc('record_import_item', {
        t: context.tenantId,
        import_id: importId,
        filename: f.name,
        asset: undefined,
        status: 'failed',
        error_code: code
      })
    }
  }
  for (const f of failures)
    await db.rpc('record_import_item', {
      t: context.tenantId,
      import_id: importId,
      filename: f.name.slice(0, 250),
      asset: undefined,
      status: 'failed',
      error_code: 'invalid_file'
    })
  const done = await db.rpc('complete_asset_import', {
    t: context.tenantId,
    import_id: importId
  })
  revalidatePath('/assets')
  revalidatePath('/brand')
  if (done.error)
    return { error: 'Files were processed, but import completion needs retry.' }
  return {
    message: `Import persisted: ${stored} stored, ${duplicates} duplicates, ${failed} failed. Queue fixture classification; tags require owner review.`
  }
}
