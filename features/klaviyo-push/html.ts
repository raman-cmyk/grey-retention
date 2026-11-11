import { createHash } from 'node:crypto'
import { gmailClipBytes } from '@/features/release-qa/checks'

/**
 * The email as it goes into Klaviyo (PSH-001): what is checked before
 * Klaviyo is called at all, its pictures moved to Klaviyo's library
 * (VISION rule 11), and the final checks on exactly the HTML sent. The
 * content checks (links, code, products, copy, dates: QAG-001's
 * `runReleaseQa`) are for the build to run before it asks for the push;
 * they are not wired yet, and must be before the owner's write switch is
 * turned on.
 */

const imgSrc = /(<img\b[^>]*?\ssrc\s*=\s*)(["'])(.*?)\2/gi
/** An `<img>` whose src is not in quotes: neither moved nor checked otherwise. */
const unquotedSrc = /<img\b[^>]*?\ssrc\s*=(?!\s*["'])/i
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

/** Pictures an email may have (each is imported into Klaviyo once). */
export const maxPictures = 40
/** What Klaviyo imports (jpeg, png, gif): another format named in the address is refused first. */
const otherFormat = /\.(webp|svg|avif|heic|heif|tiff?|bmp)(?:$|[?#])/i

/** A picture we can import: an https address, nothing inline, a format Klaviyo takes. */
export const importable = (src: string) => {
  try {
    const url = new URL(src)
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      src.length <= 2000 &&
      !otherFormat.test(url.pathname)
    )
  } catch {
    return false
  }
}

/**
 * Klaviyo's footer tags, all five Step 0's push used: the brand, its
 * address, unsubscribe, preferences and "view in browser" (the
 * `klaviyo` render mode writes them; the preview mode does not).
 */
export function footerProblems(html: string) {
  const problems: string[] = []
  if (!/\{\{\s*organization\.name\s*\}\}/.test(html))
    problems.push('The brand name is missing.')
  if (!/\{\{\s*organization\.full_address\s*\}\}/.test(html))
    problems.push('The store address is missing.')
  if (!/\{%\s*unsubscribe\b/.test(html))
    problems.push('The unsubscribe link is missing.')
  if (!/\{%\s*manage_preferences\b/.test(html))
    problems.push('The preferences link is missing.')
  if (!/\{%\s*web_view\b/.test(html))
    problems.push('The "view in browser" link is missing.')
  return problems
}

const klaviyoId = /^[A-Za-z0-9_-]{1,64}$/

/**
 * What stops a push before Klaviyo is called at all: an audience that is
 * not a Klaviyo id (the sample's), the footer tags, Gmail's size, and
 * pictures it could not import. Null when none.
 */
export function preflight(
  htmls: string[],
  audienceId: string
): { reason: string; check: string } | null {
  if (!klaviyoId.test(audienceId) || /^sample/i.test(audienceId))
    return { reason: 'audience_not_in_klaviyo', check: 'audience' }
  if (htmls.some((h) => footerProblems(h).length))
    return { reason: 'footer_missing', check: 'footer' }
  if (htmls.some((h) => Buffer.byteLength(h, 'utf8') > gmailClipBytes))
    return { reason: 'too_big_for_gmail', check: 'size' }
  if (htmls.some((h) => unquotedSrc.test(h)))
    return { reason: 'image_not_importable', check: 'images' }
  const pictures = [...new Set(htmls.flatMap(imageSources))]
  if (pictures.length > maxPictures)
    return { reason: 'too_many_pictures', check: 'images' }
  if (pictures.some((src) => !importable(src)))
    return { reason: 'image_not_importable', check: 'images' }
  return null
}

export type FinalCheck = { id: string; pass: boolean; problems: string[] }

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

/** A fingerprint of one design's HTML (a changed design gets a new template). */
export const htmlHash = (html: string) =>
  createHash('sha256').update(html).digest('hex')
