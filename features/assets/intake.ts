import 'server-only'
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { createServiceClient } from '@/lib/supabase/service'
import type { IntakeFile } from './archive'
export async function persistPrivateAsset(
  db: SupabaseClient<Database>,
  tenantId: string,
  actorId: string,
  file: IntakeFile,
  source: 'upload' | 'zip' | 'drive_fixture'
) {
  const hash = createHash('sha256').update(file.bytes).digest('hex')
  const existing = await db
    .from('assets')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('sha256', hash)
    .maybeSingle()
  if (existing.error) throw new Error('metadata_unavailable')
  if (existing.data) return { id: existing.data.id, duplicate: true }
  const service = createServiceClient()
  if (!service) throw new Error('storage_unavailable')
  const path = `${tenantId}/${hash}.${file.extension}`
  const result = await service.storage
    .from('brand-assets')
    .upload(path, file.bytes, { contentType: file.mediaType, upsert: false })
  // A previous attempt may have uploaded before metadata commit. Content-addressed paths allow safe resume.
  if (result.error && result.error.message !== 'The resource already exists')
    throw new Error('storage_unavailable')
  const recorded = await service.rpc('record_asset_upload', {
    t: tenantId,
    actor: actorId,
    path,
    filename: file.name,
    hash,
    media_type: file.mediaType,
    byte_size: file.bytes.length,
    source
  })
  if (recorded.error || !recorded.data) throw new Error('metadata_unavailable')
  return { id: recorded.data, duplicate: Boolean(result.error) }
}
