import type { BlockBrand } from '@/features/blocks/brand'
import { footerHtml, klaviyoFooterTags } from '@/features/blocks/klaviyo-tags'
import {
  escapeHtml,
  safeImageUrl,
  safeUrl,
  type RenderMode
} from '@/features/blocks/render'
import { linkMark, type Letter } from './letter'

/**
 * TXT-001: a letter drawn as a person's email looks: the reader's own
 * system font at 16 px, left aligned, no banners, no buttons and no
 * pictures but an optional small logo at the top, then Klaviyo's footer.
 * It sets no colours (the inbox's own, in light and dark), and keeps to
 * about 560 px wide. The plain-text part is the same letter, every link
 * written out after its words, and the footer's tags as plain links.
 */
export const letterFont =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
/** The logo's height on a letter, in px. */
export const letterLogoPx = 32

/**
 * Klaviyo's tags for the plain-text footer: the URL alone, as plain text
 * has no links (Klaviyo's documented `_link` tags).
 */
export const plainFooterTags = {
  unsubscribe: '{% unsubscribe_link %}',
  preferences: '{% manage_preferences_link %}'
} as const

const invisible = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/g

/** Text for the plain part: never a Klaviyo tag of the writer's. */
const plainText = (text: string) =>
  text.replace(invisible, '').replaceAll('{', '(').replaceAll('}', ')')

/** A store link for the plain part, or null when it is not one to send. */
function plainUrl(url: string) {
  try {
    const u = new URL(url.trim())
    if (!['https:', 'http:', 'mailto:'].includes(u.protocol)) return null
    if (u.username || u.password) return null
    return u.toString().replaceAll('{', '%7B').replaceAll('}', '%7D')
  } catch {
    return null
  }
}

/** `text` with its link marks drawn by `link`, the rest by `piece`. */
function withLinks(
  text: string,
  link: (words: string, n: number) => string,
  piece: (text: string) => string
) {
  let out = ''
  let at = 0
  for (const m of text.matchAll(linkMark)) {
    out += piece(text.slice(at, m.index)) + link(m[1]!.trim(), Number(m[2]))
    at = m.index + m[0].length
  }
  return out + piece(text.slice(at))
}

const ps = (text: string) =>
  /^p\.?\s*s\b\.?/i.test(text) ? text : `P.S. ${text}`

/** The letter's HTML and its plain-text part. */
export function renderLetter(
  letter: Letter,
  input: { brand: BlockBrand; mode?: RenderMode; logo?: boolean }
): { html: string; text: string } {
  const mode = input.mode ?? 'preview'
  const { brand } = input
  const url = (n: number) => letter.links[n - 1]?.url
  const html = (text: string) =>
    withLinks(
      text,
      (words, n) => {
        const href = url(n) ? safeUrl(url(n)!) : '#'
        return href === '#'
          ? escapeHtml(words)
          : `<a href="${href}">${escapeHtml(words)}</a>`
      },
      (piece) => escapeHtml(piece).replace(/\n/g, '<br>')
    )
  const plain = (text: string) =>
    withLinks(
      text,
      (words, n) => {
        const href = url(n) ? plainUrl(url(n)!) : null
        return href ? `${plainText(words)} (${href})` : plainText(words)
      },
      plainText
    )
  const p = (inner: string, margin = '0 0 16px') =>
    `<p style="margin:${margin}">${inner}</p>`
  const logo = input.logo && brand.logo ? safeImageUrl(brand.logo, mode) : null
  const pre = letter.preheader
    ? `<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all">${escapeHtml(letter.preheader)}${'&#847;&zwnj;&nbsp;'.repeat(40)}</div>`
    : ''
  const signed = [letter.signoff, letter.signature, letter.role].filter(
    (s): s is string => !!s
  )
  const body = [
    logo
      ? p(
          `<img src="${logo}" alt="${escapeHtml(brand.name)}" height="${letterLogoPx}" style="display:block;height:${letterLogoPx}px;width:auto;border:0">`,
          '0 0 24px'
        )
      : '',
    letter.greeting ? p(html(letter.greeting)) : '',
    ...letter.body.map((para) => p(html(para))),
    p(signed.map((s) => escapeHtml(s)).join('<br>'), '24px 0 0'),
    letter.ps ? p(html(ps(letter.ps)), '24px 0 0') : '',
    `<p style="margin:40px 0 0;font-size:12px;line-height:1.5;color:#777777">${footerHtml(mode, brand.name)}</p>`
  ].join('')
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${escapeHtml(letter.subject)}</title></head><body style="margin:0;padding:0">${pre}<div class="gr-letter" style="max-width:560px;padding:24px 16px;font-family:${letterFont};font-size:16px;line-height:1.5;text-align:left">${body}</div></body></html>`

  const footer =
    mode === 'klaviyo'
      ? [
          `${klaviyoFooterTags.organization}, ${klaviyoFooterTags.address}`,
          `Unsubscribe: ${plainFooterTags.unsubscribe}`,
          `Preferences: ${plainFooterTags.preferences}`
        ]
      : [
          `${plainText(brand.name)}, your store address (Klaviyo adds it when it sends)`,
          'Unsubscribe: (Klaviyo adds the link when it sends)',
          'Preferences: (Klaviyo adds the link when it sends)'
        ]
  const text = [
    ...(letter.greeting ? [plain(letter.greeting)] : []),
    ...letter.body.map(plain),
    signed.map(plainText).join('\n'),
    ...(letter.ps ? [plain(ps(letter.ps))] : []),
    `--\n${footer.join('\n')}`
  ].join('\n\n')
  return { html: page, text: `${text}\n` }
}
