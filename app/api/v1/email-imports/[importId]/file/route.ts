import { z } from 'zod'
import { resolveRequestContext } from '@/features/auth/application/request-context'
import { originalFile } from '@/features/email-import/data'
import {
  jsonError,
  originalFileResponse
} from '@/features/email-import/download'

// Exact uploaded bytes, as an attachment only. Tenant-filtered server read plus
// Storage RLS (workspace owner/admin); anything else is an indistinguishable 404.
export async function GET(
  _: Request,
  ctx: { params: Promise<{ importId: string }> }
) {
  const { importId } = await ctx.params
  const context = await resolveRequestContext('client')
  if (!context || context.kind !== 'client')
    return jsonError(401, 'unauthorized', 'Sign in to download.')
  if (!z.uuid().safeParse(importId).success)
    return jsonError(400, 'invalid_request', 'Unknown download.')
  const file = await originalFile(context.tenantId, importId)
  if (!file) return jsonError(404, 'not_found', 'Not available.')
  return originalFileResponse(file)
}
