import PostalMime from 'postal-mime'
import { mimeLimits } from '@/features/email-import/parse'
import { bareAddress } from './addresses'

/** Biggest message stored and parsed; bigger ones become an ops task. */
export const maxMessageBytes = 10 * 1024 * 1024
/** Text kept on the competitor email (the full HTML is stored as a file). */
export const maxTextChars = 10_000
/**
 * HTML read for the plain-text version. The text is capped at 10,000
 * characters anyway, and a cap keeps the regexes fast on hostile HTML.
 */
const maxHtmlForText = 200_000

/**
 * Text safe to store: no NUL or other control characters (Postgres refuses
 * NUL), cut on whole characters so an emoji is never split in half, and
 * no lone surrogate halves left over.
 */
export function safeText(value: string, max: number) {
  const clean = value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .toWellFormed()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max)
  // The text is well formed, so a cut can only leave a first half behind.
  return /[\ud800-\udbff]$/.test(cut) ? cut.slice(0, -1) : cut
}

export type InboxMime = {
  messageId: string | null
  subject: string
  fromAddress: string | null
  /** Delivered-To, X-Original-To, To, Cc: where the +alias is looked for. */
  recipients: string[]
  /** Send time from the Date header (ISO), when it parses. */
  sentAt: string | null
  html: string | null
  text: string
  /** The first words of the text, for lists. */
  preview: string
}

type Address = { address?: string; group?: Address[] }
const addresses = (list: Address[] | undefined): string[] =>
  (list ?? []).flatMap((a) =>
    a.group ? addresses(a.group) : a.address ? [a.address] : []
  )

/**
 * Drops <script>, <style> and <head> blocks in one pass. A block that never
 * closes drops the rest. (A lazy regex here would rescan the whole text for
 * every opening tag: minutes on hostile HTML.)
 */
function dropBlocks(html: string) {
  const lower = html.toLowerCase()
  const open = /<(script|style|head)\b/g
  let out = ''
  let at = 0
  for (;;) {
    open.lastIndex = at
    const found = open.exec(lower)
    if (!found) return out + html.slice(at)
    out += html.slice(at, found.index) + ' '
    const close = lower.indexOf(`</${found[1]}`, found.index)
    if (close < 0) return out
    const end = lower.indexOf('>', close)
    if (end < 0) return out
    at = end + 1
  }
}

/** Turns HTML into plain words when an email has no text part. */
function textFromHtml(html: string) {
  return (
    dropBlocks(html.slice(0, maxHtmlForText))
      .replace(/<\/(p|div|tr|table|h[1-6])>/gi, '\n\n')
      .replace(/<br\s*\/?>|<\/li>/gi, '\n')
      // Stops at the next "<", so an unclosed tag never rescans the rest.
      .replace(/<[^<>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/g, "'")
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}

/**
 * Reads one raw message from the inbox. Charsets, quoted-printable, base64
 * and encoded words are handled by PostalMime with the same fixed limits
 * the email importer uses. Null when it is not a readable email.
 */
export async function readInboxMessage(
  raw: Uint8Array
): Promise<InboxMime | null> {
  if (raw.byteLength === 0 || raw.byteLength > maxMessageBytes) return null
  let email: Awaited<ReturnType<typeof PostalMime.parse>>
  try {
    email = await PostalMime.parse(raw, {
      ...mimeLimits,
      attachmentEncoding: 'arraybuffer'
    })
  } catch {
    return null
  }
  if (
    !email.headers.some((h) =>
      ['from', 'subject', 'date', 'message-id', 'to'].includes(h.key)
    )
  )
    return null
  const header = (key: string) =>
    email.headers.filter((h) => h.key === key).map((h) => h.value)
  const html = email.html?.trim() ? email.html : null
  const text = (
    email.text?.trim() ? email.text : html ? textFromHtml(html) : ''
  )
    .replace(/\r\n?/g, '\n')
    .trim()
  const sent = email.date ? Date.parse(email.date) : NaN
  return {
    messageId: email.messageId?.trim() || null,
    subject: safeText(
      safeText(email.subject ?? '', 1_000)
        .replace(/\s+/g, ' ')
        .trim(),
      200
    ).trim(),
    fromAddress: bareAddress(
      safeText((email.from as Address | undefined)?.address ?? '', 320) || null
    ),
    recipients: [
      ...(email.deliveredTo ? [email.deliveredTo] : []),
      ...header('delivered-to'),
      ...header('x-original-to'),
      ...addresses(email.to as Address[] | undefined),
      ...addresses(email.cc as Address[] | undefined)
    ],
    sentAt: Number.isFinite(sent) ? new Date(sent).toISOString() : null,
    html,
    text: safeText(text, maxTextChars),
    preview: safeText(text.replace(/\s+/g, ' '), 200)
  }
}
