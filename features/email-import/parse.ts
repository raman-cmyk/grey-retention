import PostalMime from 'postal-mime'
import { pastedReadable } from '@/features/references/pasted'
import {
  clipText,
  fileLimits,
  type FileKind,
  type ImportFailure
} from './limits'

// Untrusted input. Nothing here fetches, executes or writes anything: bytes in,
// decoded text and bounded metadata out. MIME structure, encoded words, charsets
// and transfer encodings are handled by PostalMime (pinned, zero dependencies);
// this module bounds it, refuses what it cannot read faithfully and picks the
// email body. Attachments stay inside the preserved raw file and are only counted.

export type ParsedEmailFile = {
  subject: string
  body: string
  readableText: string
  format: 'html' | 'text'
  headerSubject: string | null
  headerFrom: string | null
  headerDate: string | null
  attachmentCount: number
  notes: string[]
}

export type ParseResult =
  { ok: true; value: ParsedEmailFile } | { ok: false; code: ImportFailure }

/** Passed to PostalMime; never derived from input. */
export const mimeLimits = {
  maxNestingDepth: 20,
  maxHeadersSize: 256 * 1024,
  maxPartCount: 200,
  // Forwarded messages stay attachments instead of being rendered into the body.
  maxRfc822NestingDepth: 0,
  maxForwardedAddresses: 200
} as const

// Control, zero-width, bidirectional-override and byte-order characters, built
// from code points (as in the paste module) so metadata cannot spoof the display.
const controls = new RegExp(
  `[${(
    [
      [0x00, 0x08],
      [0x0b, 0x1f],
      [0x7f, 0x7f],
      [0x200b, 0x200f],
      [0x2028, 0x202e],
      [0x2060, 0x2064],
      [0xfeff, 0xfeff]
    ] as [number, number][]
  )
    .map(
      ([from, to]) =>
        `${String.fromCodePoint(from)}-${String.fromCodePoint(to)}`
    )
    .join('')}]`,
  'g'
)

function startsWith(bytes: Uint8Array, signature: number[], offset = 0) {
  return signature.every((value, index) => bytes[offset + index] === value)
}

/** Containers and binaries that are never emails, whatever their name. */
function binarySignature(bytes: Uint8Array) {
  return (
    startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || // ZIP
    startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]) ||
    startsWith(bytes, [0x25, 0x50, 0x44, 0x46]) || // PDF
    startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]) || // PNG
    startsWith(bytes, [0xff, 0xd8, 0xff]) || // JPEG
    startsWith(bytes, [0x47, 0x49, 0x46, 0x38]) || // GIF
    startsWith(bytes, [0x1f, 0x8b]) || // gzip
    startsWith(bytes, [0x52, 0x61, 0x72, 0x21]) || // RAR
    startsWith(bytes, [0x37, 0x7a, 0xbc, 0xaf]) || // 7z
    startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0]) || // OLE (.msg/.doc)
    (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
      startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) // WebP
  )
}

function hasBom(bytes: Uint8Array) {
  if (startsWith(bytes, [0xef, 0xbb, 0xbf])) return 'utf-8'
  if (startsWith(bytes, [0xff, 0xfe])) return 'utf-16le'
  if (startsWith(bytes, [0xfe, 0xff])) return 'utf-16be'
  return null
}

function decoderFor(label: string) {
  const candidates = [label, label.replace(/^x-/, ''), label.replace(/_/g, '-')]
  for (const candidate of candidates) {
    try {
      return new TextDecoder(candidate, { fatal: true })
    } catch {
      // try the next spelling
    }
  }
  return null
}

const latin1 = new TextDecoder('latin1')

/** A meta charset in the first 1024 bytes, as browsers pre-scan an HTML file. */
function metaCharset(bytes: Uint8Array) {
  const head = latin1.decode(bytes.subarray(0, 1024))
  return (
    /<meta\b[^>]{0,200}?charset\s*=\s*["']?\s*([a-z0-9_.:-]{1,40})/i
      .exec(head)?.[1]
      .toLowerCase() ?? null
  )
}

function decodeText(
  bytes: Uint8Array,
  kind: 'html' | 'text'
): { ok: true; text: string } | { ok: false; code: ImportFailure } {
  // Precedence follows browsers: a byte order mark wins, then an explicit HTML
  // declaration, then UTF-8. Every decode is strict; nothing is guessed.
  const bom = hasBom(bytes)
  const meta = !bom && kind === 'html' ? metaCharset(bytes) : null
  // Without a BOM a UTF-16 declaration cannot be true of ASCII-compatible
  // markup, so browsers read it as UTF-8; do the same.
  const declared = meta && /^utf-?16/.test(meta) ? 'utf-8' : meta
  if (!bom && bytes.includes(0)) return { ok: false, code: 'unsupported_type' }
  const decoder = bom
    ? new TextDecoder(bom, { fatal: true })
    : declared
      ? decoderFor(declared)
      : new TextDecoder('utf-8', { fatal: true })
  // A declared encoding this runtime cannot decode is refused even when the
  // bytes happen to be ASCII, so the owner's declaration is never overridden.
  if (!decoder) return { ok: false, code: 'unsupported_charset' }
  try {
    return { ok: true, text: decoder.decode(bytes) }
  } catch {
    return { ok: false, code: 'ambiguous_encoding' }
  }
}

/**
 * Every charset an email declares (part parameters and encoded words) must be one
 * this runtime decodes; otherwise PostalMime would silently read it as
 * windows-1252. Linear scans of the raw ASCII view, not a MIME parser.
 */
function undecodableCharset(raw: string) {
  const labels = new Set<string>()
  for (const match of raw.matchAll(/charset\s*=\s*"?([^\s";>]{1,60})/gi))
    labels.add(match[1].toLowerCase())
  for (const match of raw.matchAll(
    /=\?([^?\s*]{1,60})(?:\*[^?\s]{0,20})?\?[bq]\?/gi
  ))
    labels.add(match[1].toLowerCase())
  if (labels.size > 50) return true
  for (const label of labels) if (!decoderFor(label)) return true
  return false
}

/** Looks like RFC 5322 headers: a saved message misnamed as .html/.txt. */
function looksLikeMessage(text: string) {
  const head = text.slice(0, 4000)
  const block =
    /^(?:[!-9;-~]{1,76}:[^\n]*\r?\n(?:[ \t][^\n]*\r?\n)*){2,}\r?\n/.exec(head)
  return (
    !!block &&
    /^(mime-version|received|return-path|message-id):/im.test(block[0])
  )
}

function clean(value: string, max: number) {
  return clipText(value.replace(controls, '').replace(/\s+/g, ' ').trim(), max)
}

/**
 * A sending date the database contract can store (years 1–9999, plain
 * `YYYY-MM-DDTHH:MM:SS.sssZ`). Anything else is dropped as metadata; it never
 * fails an otherwise readable email.
 */
export function contractDate(value: string) {
  const date = new Date(value)
  const year = date.getUTCFullYear()
  if (!Number.isFinite(date.getTime()) || year < 1 || year > 9999) return null
  const iso = date.toISOString()
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(iso) ? iso : null
}

function htmlTitle(html: string) {
  const match = /<title\b[^>]{0,200}>([^<]{1,1000})<\/title>/i.exec(
    html.slice(0, 20_000)
  )
  return match ? pastedReadable(match[1], 'html').text : ''
}

function fileStem(name: string) {
  return name.replace(/\.[a-z0-9]{1,8}$/i, '')
}

function formatAddress(from: unknown) {
  if (!from || typeof from !== 'object') return null
  const value = from as { name?: unknown; address?: unknown; group?: unknown }
  const name = typeof value.name === 'string' ? value.name : ''
  const address = typeof value.address === 'string' ? value.address : ''
  const text = name && address ? `${name} <${address}>` : name || address
  return text || null
}

function chooseSubject(
  candidates: (string | null | undefined)[],
  notes: string[]
) {
  for (const candidate of candidates) {
    if (!candidate) continue
    const subject = clean(candidate, fileLimits.title)
    if (!subject.value) continue
    if (subject.cut) notes.push('subject_shortened')
    return subject.value
  }
  return 'Uploaded email'
}

function finish(
  body: string,
  format: 'html' | 'text',
  subject: string,
  extra: Omit<ParsedEmailFile, 'body' | 'format' | 'subject' | 'readableText'>
): ParseResult {
  if (!body.trim()) return { ok: false, code: 'no_content' }
  if (body.length > fileLimits.decodedChars)
    return { ok: false, code: 'content_too_large' }
  const readable = pastedReadable(body, format)
  if (!readable.text.trim()) return { ok: false, code: 'no_content' }
  const notes = [...extra.notes]
  if (readable.limited) notes.push('preview_limited')
  return {
    ok: true,
    value: {
      ...extra,
      body,
      format,
      subject,
      readableText: readable.text,
      notes: [...new Set(notes)].slice(0, 8)
    }
  }
}

/**
 * Validates and decodes one uploaded email file. Never shortens content: a body
 * above the editor bound is refused. Only display metadata (subject/sender) may
 * be shortened, and that is recorded as a note.
 */
export async function parseEmailFile(
  bytes: Uint8Array,
  kind: FileKind,
  meta: { fileName: string; title: string }
): Promise<ParseResult> {
  if (bytes.length === 0) return { ok: false, code: 'no_content' }
  if (bytes.length > fileLimits.rawBytes)
    return { ok: false, code: 'too_large' }
  if (binarySignature(bytes)) return { ok: false, code: 'unsupported_type' }

  if (kind !== 'eml') {
    const decoded = decodeText(bytes, kind)
    if (!decoded.ok) return decoded
    if (looksLikeMessage(decoded.text))
      return { ok: false, code: 'rename_to_eml' }
    const notes: string[] = []
    const subject = chooseSubject(
      [
        meta.title,
        kind === 'html' ? htmlTitle(decoded.text) : null,
        fileStem(meta.fileName)
      ],
      notes
    )
    return finish(decoded.text, kind, subject, {
      headerSubject: null,
      headerFrom: null,
      headerDate: null,
      attachmentCount: 0,
      notes
    })
  }

  const raw = latin1.decode(bytes)
  // `raw` is a latin1 view, so a UTF-8 byte order mark appears as three characters.
  if (/^(?:ï»¿)?From [^\r\n]*\r?\n/.test(raw.slice(0, 1000)))
    return { ok: false, code: 'mbox_unsupported' }
  if (bytes.includes(0)) return { ok: false, code: 'unsupported_type' }
  if (undecodableCharset(raw)) return { ok: false, code: 'unsupported_charset' }
  let email: Awaited<ReturnType<typeof PostalMime.parse>>
  try {
    email = await PostalMime.parse(bytes, {
      ...mimeLimits,
      attachmentEncoding: 'arraybuffer'
    })
  } catch (error) {
    const code = String((error as { code?: unknown })?.code ?? '')
    return {
      ok: false,
      code: code.startsWith('EMAX') ? 'limits_exceeded' : 'malformed'
    }
  }
  const known = new Set([
    'from',
    'subject',
    'date',
    'mime-version',
    'content-type',
    'to',
    'message-id'
  ])
  if (!email.headers.some((header) => known.has(header.key)))
    return { ok: false, code: 'not_an_email' }

  const notes: string[] = []
  const html = email.html && email.html.trim() ? email.html : null
  const text = email.text && email.text.trim() ? email.text : null
  const attachments = email.attachments.filter(
    (a) => !(a.related && a.contentId)
  )
  if (attachments.length) notes.push('attachments_kept')
  if (html && /\bcid:/i.test(html)) notes.push('inline_images_placeholder')
  if (html && text) notes.push('text_part_available')

  const headerSubject = email.subject
    ? clean(email.subject, 2000).value || null
    : null
  const from = formatAddress(email.from)
  const sender = from ? clean(from, 400) : null
  if (sender?.cut) notes.push('sender_shortened')
  const headerDate = email.date ? contractDate(email.date) : null
  if (email.date && !headerDate) notes.push('date_unreadable')
  const subject = chooseSubject(
    [
      meta.title,
      headerSubject,
      html ? htmlTitle(html) : null,
      fileStem(meta.fileName)
    ],
    notes
  )

  return finish(html ?? text ?? '', html ? 'html' : 'text', subject, {
    headerSubject,
    headerFrom: sender?.value || null,
    headerDate,
    attachmentCount: Math.min(attachments.length, 10_000),
    notes
  })
}
