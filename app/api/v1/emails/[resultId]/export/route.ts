import { z } from 'zod'
import { resolveRequestContext } from '@/features/auth/application/request-context'
import { emailExport } from '@/features/email-generation/data'
import { exportFilename } from '@/features/email-generation/export'
import { fileForResult, originalFile } from '@/features/email-import/data'
import { originalFileResponse } from '@/features/email-import/download'

// Tenant-scoped download of exact stored email text. Always an attachment that
// browsers must not sniff, cache or run as an application page.
const attachmentHeaders = {
  'cache-control': 'private, no-store',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "sandbox; default-src 'none'",
  'cross-origin-resource-policy': 'same-origin',
  'referrer-policy': 'no-referrer'
}

// `original` stays the decoded email source (unchanged contract); `file` is the
// exact uploaded file when the email came from one.
const query = z.object({
  part: z.enum(['original', 'html', 'text', 'file']),
  version: z.coerce.number().int().min(1).optional()
})

export async function GET(
  request: Request,
  ctx: { params: Promise<{ resultId: string }> }
) {
  const { resultId } = await ctx.params
  const context = await resolveRequestContext('client')
  if (!context || context.kind !== 'client')
    return Response.json(
      {
        ok: false,
        error: { code: 'unauthorized', message: 'Sign in to download.' }
      },
      { status: 401, headers: attachmentHeaders }
    )
  const url = new URL(request.url)
  const parsed = query.safeParse({
    part: url.searchParams.get('part'),
    version: url.searchParams.get('version') ?? undefined
  })
  if (!parsed.success || !z.uuid().safeParse(resultId).success)
    return Response.json(
      {
        ok: false,
        error: { code: 'invalid_request', message: 'Unknown download.' }
      },
      { status: 400, headers: attachmentHeaders }
    )
  if (parsed.data.part === 'file') {
    const importId = await fileForResult(context.tenantId, resultId)
    const original = importId
      ? await originalFile(context.tenantId, importId)
      : null
    if (!original)
      return Response.json(
        { ok: false, error: { code: 'not_found', message: 'Not available.' } },
        { status: 404, headers: attachmentHeaders }
      )
    return originalFileResponse(original)
  }
  const file = await emailExport(
    context.tenantId,
    resultId,
    parsed.data.part as 'original' | 'html' | 'text',
    parsed.data.version ?? null
  )
  if (!file)
    return Response.json(
      { ok: false, error: { code: 'not_found', message: 'Not available.' } },
      { status: 404, headers: attachmentHeaders }
    )
  const { name, type } = exportFilename(file)
  return new Response(new TextEncoder().encode(file.body), {
    headers: {
      ...attachmentHeaders,
      'content-type': type,
      'content-disposition': `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`
    }
  })
}
