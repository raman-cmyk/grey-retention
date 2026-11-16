import { EMAIL_WIDTH } from '@/features/blocks/render'
import { footerProblems } from '@/features/klaviyo-push/html'
import { gmailClipBytes } from '@/features/release-qa/checks'

/**
 * DST-005 part 1: the hard checks on a built email's HTML, in the real
 * build path (the design step), before it is stored. Each problem is a
 * plain sentence. They check what the email is as drawn, never the draft:
 * the studio's pictures and the coded blocks alike.
 *
 * - Weight: at most Gmail's 102 KB (Gmail cuts off the rest).
 * - Width: nothing wider than the 600 px email.
 * - Alt text: every picture has its words (read with pictures off).
 * - Links: every link is https or mailto, or one of Klaviyo's tags;
 *   never empty, `#` or http; at least one.
 * - The footer: Klaviyo's unsubscribe, preferences, web view, brand name
 *   and address tags (as the push checks them).
 * - The offer: no percent drawn (in the text or a picture's alt) above
 *   the owner's max discount.
 *
 * Contrast is kept by construction: the blocks draw text in a colour
 * readable on its background (WCAG 4.5, 3 for large text, `readableOn`),
 * and the Design critic scores a studio picture's contrast.
 */

export type HardCheck =
  'weight' | 'width' | 'alt' | 'links' | 'footer' | 'offer'

export type HardProblem = { check: HardCheck; problem: string }

const named: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
}
const decoded = (text: string) =>
  text
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) =>
      String.fromCodePoint(parseInt(n, 16))
    )
    .replace(/&([a-z]+);/gi, (m, n: string) => named[n.toLowerCase()] ?? m)

/** The words a reader sees: the text and every picture's alt. */
function seenWords(html: string) {
  const body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  const alts = [...body.matchAll(/<img\b[^>]*>/gi)].map(
    ([tag]) => /\balt\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? ''
  )
  const text = body.replace(/<[^>]+>/g, ' ')
  return decoded([text, ...alts].join(' ')).replace(/\s+/g, ' ')
}

/** A link a reader may follow, or one of Klaviyo's own tags. */
const linkOk = (href: string) => {
  const h = decoded(href).trim()
  if (/^\{%\s*(unsubscribe|manage_preferences|web_view)\b[^%]*%\}$/.test(h))
    return true
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(h)) return true
  try {
    const u = new URL(h)
    return u.protocol === 'https:' && !u.username && !u.password
  } catch {
    return false
  }
}

export function hardProblems(
  html: string,
  rules: { maxDiscountPercent: number }
): HardProblem[] {
  const problems: HardProblem[] = []
  const add = (check: HardCheck, problem: string) =>
    problems.push({ check, problem })
  const bytes = Buffer.byteLength(html, 'utf8')
  if (bytes > gmailClipBytes)
    add(
      'weight',
      `The email is ${Math.ceil(bytes / 1024)} KB; Gmail cuts off emails over 102 KB.`
    )
  const wide = [
    ...html.matchAll(/\bwidth\s*=\s*"(\d+)(?:px)?"/gi),
    ...html.matchAll(/(?:^|[;"\s])(?:min-)?width\s*:\s*(\d+)px/gi)
  ]
    .map((m) => Number(m[1]))
    .filter((w) => w > EMAIL_WIDTH)
  if (wide.length)
    add(
      'width',
      `Something is ${Math.max(...wide)} px wide; the email is ${EMAIL_WIDTH}.`
    )
  const pictures = [...html.matchAll(/<img\b[^>]*>/gi)].map(([tag]) => tag)
  const bare = pictures.filter(
    (tag) => !(/\balt\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? '').trim()
  ).length
  if (bare)
    add(
      'alt',
      `${bare} picture${bare === 1 ? ' has' : 's have'} no words for when pictures are off.`
    )
  const links = [...html.matchAll(/<a\b[^>]*?\bhref\s*=\s*"([^"]*)"/gi)].map(
    (m) => m[1]!
  )
  const broken = links.filter((h) => !linkOk(h)).length
  if (!links.some((h) => /^https:/i.test(decoded(h).trim())))
    add('links', 'The email has no link to the store.')
  if (broken)
    add(
      'links',
      `${broken} link${broken === 1 ? ' is' : 's are'} not a safe https link.`
    )
  for (const problem of footerProblems(html)) add('footer', problem)
  const max = rules.maxDiscountPercent
  // A percent off: "20% off", "save 20%", "up to 20%", "20% discount"
  // (a "100% linen" is not an offer).
  const drawn = [
    ...seenWords(html).matchAll(
      /(\d{1,3})\s?%\s*(?:off|discount)\b|\b(?:save|up to|take|get)\s+(\d{1,3})\s?%/gi
    )
  ].map((m) => Number(m[1] ?? m[2]))
  const over = drawn.filter((p) => p > max)
  if (over.length)
    add(
      'offer',
      max <= 0
        ? `The email shows ${Math.max(...over)}% though no discount is allowed.`
        : `The email shows ${Math.max(...over)}%, over your max of ${max}%.`
    )
  return problems
}
