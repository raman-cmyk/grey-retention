import { createHash } from 'node:crypto'
import { gmailClipBytes } from '@/features/release-qa/checks'

/**
 * The email as it goes into Klaviyo (PSH-001): its pictures moved to
 * Klaviyo's library (VISION rule 11) and the final checks on exactly the
 * HTML sent. The content checks (links, code, products, copy, dates) run
 * before the push, on the build (QAG-001's `runReleaseQa`).
 */

const imgSrc = /(<img\b[^>]*?\ssrc\s*=\s*)(["'])(.*?)\2/gi
const decode = (s: string) => s.replace(/&amp;/g, '&')
const encode = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')

/** Every picture's address in the email, once each, in order. */
export function imageSources(html: string) {
  return [...new Set([...html.matchAll(imgSrc)].map((m) => decode(m[3]!)))]
}

/** The email with each picture's address replaced by its Klaviyo address. */
export function withImages(html: string, moved: Record<string, string>) {
  return html.replace(imgSrc, (all, start: string, _q: string, src: string) => {
    const to = moved[decode(src)]
    return to ? `${start}"${encode(to)}"` : all
  })
}

/** A picture we can import: an https address, nothing inline. */
export const importable = (src: string) => {
  try {
    const url = new URL(src)
    return url.protocol === 'https:' && !url.username && !url.password
  } catch {
    return false
  }
}

export type FinalCheck = { id: string; pass: boolean; problems: string[] }

/** Klaviyo's footer tags: the unsubscribe link and the store's address. */
export function footerProblems(html: string) {
  const problems: string[] = []
  if (!/\{%\s*unsubscribe\b/.test(html))
    problems.push('The unsubscribe link is missing.')
  if (!/\{\{\s*organization\.full_address\s*\}\}/.test(html))
    problems.push('The store address is missing.')
  return problems
}

/**
 * The checks on the HTML sent: every picture is one Klaviyo gave us, the
 * footer has Klaviyo's tags, and the email is small enough for Gmail.
 */
export function finalChecks(
  html: string,
  klaviyoImages: ReadonlySet<string>
): FinalCheck[] {
  const check = (id: string, problems: string[]) => ({
    id,
    pass: problems.length === 0,
    problems
  })
  const notMoved = imageSources(html).filter((src) => !klaviyoImages.has(src))
  const bytes = Buffer.byteLength(html, 'utf8')
  return [
    check(
      'images',
      notMoved.map(
        (src) => `A picture is not in Klaviyo (${src.slice(0, 80)}).`
      )
    ),
    check('footer', footerProblems(html)),
    check(
      'size',
      bytes > gmailClipBytes
        ? [
            `The email is ${Math.ceil(bytes / 1024)}KB. Gmail cuts off emails over 102KB.`
          ]
        : []
    )
  ]
}

/** A short fingerprint of one design's HTML (a changed design gets a new template). */
export const htmlHash = (html: string) =>
  createHash('sha256').update(html).digest('hex')
