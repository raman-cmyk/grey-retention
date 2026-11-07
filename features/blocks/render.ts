import type {
  Block,
  BlockContent,
  BlockImage,
  BlockLink,
  BlockProduct,
  BlockType
} from './catalog'
import {
  type BlockBrand,
  fontStack,
  inkOn,
  readableOn,
  safeColor
} from './brand'
import { footerLinks } from './klaviyo-tags'

/**
 * Email-safe HTML for the block library (BLK-001): nested tables, inline
 * styles, a 600px frame that stacks to one column on a phone, the brand's
 * colours and font with a web-safe fallback, and no script, form, external
 * stylesheet or web font link. All text is escaped, including `{` and `}`,
 * so copy can never become a Klaviyo template tag.
 *
 * `klaviyo` mode writes Klaviyo's footer tags; `preview` mode writes
 * labelled placeholders for our own sandboxed previews.
 */
export type RenderMode = 'klaviyo' | 'preview'

export const EMAIL_WIDTH = 600
/** Gmail clips a message above about 102 KB (VISION.md Step 4 QA). */
export const GMAIL_CLIP_BYTES = 102 * 1024
const PAD = 32
const INNER = EMAIL_WIDTH - PAD * 2
const GAP = 16

type Theme = {
  font: string
  page: string
  ink: string
  muted: string
  line: string
  primary: string
  onPrimary: string
  accent: string
  onAccent: string
  /** Primary as text on the page colour, darkened when too faint. */
  headline: string
}

type Ctx = { brand: BlockBrand; mode: RenderMode; theme: Theme }

export function themeOf(brand: BlockBrand): Theme {
  const page = safeColor(brand.colors.background, '#ffffff')
  const primary = safeColor(brand.colors.primary, '#1a1a1a')
  const accent = safeColor(brand.colors.accent, primary)
  const ink = inkOn(page)
  return {
    font: fontStack(brand.font),
    page,
    ink,
    muted: ink === '#ffffff' ? '#d6d6d6' : '#5c5c5c',
    line: ink === '#ffffff' ? '#4a4a4a' : '#e4e4e4',
    primary,
    onPrimary: inkOn(primary),
    accent,
    onAccent: inkOn(accent),
    headline: readableOn(primary, page)
  }
}

/** Escapes text for HTML and for Klaviyo's template language. */
export function escapeHtml(text: string) {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('{', '&#123;')
    .replaceAll('}', '&#125;')
}

/** A link target that is safe in an email: https, http or mailto. */
export function safeUrl(url: string) {
  try {
    const u = new URL(url.trim())
    if (!['https:', 'http:', 'mailto:'].includes(u.protocol)) return '#'
    return escapeHtml(u.toString())
  } catch {
    return '#'
  }
}

const imageData =
  /^data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,[a-z0-9+/=]+$/i

/**
 * An image source: https (Klaviyo-hosted in real sends, VISION rule 11) or
 * an inline image for our own previews. Anything else is dropped.
 */
export function safeImageUrl(url: string) {
  const v = url.trim()
  if (imageData.test(v)) return v
  try {
    const u = new URL(v)
    return u.protocol === 'https:' ? escapeHtml(u.toString()) : null
  } catch {
    return null
  }
}

const table = (inner: string, attrs = '') =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"${attrs}>${inner}</table>`

function paragraphs(text: string, style: string) {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (p) =>
        `<p style="margin:0 0 14px;${style}">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`
    )
    .join('')
}

function heading(text: string, ctx: Ctx, size = 26, align = 'center') {
  return `<h2 class="gr-h2" style="margin:0 0 14px;font-family:${ctx.theme.font};font-size:${size}px;line-height:${Math.round(size * 1.2)}px;font-weight:700;color:${ctx.theme.headline};text-align:${align}">${escapeHtml(text)}</h2>`
}

function bodyText(ctx: Ctx, size = 16) {
  return `font-family:${ctx.theme.font};font-size:${size}px;line-height:${Math.round(size * 1.5)}px;color:${ctx.theme.ink}`
}

/** A "bulletproof" button: a table cell with the link filling it. */
function button(
  link: BlockLink,
  ctx: Ctx,
  colors: { bg: string; fg: string } = {
    bg: ctx.theme.primary,
    fg: ctx.theme.onPrimary
  },
  align = 'center'
) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${align}" style="margin:${align === 'center' ? '0 auto' : '0'}"><tr><td style="border-radius:6px;background:${colors.bg}"><a href="${safeUrl(link.url)}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:${ctx.theme.font};font-size:16px;line-height:20px;font-weight:700;color:${colors.fg};text-decoration:none;border-radius:6px">${escapeHtml(link.label)}</a></td></tr></table>`
}

function image(img: BlockImage, width: number, style = '') {
  const src = safeImageUrl(img.url)
  if (!src) return ''
  return `<img src="${src}" alt="${escapeHtml(img.alt)}" width="${width}" style="display:block;width:100%;max-width:${width}px;height:auto;border:0;outline:none;text-decoration:none;${style}">`
}

function linked(url: string, inner: string) {
  return `<a href="${safeUrl(url)}" target="_blank" style="text-decoration:none">${inner}</a>`
}

/**
 * Side-by-side cells. `stack` cells become full width on a phone; others
 * stay side by side (small photos and 2-up grids read fine at 375px).
 */
function columns(cells: string[], width: number, stack: boolean) {
  const n = cells.length
  const cell = Math.floor((width - GAP * (n - 1)) / n)
  const tds = cells
    .map((c, i) => {
      const pad = `padding-left:${i === 0 ? 0 : GAP / 2}px;padding-right:${i === n - 1 ? 0 : GAP / 2}px`
      return `<td class="${stack ? 'gr-col' : 'gr-keep'}" width="${cell}" valign="top" style="width:${cell}px;${pad}">${c}</td>`
    })
    .join('')
  return { html: table(`<tr>${tds}</tr>`), cell }
}

function chunk<T>(list: readonly T[], size: number) {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

function row(
  type: BlockType,
  inner: string,
  opts: { padding?: string; bg?: string } = {}
) {
  const padding = opts.padding ?? `28px ${PAD}px`
  return `<tr data-block="${type}"><td class="gr-pad" style="padding:${padding};${opts.bg ? `background:${opts.bg};` : ''}">${inner}</td></tr>`
}

function priceLine(p: BlockProduct, ctx: Ctx, size = 15) {
  const was = p.compareAt
    ? ` <span style="color:${ctx.theme.muted};text-decoration:line-through;font-weight:400">${escapeHtml(p.compareAt)}</span>`
    : ''
  return `<p style="margin:0;${bodyText(ctx, size)};font-weight:700">${escapeHtml(p.price)}${was}</p>`
}

function productCard(p: BlockProduct, width: number, ctx: Ctx) {
  return `${linked(p.url, image(p.image, width, 'border-radius:4px'))}<p style="margin:10px 0 4px;${bodyText(ctx, 15)}">${linked(p.url, `<span style="color:${ctx.theme.ink}">${escapeHtml(p.title)}</span>`)}</p>${priceLine(p, ctx)}`
}

const stars = (rating: number, ctx: Ctx) =>
  `<span style="color:${readableOn(ctx.theme.accent, ctx.theme.page)};font-size:18px;letter-spacing:2px" aria-label="${rating} out of 5 stars">${'★'.repeat(rating)}${'☆'.repeat(5 - rating)}</span>`

type Renderers = {
  [T in BlockType]: (content: BlockContent<T>, ctx: Ctx) => string
}

const renderers: Renderers = {
  header: (c, ctx) => {
    const { brand, theme } = ctx
    const logo =
      brand.logo && safeImageUrl(brand.logo.url)
        ? `<img src="${safeImageUrl(brand.logo.url)}" alt="${escapeHtml(brand.logo.alt ?? brand.name)}" width="160" style="display:block;margin:0 auto;width:160px;max-width:60%;height:auto;border:0">`
        : `<p style="margin:0;font-family:${theme.font};font-size:24px;line-height:30px;font-weight:700;letter-spacing:1px;color:${theme.headline};text-align:center">${escapeHtml(brand.name)}</p>`
    const links = c.links.length
      ? `<p style="margin:14px 0 0;text-align:center;${bodyText(ctx, 13)}">${c.links
          .map(
            (l) =>
              `<a href="${safeUrl(l.url)}" target="_blank" style="color:${theme.ink};text-decoration:none;text-transform:uppercase;letter-spacing:1px;margin:0 10px">${escapeHtml(l.label)}</a>`
          )
          .join('')}</p>`
      : ''
    return row('header', logo + links, { padding: `24px ${PAD}px` })
  },
  hero: (c, ctx) =>
    row('hero', image(c.image, EMAIL_WIDTH), { padding: '0' }) +
    row(
      'hero',
      `<h1 class="gr-h1" style="margin:0 0 12px;font-family:${ctx.theme.font};font-size:34px;line-height:40px;font-weight:700;color:${ctx.theme.headline};text-align:center">${escapeHtml(c.headline)}</h1>${c.subline ? `<p style="margin:0 0 22px;text-align:center;${bodyText(ctx, 17)}">${escapeHtml(c.subline)}</p>` : ''}${button(c.cta, ctx)}`
    ),
  offer_banner: (c, ctx) => {
    const t = ctx.theme
    const code = c.code
      ? `<p style="margin:0 0 6px;font-family:${t.font};font-size:14px;line-height:20px;color:${t.onPrimary}">Use code</p><p style="margin:0 0 14px"><span style="display:inline-block;padding:8px 18px;border:2px dashed ${t.onPrimary};font-family:${t.font};font-size:22px;line-height:28px;font-weight:700;letter-spacing:2px;color:${t.onPrimary}">${escapeHtml(c.code)}</span></p>`
      : ''
    return row(
      'offer_banner',
      `<p class="gr-h1" style="margin:0 0 10px;font-family:${t.font};font-size:36px;line-height:42px;font-weight:700;color:${t.onPrimary};text-align:center">${escapeHtml(c.headline)}</p>${c.detail ? `<p style="margin:0 0 16px;font-family:${t.font};font-size:16px;line-height:24px;color:${t.onPrimary};text-align:center">${escapeHtml(c.detail)}</p>` : ''}<div style="text-align:center">${code}</div>${c.expiry ? `<p style="margin:0 0 18px;font-family:${t.font};font-size:13px;line-height:18px;color:${t.onPrimary};text-align:center">${escapeHtml(c.expiry)}</p>` : ''}${button(c.cta, ctx, { bg: t.onPrimary, fg: t.primary })}`,
      { bg: t.primary, padding: `36px ${PAD}px` }
    )
  },
  free_shipping_bar: (c, ctx) =>
    row(
      'free_shipping_bar',
      `<p style="margin:0;font-family:${ctx.theme.font};font-size:14px;line-height:20px;font-weight:700;letter-spacing:0.5px;color:${ctx.theme.onAccent};text-align:center">${escapeHtml(c.text)}</p>`,
      { bg: ctx.theme.accent, padding: `10px ${PAD}px` }
    ),
  product_feature: (c, ctx) => {
    const p = c.product
    const half = Math.floor((INNER - GAP) / 2)
    const text = `${c.headline ? heading(c.headline, ctx, 24, 'left') : ''}<p style="margin:0 0 6px;${bodyText(ctx, 18)};font-weight:700">${escapeHtml(p.title)}</p>${priceLine(p, ctx, 17)}${c.body ? `<div style="margin-top:14px">${paragraphs(c.body, bodyText(ctx, 15))}</div>` : '<div style="height:14px"></div>'}${button(c.cta, ctx, undefined, 'left')}`
    return row(
      'product_feature',
      columns(
        [linked(p.url, image(p.image, half, 'border-radius:4px')), text],
        INNER,
        true
      ).html
    )
  },
  product_grid_2: (c, ctx) => grid('product_grid_2', c, 2, ctx),
  product_grid_3: (c, ctx) => grid('product_grid_3', c, 3, ctx),
  category_tiles: (c, ctx) => {
    const rows = chunk(c.tiles, 2)
      .map((pair, i) => {
        const { html } = columns(
          pair.map((tile) =>
            linked(
              tile.url,
              `${image(tile.image, Math.floor((INNER - GAP) / 2), 'border-radius:4px')}<p style="margin:10px 0 0;${bodyText(ctx, 15)};font-weight:700;text-align:center;color:${ctx.theme.ink}">${escapeHtml(tile.label)}</p>`
            )
          ),
          INNER,
          false
        )
        return `<div style="${i ? 'margin-top:18px' : ''}">${html}</div>`
      })
      .join('')
    return row(
      'category_tiles',
      `${c.headline ? heading(c.headline, ctx) : ''}${rows}`
    )
  },
  image_text: (c, ctx) => {
    const half = Math.floor((INNER - GAP) / 2)
    const photo = image(c.image, half, 'border-radius:4px')
    const text = `${heading(c.headline, ctx, 24, 'left')}${paragraphs(c.body, bodyText(ctx, 15))}${c.cta ? button(c.cta, ctx, undefined, 'left') : ''}`
    const cells = c.imageSide === 'right' ? [text, photo] : [photo, text]
    return row('image_text', columns(cells, INNER, true).html)
  },
  text: (c, ctx) =>
    row(
      'text',
      `${c.headline ? heading(c.headline, ctx, 24, 'left') : ''}${paragraphs(c.body, bodyText(ctx))}`
    ),
  founder_note: (c, ctx) => {
    const photo = c.photo
      ? `<div style="margin:0 auto 16px;width:96px">${image(c.photo, 96, 'border-radius:48px')}</div>`
      : ''
    return row(
      'founder_note',
      `${photo}${c.greeting ? `<p style="margin:0 0 14px;${bodyText(ctx, 17)};font-weight:700">${escapeHtml(c.greeting)}</p>` : ''}${paragraphs(c.body, bodyText(ctx))}<p style="margin:6px 0 0;${bodyText(ctx, 17)};font-style:italic">${escapeHtml(c.signoff)}</p>${c.role ? `<p style="margin:2px 0 0;${bodyText(ctx, 13)};color:${ctx.theme.muted}">${escapeHtml(c.role)}</p>` : ''}`,
      { padding: `32px ${PAD + 16}px` }
    )
  },
  review_strip: (c, ctx) => {
    const cells = c.reviews.map(
      (r) =>
        `<div style="text-align:center">${stars(r.rating, ctx)}<p style="margin:10px 0 8px;${bodyText(ctx, 15)};font-style:italic">“${escapeHtml(r.quote)}”</p><p style="margin:0;${bodyText(ctx, 13)};font-weight:700">${escapeHtml(r.author)}</p></div>`
    )
    return row(
      'review_strip',
      `${c.headline ? heading(c.headline, ctx) : ''}${columns(cells, INNER, true).html}`
    )
  },
  ugc_grid: (c, ctx) => {
    const size = Math.floor((INNER - GAP * 2) / 3)
    const rows = chunk(c.photos, 3)
      .map(
        (three, i) =>
          `<div style="${i ? 'margin-top:12px' : ''}">${
            columns(
              three.map((p) => image(p, size, 'border-radius:4px')),
              INNER,
              false
            ).html
          }</div>`
      )
      .join('')
    return row(
      'ugc_grid',
      `${c.headline ? heading(c.headline, ctx) : ''}${rows}${c.caption ? `<p style="margin:14px 0 0;text-align:center;${bodyText(ctx, 14)};color:${ctx.theme.muted}">${escapeHtml(c.caption)}</p>` : ''}${c.cta ? `<div style="margin-top:18px">${button(c.cta, ctx)}</div>` : ''}`
    )
  },
  before_after: (c, ctx) => {
    const half = Math.floor((INNER - GAP) / 2)
    const side = (label: string, img: BlockImage) =>
      `<p style="margin:0 0 8px;${bodyText(ctx, 13)};font-weight:700;text-transform:uppercase;letter-spacing:1px;text-align:center">${escapeHtml(label)}</p>${image(img, half, 'border-radius:4px')}`
    return row(
      'before_after',
      `${columns([side(c.beforeLabel, c.before), side(c.afterLabel, c.after)], INNER, false).html}${c.caption ? `<p style="margin:14px 0 0;text-align:center;${bodyText(ctx, 14)};color:${ctx.theme.muted}">${escapeHtml(c.caption)}</p>` : ''}`
    )
  },
  benefits: (c, ctx) =>
    row(
      'benefits',
      `${c.headline ? heading(c.headline, ctx) : ''}${
        columns(
          c.items.map(
            (b) =>
              `<div style="text-align:center"><div style="margin:0 auto 10px;width:32px;height:4px;background:${ctx.theme.accent}"></div><p style="margin:0 0 6px;${bodyText(ctx, 16)};font-weight:700">${escapeHtml(b.title)}</p><p style="margin:0;${bodyText(ctx, 14)}">${escapeHtml(b.body)}</p></div>`
          ),
          INNER,
          true
        ).html
      }`
    ),
  how_it_works: (c, ctx) =>
    row(
      'how_it_works',
      `${c.headline ? heading(c.headline, ctx) : ''}${
        columns(
          c.steps.map(
            (s, i) =>
              `<div style="text-align:center"><p style="margin:0 auto 10px;width:36px;height:36px;border-radius:18px;background:${ctx.theme.accent};font-family:${ctx.theme.font};font-size:18px;line-height:36px;font-weight:700;color:${ctx.theme.onAccent};text-align:center">${i + 1}</p><p style="margin:0 0 6px;${bodyText(ctx, 16)};font-weight:700">${escapeHtml(s.title)}</p><p style="margin:0;${bodyText(ctx, 14)}">${escapeHtml(s.body)}</p></div>`
          ),
          INNER,
          true
        ).html
      }`
    ),
  comparison: (c, ctx) => {
    const t = ctx.theme
    const cell = (text: string, opts: { head?: boolean; first?: boolean }) =>
      `<td style="padding:10px 8px;border-bottom:1px solid ${t.line};font-family:${t.font};font-size:14px;line-height:20px;color:${opts.head ? t.headline : t.ink};font-weight:${opts.head || opts.first ? 700 : 400};text-align:${opts.first ? 'left' : 'center'}">${escapeHtml(text)}</td>`
    const head = `<tr>${cell('', { head: true, first: true })}${cell(c.usLabel, { head: true })}${cell(c.themLabel, { head: true })}</tr>`
    const rows = c.rows
      .map(
        (r) =>
          `<tr>${cell(r.feature, { first: true })}${cell(r.us, {})}${cell(r.them, {})}</tr>`
      )
      .join('')
    return row(
      'comparison',
      `${c.headline ? heading(c.headline, ctx) : ''}${table(head + rows)}`
    )
  },
  faq: (c, ctx) =>
    row(
      'faq',
      `${c.headline ? heading(c.headline, ctx, 24, 'left') : ''}${c.items
        .map(
          (q, i) =>
            `<div style="padding:14px 0;${i ? `border-top:1px solid ${ctx.theme.line}` : ''}"><p style="margin:0 0 6px;${bodyText(ctx, 16)};font-weight:700">${escapeHtml(q.question)}</p><p style="margin:0;${bodyText(ctx, 15)}">${escapeHtml(q.answer)}</p></div>`
        )
        .join('')}`
    ),
  cta: (c, ctx) =>
    row(
      'cta',
      `${c.headline ? heading(c.headline, ctx) : ''}${c.body ? `<p style="margin:0 0 20px;text-align:center;${bodyText(ctx)}">${escapeHtml(c.body)}</p>` : ''}${button(c.cta, ctx)}`
    ),
  footer: (c, ctx) => {
    const t = ctx.theme
    const f = footerLinks(ctx.mode, ctx.brand.name)
    const small = `font-family:${t.font};font-size:12px;line-height:18px;color:${t.muted}`
    const link = (href: string, label: string) =>
      `<a href="${href}" target="_blank" style="color:${t.muted};text-decoration:underline">${label}</a>`
    return row(
      'footer',
      `${c.note ? `<p style="margin:0 0 12px;text-align:center;${small}">${escapeHtml(c.note)}</p>` : ''}<p style="margin:0 0 8px;text-align:center;${small}">${link(f.webView, 'View in browser')} · ${link(f.unsubscribe, 'Unsubscribe')} · ${link(f.preferences, 'Manage preferences')}</p><p style="margin:0;text-align:center;${small}">${f.organization}<br>${f.address}</p>`,
      { padding: `28px ${PAD}px 36px` }
    )
  }
}

function grid(
  type: 'product_grid_2' | 'product_grid_3',
  c: BlockContent<'product_grid_2'>,
  per: 2 | 3,
  ctx: Ctx
) {
  const width = Math.floor((INNER - GAP * (per - 1)) / per)
  const rows = chunk(c.products, per)
    .map(
      (set, i) =>
        `<div style="${i ? 'margin-top:22px' : ''}">${
          columns(
            set.map((p) => productCard(p, width, ctx)),
            INNER,
            per === 3
          ).html
        }</div>`
    )
    .join('')
  return row(type, `${c.headline ? heading(c.headline, ctx) : ''}${rows}`)
}

/** One block's rows (`<tr data-block="…">`), for galleries and tests. */
export function renderBlock(
  block: Block,
  brand: BlockBrand,
  mode: RenderMode = 'preview'
) {
  const ctx: Ctx = { brand, mode, theme: themeOf(brand) }
  const render = renderers[block.type] as (c: unknown, x: Ctx) => string
  return render(block.content, ctx)
}

const mobileCss = (theme: Theme) =>
  `body{margin:0;padding:0;background:${theme.page}}img{-ms-interpolation-mode:bicubic}a{color:inherit}@media only screen and (max-width:620px){.gr-wrap{width:100%!important;max-width:100%!important}.gr-pad{padding-left:20px!important;padding-right:20px!important}.gr-col{display:block!important;width:100%!important;max-width:100%!important;padding-left:0!important;padding-right:0!important;padding-bottom:20px!important}.gr-col img{max-width:100%!important}.gr-h1{font-size:28px!important;line-height:34px!important}.gr-h2{font-size:22px!important;line-height:28px!important}}`

/**
 * A whole email: the blocks in order, always ending with exactly one
 * footer (Klaviyo's required links and address, VISION section 10).
 */
export function renderEmail(input: {
  blocks: readonly Block[]
  brand: BlockBrand
  subject?: string
  preheader?: string
  mode?: RenderMode
}) {
  const mode = input.mode ?? 'preview'
  const footer =
    input.blocks.find((b) => b.type === 'footer') ??
    ({ type: 'footer', content: {} } as Block)
  const body = [...input.blocks.filter((b) => b.type !== 'footer'), footer]
    .map((b) => renderBlock(b, input.brand, mode))
    .join('')
  return emailDocument(body, input.brand, input.subject, input.preheader)
}

/**
 * One block alone in the email frame, for the block gallery (BLK-002). It
 * is never sent, so it has no forced footer and always uses preview mode.
 */
export function blockPreviewDocument(block: Block, brand: BlockBrand) {
  return emailDocument(renderBlock(block, brand, 'preview'), brand)
}

function emailDocument(
  body: string,
  brand: BlockBrand,
  subject?: string,
  preheader?: string
) {
  const theme = themeOf(brand)
  const pre = preheader
    ? `<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all">${escapeHtml(preheader)}${'&#847;&zwnj;&nbsp;'.repeat(40)}</div>`
    : ''
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><meta name="color-scheme" content="light"><title>${escapeHtml(subject ?? brand.name)}</title><style>${mobileCss(theme)}</style></head><body style="margin:0;padding:0;background:${theme.page}">${pre}${table(`<tr><td align="center" style="padding:0">${table(body, ` class="gr-wrap" width="${EMAIL_WIDTH}" style="width:${EMAIL_WIDTH}px;max-width:${EMAIL_WIDTH}px;background:${theme.page}"`)}</td></tr>`, ` style="background:${theme.page}"`)}</body></html>`
}

/** Size in bytes as Gmail counts it (UTF-8). */
export function emailBytes(html: string) {
  return new TextEncoder().encode(html).length
}
