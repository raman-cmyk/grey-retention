import 'server-only'
import type { ClientRequestContext } from '@/features/auth/domain/types'
import { createClient } from '@/lib/supabase/server'
import type { UploadDesign } from './limits'
import { uploadCopyOn } from './switch'

/**
 * DES-ENGINE-003: the workspace's own uploaded emails, as "Add your own
 * email" lists them, read with the member's own session (row level
 * security: members of this workspace only).
 */

export type UploadRow = {
  id: string
  name: string
  design: UploadDesign
  state: 'saving' | 'measuring' | 'ready' | 'failed'
  failure: string | null
  pictures: number
  missing: { host: string; count: number; why: string }[]
  at: string
}

export type UploadsView =
  | { ok: false; on: boolean }
  | {
      ok: true
      on: boolean
      /** The owner or an admin: may add and delete. */
      manager: boolean
      /** The owner: may create emails. */
      owner: boolean
      uploads: UploadRow[]
    }

const missingOf = (value: unknown): UploadRow['missing'] =>
  Array.isArray(value)
    ? value.flatMap((m) =>
        m &&
        typeof m === 'object' &&
        typeof (m as { host?: unknown }).host === 'string' &&
        typeof (m as { why?: unknown }).why === 'string'
          ? [
              {
                host: String((m as { host: string }).host).slice(0, 120),
                count: Math.max(
                  1,
                  Number((m as { count?: unknown }).count) || 1
                ),
                why: String((m as { why: string }).why).slice(0, 200)
              }
            ]
          : []
      )
    : []

export async function readUploads(
  context: Pick<ClientRequestContext, 'tenantId' | 'tenantRole'>,
  env: Readonly<Record<string, string | undefined>> = process.env
): Promise<UploadsView> {
  const on = uploadCopyOn(env)
  const db = await createClient()
  if (!db) return { ok: false, on }
  const rows = await db
    .from('email_uploads')
    .select('id,name,design,state,failure,pictures,missing,created_at')
    .eq('tenant_id', context.tenantId)
    .order('created_at', { ascending: false })
    .limit(100)
  if (rows.error) return { ok: false, on }
  return {
    ok: true,
    on,
    manager: context.tenantRole === 'owner' || context.tenantRole === 'admin',
    owner: context.tenantRole === 'owner',
    uploads: rows.data.map((r) => ({
      id: r.id,
      name: r.name,
      design: r.design === 'other' ? 'other' : 'own',
      state: r.state as UploadRow['state'],
      failure: r.failure,
      pictures: Array.isArray(r.pictures) ? r.pictures.length : 0,
      missing: missingOf(r.missing),
      at: r.created_at
    }))
  }
}
