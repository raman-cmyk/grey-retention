import { clipText, safeFileName } from './limits'

/**
 * Headers for untrusted downloads: always an attachment, never sniffed, cached,
 * framed or run as an app page. next.config.ts repeats the sandbox policy for
 * these paths because the app-wide policy would otherwise override it.
 */
export const attachmentHeaders = {
  'cache-control': 'private, no-store',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "sandbox; default-src 'none'",
  'cross-origin-resource-policy': 'same-origin',
  'referrer-policy': 'no-referrer'
}

const extensionFor: Record<string, string> = {
  'text/html': 'html',
  'text/plain': 'txt',
  'message/rfc822': 'eml'
}

/**
 * Safe Content-Disposition for an owner-supplied name: an ASCII fallback plus a
 * UTF-8 form, with separators, quotes and controls removed and the file's own
 * type extension kept.
 */
export function originalDisposition(fileName: string, mediaType: string) {
  const extension = extensionFor[mediaType] ?? 'bin'
  const display = safeFileName(fileName)
  const stem =
    clipText(display.replace(/\.(html?|txt|eml)$/i, ''), 120).value || 'email'
  const ascii =
    stem
      .normalize('NFKD')
      .replace(/[^\x20-\x7e]/g, '')
      .replace(/[^A-Za-z0-9._ -]/g, '_')
      .trim() || 'email'
  const original = /\.(html?|txt|eml)$/i.exec(display)?.[0] ?? `.${extension}`
  return `attachment; filename="${ascii}${original.toLowerCase()}"; filename*=UTF-8''${encodeURIComponent(`${stem}${original.toLowerCase()}`)}`
}

export function originalFileResponse(file: {
  bytes: Uint8Array
  fileName: string
  mediaType: string
}) {
  return new Response(file.bytes as unknown as BodyInit, {
    headers: {
      ...attachmentHeaders,
      // The raw bytes are served as uploaded; no charset is asserted for them.
      'content-type': file.mediaType,
      'content-length': String(file.bytes.length),
      'content-disposition': originalDisposition(file.fileName, file.mediaType)
    }
  })
}

export function jsonError(
  status: 400 | 401 | 404,
  code: string,
  message: string
) {
  return Response.json(
    { ok: false, error: { code, message } },
    { status, headers: attachmentHeaders }
  )
}
