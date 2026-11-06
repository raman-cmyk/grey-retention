import { pastedLimits } from '@/features/references/pasted'

// Shared by the browser hints and the server. Browser checks are hints only;
// the server re-validates bytes, size and format before any storage write.
export const fileLimits = {
  /**
   * Raw upload bound, kept in step with the private bucket and SQL checks.
   * 4 MiB leaves multipart overhead under the 4.5 MB request/response body
   * cap of the hosting platform's functions (uploads and original downloads).
   */
  rawBytes: 4 * 1024 * 1024,
  /** Decoded email source bound: the existing editor/copy/export limit. */
  decodedChars: pastedLimits.body,
  title: 200,
  fileName: 200
} as const

export type FileKind = 'html' | 'text' | 'eml'

export const acceptedFiles =
  '.html,.htm,.txt,.eml,text/html,text/plain,message/rfc822'

export const mediaTypes: Record<FileKind, string> = {
  html: 'text/html',
  text: 'text/plain',
  eml: 'message/rfc822'
}

/** Kind from the file name only; content is checked separately on the server. */
export function fileKind(name: string): FileKind | null {
  const match = /\.([a-z0-9]{1,8})$/i.exec(name.trim())
  const extension = match?.[1].toLowerCase()
  if (extension === 'html' || extension === 'htm') return 'html'
  if (extension === 'txt') return 'text'
  if (extension === 'eml') return 'eml'
  return null
}

/** Replaces any lone surrogate half so the text is valid for JSON, Postgres and URIs. */
export function wellFormed(value: string) {
  return value.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    '�'
  )
}

/**
 * Shortens display text to at most `max` UTF-16 units including a trailing
 * ellipsis, never splitting a surrogate pair. Only used for metadata and
 * names; email bodies and original bytes are never shortened.
 */
export function clipText(value: string, max: number) {
  const text = wellFormed(value)
  if (text.length <= max) return { value: text, cut: false }
  let end = max - 1
  const last = text.charCodeAt(end - 1)
  if (last >= 0xd800 && last <= 0xdbff) end -= 1
  return { value: `${text.slice(0, end)}…`, cut: true }
}

/**
 * Display/download name from an untrusted file name: base name only, without
 * controls, zero-width/bidirectional overrides, quotes or separators, bounded
 * with its extension kept. Empty when nothing usable remains.
 */
export function safeFileName(name: string) {
  const base = name.split(/[\\/]/).pop() ?? ''
  const cleaned = [...wellFormed(base).normalize('NFC')]
    .filter((c) => {
      const code = c.charCodeAt(0)
      return (
        code > 0x1f &&
        code !== 0x7f &&
        !(code >= 0x200b && code <= 0x200f) &&
        !(code >= 0x202a && code <= 0x202e) &&
        !(code >= 0x2066 && code <= 0x2069) &&
        code !== 0xfeff &&
        !'"\\/:*?<>|;'.includes(c)
      )
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned.length <= fileLimits.fileName) return cleaned
  const extension = /\.[a-z0-9]{1,8}$/i.exec(cleaned)?.[0] ?? ''
  const stem = cleaned.slice(0, cleaned.length - extension.length)
  return `${clipText(stem, fileLimits.fileName - extension.length).value}${extension}`
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Immediate, local feedback before anything is sent. */
export function fileHint(file: { name: string; size: number }) {
  if (!fileKind(file.name))
    return 'Choose an .html, .htm, .txt or .eml file. ZIP, mailbox (.mbox), Outlook (.msg), PDF and image files are not supported yet.'
  if (file.size === 0) return 'This file is empty. Choose another file.'
  if (file.size > fileLimits.rawBytes)
    // No rounded size here: a file just over the limit would read "4.0 MB".
    return 'This file is larger than the upload limit. The limit is 4 MB. Export a single email without large attachments and try again.'
  return null
}

export type ImportFailure =
  | 'unsupported_type'
  | 'not_an_email'
  | 'mbox_unsupported'
  | 'rename_to_eml'
  | 'malformed'
  | 'too_large'
  | 'content_too_large'
  | 'unsupported_charset'
  | 'ambiguous_encoding'
  | 'no_content'
  | 'limits_exceeded'
  | 'hash_mismatch'
  | 'source_missing'
  | 'setup_required'
  | 'storage_unavailable'
  | 'internal'
  | 'actor_inactive'
  | 'attempts_exhausted'
  | 'limit_reached'

/** Plain, actionable owner messages. Never includes file content or diagnostics. */
export function failureMessage(code: string | null) {
  switch (code) {
    case 'unsupported_type':
      return 'This file type is not supported. Upload a single email saved as .html, .htm, .txt or .eml.'
    case 'not_an_email':
      return 'This .eml file does not look like an email message. If it is a web page, save it as .html and upload that instead.'
    case 'mbox_unsupported':
      return 'This looks like a mailbox with many messages. Export just one email as .eml and upload that.'
    case 'rename_to_eml':
      return 'This file looks like a saved email message. Rename it to end in .eml and upload it again.'
    case 'malformed':
      return 'We could not read this email file; it seems damaged. Export it again from your email app and retry.'
    case 'too_large':
      return 'This file is larger than 4 MB. Export the email without large attachments and try again.'
    case 'content_too_large':
      return `The email itself is longer than ${fileLimits.decodedChars.toLocaleString('en')} characters, the most we can edit and copy exactly. Nothing was cut; try a shorter email.`
    case 'unsupported_charset':
      return 'This email uses a text encoding we cannot read reliably. Save or export it as UTF-8 and try again.'
    case 'ambiguous_encoding':
      return 'We could not tell how this file’s text is encoded. Save it as UTF-8 and try again.'
    case 'no_content':
      return 'We could not find any readable email text in this file.'
    case 'limits_exceeded':
      return 'This email has an unusually complex structure, so we stopped reading it. Export it again or paste its text instead.'
    case 'hash_mismatch':
    case 'source_missing':
      return 'The uploaded file is no longer available. Upload it again.'
    case 'setup_required':
      return 'File upload is not set up for this workspace yet. You can paste the email instead.'
    case 'storage_unavailable':
    case 'internal':
    case 'attempts_exhausted':
      return 'We could not finish reading this file. Your upload is saved; try again.'
    case 'actor_inactive':
      return 'The person who uploaded this file is no longer an owner of this workspace, so it was not processed. Upload it again yourself.'
    case 'limit_reached':
      return 'This workspace has reached its limit for added emails.'
    default:
      return 'We could not add this file. Try again or paste the email instead.'
  }
}

/** Failures the owner can retry without choosing a new file. */
export function retryable(code: string | null) {
  return (
    code === 'storage_unavailable' ||
    code === 'internal' ||
    code === 'attempts_exhausted' ||
    code === 'setup_required'
  )
}
