import 'server-only'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/supabase/database.types'

export type FileImport = Pick<
  Database['public']['Tables']['email_file_imports']['Row'],
  | 'id'
  | 'state'
  | 'file_name'
  | 'file_kind'
  | 'byte_size'
  | 'reference_import_id'
  | 'header_from'
  | 'header_date'
  | 'header_subject'
  | 'content_format'
  | 'attachment_count'
  | 'notes'
  | 'failure_code'
  | 'retries'
  | 'upload_expires_at'
  | 'created_at'
>

const columns =
  'id,state,file_name,file_kind,byte_size,reference_import_id,header_from,header_date,header_subject,content_format,attachment_count,notes,failure_code,retries,upload_expires_at,created_at'
const uuid = z.uuid()

async function client() {
  const db = await createClient()
  return !db || process.env.AUTH_MODE === 'demo' ? null : db
}

// Every read filters by the server-authorized tenant in addition to RLS.
export async function fileImports(tenantId: string, limit = 5) {
  const db = await client()
  if (!db) return { data: [] as FileImport[], error: null }
  const result = await db
    .from('email_file_imports')
    .select(columns)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .order('id')
    .limit(limit)
  return {
    data: (result.data ?? []) as FileImport[],
    error: result.error ? 'Your uploaded files could not load.' : null
  }
}

export async function fileImport(tenantId: string, id: string) {
  if (!uuid.safeParse(id).success) return { data: null, error: null }
  const db = await client()
  if (!db) return { data: null, error: null }
  const result = await db
    .from('email_file_imports')
    .select(columns)
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .maybeSingle()
  return {
    data: (result.data as FileImport | null) ?? null,
    error: result.error ? 'This file could not load. Try again.' : null
  }
}

/** The uploaded file behind an added email, if it came from a file. */
export async function fileForReference(tenantId: string, referenceId: string) {
  if (!uuid.safeParse(referenceId).success) return null
  const db = await client()
  if (!db) return null
  const result = await db
    .from('email_file_imports')
    .select(columns)
    .eq('tenant_id', tenantId)
    .eq('reference_import_id', referenceId)
    .maybeSingle()
  return (result.data as FileImport | null) ?? null
}

/**
 * Exact original bytes for an authenticated download. The object read uses the
 * signed-in session, so Storage RLS (owner/admin of this workspace) applies too;
 * the bytes must still match the frozen hash.
 */
export async function originalFile(tenantId: string, importId: string) {
  if (!uuid.safeParse(importId).success) return null
  const db = await client()
  if (!db) return null
  const row = await db
    .from('email_file_imports')
    .select(
      'storage_path,sha256,byte_size,file_name,file_kind,media_type,state'
    )
    .eq('tenant_id', tenantId)
    .eq('id', importId)
    .maybeSingle()
  if (row.error || !row.data || row.data.state === 'uploading') return null
  const download = await db.storage
    .from('email-imports')
    .download(row.data.storage_path)
  if (download.error || !download.data) return null
  const bytes = new Uint8Array(await download.data.arrayBuffer())
  if (
    bytes.length !== row.data.byte_size ||
    createHash('sha256').update(bytes).digest('hex') !== row.data.sha256
  )
    return null
  return {
    bytes,
    fileName: row.data.file_name,
    mediaType: row.data.media_type
  }
}

/** Resolves an email result to the uploaded file it came from, if any. */
export async function fileForResult(tenantId: string, resultId: string) {
  if (!uuid.safeParse(resultId).success) return null
  const db = await client()
  if (!db) return null
  const result = await db
    .from('email_results')
    .select('source_id')
    .eq('tenant_id', tenantId)
    .eq('id', resultId)
    .maybeSingle()
  if (!result.data) return null
  const source = await db
    .from('email_sources')
    .select('reference_import_id')
    .eq('tenant_id', tenantId)
    .eq('id', result.data.source_id)
    .maybeSingle()
  if (!source.data) return null
  const reference = await db
    .from('reference_imports')
    .select('file_import_id')
    .eq('tenant_id', tenantId)
    .eq('id', source.data.reference_import_id)
    .maybeSingle()
  return reference.data?.file_import_id ?? null
}
