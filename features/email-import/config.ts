import 'server-only'
import { enabledWorkspaces } from '@/features/email-generation/config'

export type FileImportSetup =
  | { ready: true }
  | {
      ready: false
      reason: 'missing_service_credential' | 'workspace_not_enabled'
    }

function loopbackStorage(raw: string | undefined) {
  try {
    const url = new URL(raw ?? '')
    return ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  } catch {
    return false
  }
}

/**
 * Raw files are stored with the server worker credential, so uploads need it.
 * Hosted storage is server-funded and workspaces are self-created, so outside a
 * local loopback stack uploads are default-deny: only exact workspace UUIDs in
 * the server-only EMAIL_IMPORT_TENANT_IDS (at most 50, no wildcard) may store
 * files. This is a pilot gate, not a commercial entitlement. Paste never needs it.
 */
export function fileImportSetup(
  tenantId: string,
  env: NodeJS.ProcessEnv = process.env
): FileImportSetup {
  if (!env.SUPABASE_SERVICE_ROLE_KEY?.trim() || !env.NEXT_PUBLIC_SUPABASE_URL)
    return { ready: false, reason: 'missing_service_credential' }
  const local =
    env.NODE_ENV !== 'production' &&
    loopbackStorage(env.NEXT_PUBLIC_SUPABASE_URL)
  if (
    !local &&
    !enabledWorkspaces(env.EMAIL_IMPORT_TENANT_IDS).has(tenantId.toLowerCase())
  )
    return { ready: false, reason: 'workspace_not_enabled' }
  return { ready: true }
}
