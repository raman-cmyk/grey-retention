import { z } from 'zod'

// Shared by the live browser preview and the server action. The output is
// plain text that is only ever rendered as React text, never as markup.
export const pastedLimits = {
  subject: 200,
  body: 100_000,
  readable: 20_000,
  description: 300,
  url: 2_000
} as const

const removedBlocks =
  'script|style|head|title|noscript|template|iframe|object|embed|svg|math|xml|frameset|frame|applet'
const entities: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  copy: '©',
  reg: '®',
  trade: '™',
  bull: '•'
}

function decodeEntities(value: string) {
  return value.replace(
    /&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});/gi,
    (match, code: string) => {
      if (code[0] !== '#') return entities[code.toLowerCase()] ?? match
      const point =
        code[1] === 'x' || code[1] === 'X'
          ? parseInt(code.slice(2), 16)
          : parseInt(code.slice(1), 10)
      return point > 0 &&
        point <= 0x10ffff &&
        !(point >= 0xd800 && point <= 0xdfff)
        ? String.fromCodePoint(point)
        : ''
    }
  )
}

// Control, zero-width, bidirectional-override and byte-order characters,
// built from code points so the source stays plain ASCII.
const codeRange = ([from, to]: [number, number]) =>
  `${String.fromCodePoint(from)}-${String.fromCodePoint(to)}`
const invisible = new RegExp(
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
    .map(codeRange)
    .join('')}]`,
  'g'
)
const nonBreakingSpace = new RegExp(String.fromCodePoint(0xa0), 'g')

// Tag scans stop at the next "<", so unterminated tags cost linear time.
export function looksLikeMarkup(value: string) {
  return /<\/?[a-z!][^<>]*>/i.test(value)
}

/**
 * Converts pasted email text or markup into readable text. Executable,
 * styling and embedded-document content is removed entirely; remaining tags
 * are dropped, so images, links, tracking pixels and forms are never loaded.
 * `limited` reports that the readable result was cut at the preview bound;
 * the original paste itself is never shortened.
 */
export function pastedReadable(raw: string) {
  let text = raw.replace(/\r\n?/g, '\n')
  if (looksLikeMarkup(text)) {
    text = text
      .replace(/<!--[\s\S]*?(-->|$)/g, ' ')
      .replace(/<!\[CDATA\[[\s\S]*?(\]\]>|$)/gi, ' ')
      .replace(
        new RegExp(
          `<(${removedBlocks})\\b[^<>]*>[\\s\\S]*?(<\\/\\1\\s*>|$)`,
          'gi'
        ),
        ' '
      )
      .replace(new RegExp(`<\\/?(${removedBlocks})\\b[^<>]*>`, 'gi'), ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<li\b[^<>]*>/gi, '\n• ')
      .replace(
        /<\/?(p|div|tr|table|tbody|thead|h[1-6]|ul|ol|li|section|article|header|footer|blockquote|center|hr)\b[^<>]*>/gi,
        '\n\n'
      )
      .replace(/<\/?[a-z!?][^<>]*>/gi, ' ')
      .replace(/<\/?[a-z][^<>]*$/i, ' ')
    text = decodeEntities(text)
  }
  const full = text
    .replace(invisible, '')
    .replace(nonBreakingSpace, ' ')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const limited = full.length > pastedLimits.readable
  let preview = full.slice(0, pastedLimits.readable)
  // Never leave half of a surrogate pair at the cut (databases reject it):
  // replace only that half with a one-unit ellipsis, keeping the bound length.
  const last = preview.charCodeAt(preview.length - 1)
  if (limited && last >= 0xd800 && last <= 0xdbff)
    preview = `${preview.slice(0, -1)}${String.fromCodePoint(0x2026)}`
  // Not re-trimmed after cutting, so a stored preview at the bound keeps its
  // full length and can be recognized as limited when reopened.
  return { text: preview, limited }
}

export function readablePastedText(raw: string) {
  return pastedReadable(raw).text
}

/** A saved preview at the bound may be cut; the original is always kept. */
export function readableAtLimit(text: string) {
  return text.length >= pastedLimits.readable
}

/** Paragraph outline: the only structural information reused by a draft. */
export function pastedOutline(readable: string) {
  const count = readable
    .split(/\n\s*\n/)
    .filter((paragraph) => paragraph.trim()).length
  return [
    ...(count ? ['Opening'] : []),
    ...(count >= 3 ? ['Body'] : []),
    ...(count >= 2 ? ['Closing'] : [])
  ]
}

export function normalizeSourceUrl(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ''
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    !url.hostname ||
    url.href.length > pastedLimits.url
  )
    return null
  return url.href
}

export const pastedReferenceSchema = z.object({
  requestKey: z.uuid(),
  subject: z.string().trim().min(1).max(pastedLimits.subject),
  body: z.string().min(1).max(pastedLimits.body),
  sourceDescription: z.string().trim().max(pastedLimits.description),
  sourceUrl: z.string().max(pastedLimits.url)
})
