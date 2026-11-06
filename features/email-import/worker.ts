import 'server-only'
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { logger } from '@/lib/logger'
import { fileImportSetup } from './config'
import type { FileKind, ImportFailure } from './limits'
import { parseEmailFile } from './parse'

type Db = SupabaseClient<Database>
export type ImportOutcome =
  'idle' | 'succeeded' | 'retrying' | 'failed' | 'paused'

export const importBucket = 'email-imports'

// Codes the database accepts for a failed job; parser-only codes map onto them.
const storedFailure: Record<ImportFailure, string> = {
  unsupported_type: 'unsupported_type',
  not_an_email: 'not_an_email',
  mbox_unsupported: 'mbox_unsupported',
  rename_to_eml: 'unsupported_type',
  malformed: 'malformed',
  too_large: 'too_large',
  content_too_large: 'content_too_large',
  unsupported_charset: 'unsupported_charset',
  ambiguous_encoding: 'ambiguous_encoding',
  no_content: 'no_content',
  limits_exceeded: 'limits_exceeded',
  hash_mismatch: 'hash_mismatch',
  source_missing: 'source_missing',
  setup_required: 'setup_required',
  storage_unavailable: 'storage_unavailable',
  internal: 'internal',
  actor_inactive: 'internal',
  attempts_exhausted: 'internal',
  limit_reached: 'internal'
}

type Claim = {
  job_id: string
  lease_token: string
  storage_path: string
  sha256: string
  byte_size: number
  file_kind: FileKind
  file_name: string
  title: string
}

/**
 * Reads one uploaded file if it is due, from the frozen object in private
 * Storage. Safe to call repeatedly and concurrently: the database grants one
 * lease, retries only transient failures (bounded), and accepts parsed output
 * only for the exact frozen hash, still-stored object and still-active uploader.
 * Logs carry codes only, never file names, headers or content.
 */
export async function runEmailFileImport(
  worker: Db,
  tenantId: string,
  importId: string,
  options: { env?: NodeJS.ProcessEnv } = {}
): Promise<ImportOutcome> {
  const claimed = await worker.rpc('claim_email_file_import', {
    t: tenantId,
    import: importId
  })
  if (claimed.error) {
    // A paused workspace keeps its queued file until it is active again.
    if (claimed.error.message === 'Workspace unavailable') return 'paused'
    throw claimed.error
  }
  const claim = (claimed.data as Claim[] | null)?.[0]
  if (!claim) return 'idle'
  const lease = { job: claim.job_id, lease: claim.lease_token }
  const fail = async (code: ImportFailure): Promise<ImportOutcome> => {
    const result = await worker.rpc('fail_email_file_import', {
      ...lease,
      failure: { code: storedFailure[code] }
    })
    if (result.error) throw result.error
    return result.data === 'retrying' ? 'retrying' : 'failed'
  }
  try {
    // Rechecked on every attempt, so a removed pilot grant stops processing visibly.
    if (!fileImportSetup(tenantId, options.env).ready)
      return await fail('setup_required')
    const download = await worker.storage
      .from(importBucket)
      .download(claim.storage_path)
    if (download.error || !download.data) {
      const status = (download.error as { status?: number } | null)?.status
      return await fail(
        status === 400 || status === 404
          ? 'source_missing'
          : 'storage_unavailable'
      )
    }
    const bytes = new Uint8Array(await download.data.arrayBuffer())
    if (
      bytes.length !== claim.byte_size ||
      createHash('sha256').update(bytes).digest('hex') !== claim.sha256
    )
      return await fail('hash_mismatch')
    const parsed = await parseEmailFile(bytes, claim.file_kind, {
      fileName: claim.file_name,
      title: claim.title
    })
    if (!parsed.ok) return await fail(parsed.code)
    const finished = await worker.rpc('finish_email_file_import', {
      ...lease,
      output: { sha256: claim.sha256, ...parsed.value }
    })
    if (finished.error) {
      if (finished.error.message === 'Stored file unavailable')
        return await fail('source_missing')
      throw finished.error
    }
    return finished.data ? 'succeeded' : 'failed'
  } catch (error) {
    logger.error('email file import failed', {
      importId,
      code: String((error as { code?: unknown })?.code ?? 'internal').slice(
        0,
        16
      )
    })
    try {
      return await fail('internal')
    } catch {
      // Lost lease: the next claim recovers it after expiry.
      return 'failed'
    }
  }
}
