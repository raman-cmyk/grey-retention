import {
  parseBlock,
  type Block,
  type BlockContent,
  type BlockPhoto,
  type BlockProduct,
  type BlockType
} from './catalog'
import {
  type BlockBrand,
  fontStack,
  inkOn,
  readableOn,
  safeColor,
  safeRadius
} from './brand'
import { footerHtml } from './klaviyo-tags'

/**
 * Email-safe HTML for the block library (BLK-001), built like the Step 0
 * reference renderer (docs/step0/render.py): nested tables, inline styles,
 * `bgcolor` attributes for Outlook, a white 600px container on the brand
 * background, one column under 620px, the brand font with a web-safe
 * fallback, no script, form, web font or external stylesheet, and all text
 * as live HTML. All text is escaped, including `{` and `}`, so copy can
 * never become a Klaviyo template tag. Every block is checked against its
 * schema again here, so stored content can never skip validation.
 *
 * `klaviyo` mode writes Klaviyo's footer tags and accepts only https
 * pictures (uploaded to Klaviyo first); `preview` mode writes labelled
 * placeholders and also accepts inline sample pictures.
 */
export type RenderMode = 'klaviyo' | 'preview'

export const EMAIL_WIDTH = 600
/** Gmail clips a message above about 102 KB (VISION.md Step 4 QA). */
export const GMAIL_CLIP_BYTES = 102 * 1024
const PAD = 32
const INNER = EMAIL_WIDTH - PAD * 2
const GAP = 16
const WHITE = '#ffffff'

export class BlockRenderError extends Error {}

type Theme = {
  font: string
  radius: string
  page: string
  ink: string
  muted: string
  accent: string
  onAccent: string
  /** The accent as small text on white, darkened when too faint. */
  accentText: string
  dark: string
  onDark: string
}

type Ctx = {
  brand: BlockBrand
  mode: RenderMode
  theme: Theme
  /** The first big headline in an email is its h1; later ones are h2. */
  headlines: number
}

export function themeOf(brand: BlockBrand): Theme {
  const accent = safeColor(brand.accent, '#1a1a1a')
  const dark = safeColor(brand.dark, '#1a1a1a')
  return {
    font: fontStack(brand.font),
    radius: safeRadius(brand.radius),
    page: safeColor(brand.background, '#fafafa'),
    ink: readableOn(safeColor(brand.ink, '#121212'), WHITE),
    muted: '#555555',
    accent,
    onAccent: inkOn(accent),
    accentText: readableOn(accent, WHITE),
    dark,
    onDark: inkOn(dark)
  }
}

const invisible = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/g

/** Escapes text for HTML and for Klaviyo's template language. */
export function escapeHtml(text: string) {
  return text
    .replace(invisible, '')
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
    if (u.username || u.password) return '#'
    return escapeHtml(u.toString())
  } catch {
    return '#'
  }
}

const imageData =
  /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/]+={0,2}$/i

/**
 * A picture source. Klaviyo mode needs https (VISION rule 11: pictures
 * are uploaded to Klaviyo first); preview mode also takes inline samples.
 */
export function safeImageUrl(url: string, mode: RenderMode = 'preview') {
  const v = url.trim()
  if (imageData.test(v)) {
    if (mode === 'klaviyo')
      throw new BlockRenderError(
        'Upload every picture to Klaviyo before it goes into an email.'
      )
    return v
  }
  try {
    const u = new URL(v)
    if (u.protocol !== 'https:' || u.username || u.password) return null
    return escapeHtml(u.toString())
  } catch {
    return null
  }
}

const table = (inner: string, attrs = '') =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"${attrs}>${inner}</table>`

const bodyText = (ctx: Ctx, size = 16) =>
  `font-family:${ctx.theme.font};font-size:${size}px;line-height:1.5;color:${ctx.theme.ink}`

function paragraphs(
  paras: readonly string[],
  ctx: Ctx,
  align = 'center',
  size = 16
) {
  return paras
    .map(
      (p) =>
        `<p style="margin:0 0 14px;${bodyText(ctx, size)};text-align:${align}">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`
    )
    .join('')
}

function heading(text: string, ctx: Ctx, align = 'center') {
  return `<h2 class="gr-h2" style="margin:0 0 14px;font-family:${ctx.theme.font};font-size:22px;line-height:1.25;font-weight:700;color:${ctx.theme.ink};text-align:${align}">${escapeHtml(text)}</h2>`
}

/** The email's main message: the first one is its h1. */
function headline(text: string, ctx: Ctx, color: string, size = 32) {
  const tag = ctx.headlines++ === 0 ? 'h1' : 'h2'
  return `<${tag} class="gr-h1" style="margin:0 0 12px;font-family:${ctx.theme.font};font-size:${size}px;line-height:1.15;font-weight:700;color:${color};text-align:center">${escapeHtml(text)}</${tag}>`
}

/**
 * A button that holds up in Outlook: the colour and padding sit on the
 * cell (Outlook ignores padding on links), the link fills it elsewhere.
 */
function button(
  label: string,
  url: string,
  ctx: Ctx,
  colors = { bg: ctx.theme.accent, fg: ctx.theme.onAccent },
  align: 'center' | 'left' = 'center'
) {
  const t = ctx.theme
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${align}" style="margin:${align === 'center' ? '0 auto' : '0'}"><tr><td bgcolor="${colors.bg}" align="center" style="border-radius:${t.radius};background:${colors.bg};padding:14px 32px"><a href="${safeUrl(url)}" target="_blank" style="display:inline-block;font-family:${t.font};font-size:16px;line-height:20px;font-weight:700;color:${colors.fg};text-decoration:none">${escapeHtml(label)}</a></td></tr></table>`
}

function image(src: string, alt: string, width: number, ctx: Ctx, style = '') {
  const url = safeImageUrl(src, ctx.mode)
  if (!url) return ''
  return `<img src="${url}" alt="${escapeHtml(alt)}" width="${width}" style="display:block;width:100%;max-width:${width}px;height:auto;border:0;outline:none;text-decoration:none;margin:0 auto;${style}">`
}

const linked = (url: string, inner: string) =>
  `<a href="${safeUrl(url)}" target="_blank" style="text-decoration:none">${inner}</a>`

/**
 * Side-by-side cells. `stack` cells become full width on a phone; others
 * stay side by side (small photos and 2-up grids read fine at 375px).
 */
function columns(cells: string[], width: number, stack: boolean, attrs = '') {
  const n = cells.length
  const cell = Math.floor((width - GAP * (n - 1)) / n)
  const tds = cells
    .map((c, i) => {
      const pad = `padding-left:${i === 0 ? 0 : GAP / 2}px;padding-right:${i === n - 1 ? 0 : GAP / 2}px`
      return `<td class="${stack ? 'gr-col' : 'gr-keep'}" dir="ltr" width="${cell}" valign="top" style="width:${cell}px;${pad}">${c}</td>`
    })
    .join('')
  return { html: table(`<tr>${tds}</tr>`, attrs), cell }
}

function chunk<T>(list: readonly T[], size: number) {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

function row(
  type: BlockType,
  inner: string,
  opts: { padding?: string; bg?: string; pad?: boolean } = {}
) {
  const padding = opts.padding ?? `28px ${PAD}px`
  const bg = opts.bg ? ` bgcolor="${opts.bg}"` : ''
  const cls = opts.pad === false ? '' : ' class="gr-pad"'
  return `<tr data-block="${type}"><td${cls}${bg} style="padding:${padding};${opts.bg ? `background:${opts.bg};` : ''}">${inner}</td></tr>`
}

function priceLine(p: BlockProduct, ctx: Ctx, size = 15) {
  const was = p.compareAt
    ? ` <span style="color:${ctx.theme.muted};text-decoration:line-through;font-weight:400">${escapeHtml(p.compareAt)}</span>`
    : ''
  return `<p style="margin:0;${bodyText(ctx, size)};font-weight:700">${escapeHtml(p.price)}${was}</p>`
}

function productCard(p: BlockProduct, width: number, ctx: Ctx) {
  return `<div style="text-align:center">${linked(p.url, image(p.image, p.alt ?? p.title, width, ctx, `border-radius:${ctx.theme.radius}`))}<p style="margin:10px 0 4px;${bodyText(ctx, 15)};font-weight:700">${escapeHtml(p.title)}</p>${priceLine(p, ctx, 14)}<p style="margin:10px 0 0"><a href="${safeUrl(p.url)}" target="_blank" style="font-family:${ctx.theme.font};font-size:14px;font-weight:700;color:${ctx.theme.accentText};text-decoration:none">Shop now &rarr;</a></p></div>`
}

function stars(rating: number, ctx: Ctx) {
  const n = Math.min(5, Math.max(1, Math.round(Number(rating) || 1)))
  return `<span role="img" aria-label="${n} out of 5 stars" style="color:${ctx.theme.accentText};font-size:18px;letter-spacing:2px">${'★'.repeat(n)}${'☆'.repeat(5 - n)}</span>`
}

function grid(
  type: 'product_grid_2col' | 'product_grid_3col',
  c: BlockContent<'product_grid_2col'>,
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
  return row(type, `${c.heading ? heading(c.heading, ctx) : ''}${rows}`)
}

const caption = (text: string | undefined, ctx: Ctx) =>
  text
    ? `<p style="margin:14px 0 0;text-align:center;${bodyText(ctx, 14)};color:${ctx.theme.muted}">${escapeHtml(text)}</p>`
    : ''

type Renderers = {
  [T in BlockType]: (content: BlockContent<T>, ctx: Ctx) => string
}

const renderers: Renderers = {
  announcement_bar: (c, ctx) =>
    row(
      'announcement_bar',
      `<p style="margin:0;font-family:${ctx.theme.font};font-size:13px;line-height:1.4;letter-spacing:0.08em;text-transform:uppercase;font-weight:700;color:${ctx.theme.onDark};text-align:center">${escapeHtml(c.text)}</p>`,
      { bg: ctx.theme.dark, padding: '10px 16px' }
    ),
  header_logo: (_c, ctx) => {
    const { brand, theme } = ctx
    const logo = brand.logo ? safeImageUrl(brand.logo, ctx.mode) : null
    const mark = logo
      ? `<img src="${logo}" alt="${escapeHtml(brand.name)}" width="160" style="display:inline-block;width:160px;max-width:60%;height:auto;border:0">`
      : `<span style="font-family:${theme.font};font-size:24px;line-height:30px;font-weight:700;letter-spacing:1px;color:${theme.ink}">${escapeHtml(brand.name)}</span>`
    return row(
      'header_logo',
      `<div style="text-align:center">${brand.site ? linked(brand.site, mark) : mark}</div>`,
      { padding: '24px 16px 16px' }
    )
  },
  hero_product: (c, ctx) => {
    const t = ctx.theme
    const panel = safeColor(c.panel, t.page)
    const ink = readableOn(t.ink, panel)
    return (
      row(
        'hero_product',
        `${c.eyebrow ? `<p style="margin:0 0 8px;font-family:${t.font};font-size:13px;letter-spacing:0.12em;text-transform:uppercase;font-weight:700;color:${readableOn(t.accent, panel)};text-align:center">${escapeHtml(c.eyebrow)}</p>` : ''}${headline(c.headline, ctx, ink)}${c.sub ? `<p style="margin:0 0 20px;font-family:${t.font};font-size:16px;line-height:1.5;color:${ink};text-align:center">${escapeHtml(c.sub)}</p>` : ''}${linked(c.url, image(c.image, c.alt ?? c.headline, 420, ctx, `border-radius:${t.radius}`))}`,
        { bg: panel, padding: '32px 24px 8px' }
      ) +
      row('hero_product', button(c.cta, c.url, ctx), {
        bg: panel,
        padding: '20px 24px 32px'
      })
    )
  },
  hero_image: (c, ctx) =>
    row('hero_image', linked(c.url, image(c.image, c.alt, EMAIL_WIDTH, ctx)), {
      padding: '0',
      pad: false
    }) +
    row(
      'hero_image',
      `${headline(c.headline, ctx, ctx.theme.ink)}${c.sub ? `<p style="margin:0 0 22px;text-align:center;${bodyText(ctx, 17)}">${escapeHtml(c.sub)}</p>` : ''}${button(c.cta, c.url, ctx)}`
    ),
  offer_banner: (c, ctx) => {
    const t = ctx.theme
    const code = c.code
      ? `<p style="margin:0 0 6px;font-family:${t.font};font-size:14px;line-height:20px;color:${t.onAccent};text-align:center">Use code</p><p style="margin:0 0 14px;text-align:center"><span class="gr-code" style="display:inline-block;max-width:100%;padding:8px 18px;border:2px dashed ${t.onAccent};font-family:${t.font};font-size:22px;line-height:28px;font-weight:700;letter-spacing:2px;color:${t.onAccent};word-break:break-all">${escapeHtml(c.code)}</span></p>`
      : ''
    return row(
      'offer_banner',
      `${headline(c.headline, ctx, t.onAccent, 34)}${c.detail ? `<p style="margin:0 0 16px;font-family:${t.font};font-size:16px;line-height:1.5;color:${t.onAccent};text-align:center">${escapeHtml(c.detail)}</p>` : ''}${code}${c.expiry ? `<p style="margin:0 0 18px;font-family:${t.font};font-size:13px;line-height:18px;color:${t.onAccent};text-align:center">${escapeHtml(c.expiry)}</p>` : ''}${button(c.cta, c.url, ctx, { bg: t.onAccent, fg: t.onAccent === WHITE ? t.accent : WHITE })}`,
      { bg: t.accent, padding: `36px ${PAD}px` }
    )
  },
  text: (c, ctx) =>
    row(
      'text',
      `${c.heading ? heading(c.heading, ctx, c.align) : ''}${paragraphs(c.paras, ctx, c.align)}`
    ),
  steps: (c, ctx) => {
    const t = ctx.theme
    const rows = c.items
      .map(
        ([title, body], i) =>
          `<tr><td width="44" valign="top" style="padding:0 12px 14px 0"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="32" height="32" bgcolor="${t.accent}" align="center" style="width:32px;height:32px;border-radius:16px;background:${t.accent};font-family:${t.font};font-size:16px;line-height:32px;font-weight:700;color:${t.onAccent}">${i + 1}</td></tr></table></td><td valign="top" style="padding:4px 0 14px;${bodyText(ctx)}"><strong>${escapeHtml(title)}</strong> ${escapeHtml(body)}</td></tr>`
      )
      .join('')
    return row(
      'steps',
      `${c.heading ? heading(c.heading, ctx) : ''}${table(rows)}`,
      { padding: `28px ${PAD + 8}px 14px` }
    )
  },
  product_feature: (c, ctx) => {
    const p = c.product
    const half = Math.floor((INNER - GAP) / 2)
    const text = `${c.heading ? heading(c.heading, ctx, 'left') : ''}<p style="margin:0 0 6px;${bodyText(ctx, 18)};font-weight:700">${escapeHtml(p.title)}</p>${priceLine(p, ctx, 17)}${c.body ? `<div style="margin-top:14px">${paragraphs([c.body], ctx, 'left', 15)}</div>` : '<div style="height:14px;line-height:14px">&nbsp;</div>'}${button(c.cta, p.url, ctx, undefined, 'left')}`
    return row(
      'product_feature',
      columns(
        [
          linked(
            p.url,
            image(
              p.image,
              p.alt ?? p.title,
              half,
              ctx,
              `border-radius:${ctx.theme.radius}`
            )
          ),
          text
        ],
        INNER,
        true
      ).html
    )
  },
  product_grid_2col: (c, ctx) => grid('product_grid_2col', c, 2, ctx),
  product_grid_3col: (c, ctx) => grid('product_grid_3col', c, 3, ctx),
  category_tiles: (c, ctx) => {
    const half = Math.floor((INNER - GAP) / 2)
    const rows = chunk(c.tiles, 2)
      .map(
        (two, i) =>
          `<div style="${i ? 'margin-top:18px' : ''}">${
            columns(
              two.map((tile) =>
                linked(
                  tile.url,
                  `${image(tile.image, tile.alt, half, ctx, `border-radius:${ctx.theme.radius}`)}<p style="margin:10px 0 0;${bodyText(ctx, 15)};font-weight:700;text-align:center">${escapeHtml(tile.label)}</p>`
                )
              ),
              INNER,
              false
            ).html
          }</div>`
      )
      .join('')
    return row(
      'category_tiles',
      `${c.heading ? heading(c.heading, ctx) : ''}${rows}`
    )
  },
  image_text: (c, ctx) => {
    const half = Math.floor((INNER - GAP) / 2)
    const photo = image(
      c.image,
      c.alt,
      half,
      ctx,
      `border-radius:${ctx.theme.radius}`
    )
    const text = `${heading(c.heading, ctx, 'left')}${paragraphs(c.paras, ctx, 'left', 15)}${c.cta && c.url ? button(c.cta, c.url, ctx, undefined, 'left') : ''}`
    // The photo is always first in the source, so it comes first on a
    // phone; right-to-left order puts it on the right on a computer.
    return row(
      'image_text',
      columns(
        [photo, text],
        INNER,
        true,
        c.imageSide === 'right' ? ' dir="rtl"' : ''
      ).html
    )
  },
  founder_note: (c, ctx) => {
    const photo = c.photo
      ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 16px"><tr><td width="96">${image(c.photo.image, c.photo.alt, 96, ctx, 'border-radius:48px')}</td></tr></table>`
      : ''
    return row(
      'founder_note',
      `${photo}${c.greeting ? `<p style="margin:0 0 14px;${bodyText(ctx, 17)};font-weight:700;text-align:left">${escapeHtml(c.greeting)}</p>` : ''}${paragraphs(c.paras, ctx, 'left')}<p style="margin:6px 0 0;${bodyText(ctx, 17)};font-style:italic">${escapeHtml(c.signoff)}</p>${c.role ? `<p style="margin:2px 0 0;${bodyText(ctx, 13)};color:${ctx.theme.muted}">${escapeHtml(c.role)}</p>` : ''}`,
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
      `${c.heading ? heading(c.heading, ctx) : ''}${columns(cells, INNER, true).html}`
    )
  },
  ugc_grid: (c, ctx) => {
    const size = Math.floor((INNER - GAP * 2) / 3)
    const rows = chunk(c.photos, 3)
      .map(
        (three, i) =>
          `<div style="${i ? 'margin-top:12px' : ''}">${
            columns(
              three.map((p) =>
                image(
                  p.image,
                  p.alt,
                  size,
                  ctx,
                  `border-radius:${ctx.theme.radius}`
                )
              ),
              INNER,
              false
            ).html
          }</div>`
      )
      .join('')
    return row(
      'ugc_grid',
      `${c.heading ? heading(c.heading, ctx) : ''}${rows}${caption(c.caption, ctx)}${c.cta && c.url ? `<div style="margin-top:18px">${button(c.cta, c.url, ctx)}</div>` : ''}`
    )
  },
  before_after: (c, ctx) => {
    const half = Math.floor((INNER - GAP) / 2)
    const side = (label: string, p: BlockPhoto) =>
      `<p style="margin:0 0 8px;${bodyText(ctx, 13)};font-weight:700;text-transform:uppercase;letter-spacing:1px;text-align:center">${escapeHtml(label)}</p>${image(p.image, p.alt, half, ctx, `border-radius:${ctx.theme.radius}`)}`
    return row(
      'before_after',
      `${columns([side(c.beforeLabel, c.before), side(c.afterLabel, c.after)], INNER, false).html}${caption(c.caption, ctx)}`
    )
  },
  faq: (c, ctx) =>
    row(
      'faq',
      `${heading(c.heading ?? 'Questions', ctx)}${c.items
        .map(
          ([q, a]) =>
            `<p style="margin:0 0 14px;${bodyText(ctx)};text-align:left"><strong>${escapeHtml(q)}</strong><br>${escapeHtml(a)}</p>`
        )
        .join('')}`,
      { padding: `28px ${PAD + 8}px 14px` }
    ),
  cta: (c, ctx) =>
    row('cta', button(c.label, c.url, ctx), { padding: '16px 24px 32px' }),
  signoff: (c, ctx) =>
    row('signoff', paragraphs([c.text], ctx), {
      padding: `8px ${PAD}px 32px`
    }),
  footer: (c, ctx) => {
    const small = `font-family:${ctx.theme.font};font-size:12px;line-height:1.6;color:#555555;text-align:center`
    return row(
      'footer',
      `${c.note ? `<p style="margin:0 0 12px;${small}">${escapeHtml(c.note)}</p>` : ''}<p style="margin:0;${small}">${footerHtml(ctx.mode, ctx.brand.name)}</p>`,
      { bg: '#f3f3f3', padding: '24px 24px 32px' }
    )
  }
}

/** One block's rows (`<tr data-block="…">`), checked against its schema. */
export function renderBlock(
  block: Block,
  brand: BlockBrand,
  mode: RenderMode = 'preview',
  ctx?: Ctx
) {
  const parsed = parseBlock(block.type, block.content)
  if (!parsed.ok) throw new BlockRenderError(parsed.error)
  const context = ctx ?? { brand, mode, theme: themeOf(brand), headlines: 0 }
  const render = renderers[parsed.block.type] as (c: unknown, x: Ctx) => string
  return render(parsed.block.content, context)
}

const mobileCss = (theme: Theme) =>
  `body{margin:0;padding:0;background:${theme.page}}img{-ms-interpolation-mode:bicubic}@media only screen and (max-width:620px){.gr-wrap{width:100%!important;max-width:100%!important}.gr-pad{padding-left:20px!important;padding-right:20px!important}.gr-col{display:block!important;width:100%!important;max-width:100%!important;padding-left:0!important;padding-right:0!important;padding-bottom:20px!important}.gr-col img{max-width:100%!important}.gr-h1{font-size:28px!important}.gr-h2{font-size:20px!important}.gr-code{font-size:18px!important;letter-spacing:1px!important}}`

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
  const ctx: Ctx = {
    brand: input.brand,
    mode,
    theme: themeOf(input.brand),
    headlines: 0
  }
  const footer =
    input.blocks.find((b) => b.type === 'footer') ??
    ({ type: 'footer', content: {} } as Block)
  const body = [...input.blocks.filter((b) => b.type !== 'footer'), footer]
    .map((b) => renderBlock(b, input.brand, mode, ctx))
    .join('')
  return emailDocument(
    body,
    ctx.theme,
    input.brand,
    input.subject,
    input.preheader
  )
}

/**
 * One block alone in the email frame, for the block gallery (BLK-002). It
 * is never sent, so it has no forced footer and always uses preview mode.
 */
export function blockPreviewDocument(block: Block, brand: BlockBrand) {
  return emailDocument(
    renderBlock(block, brand, 'preview'),
    themeOf(brand),
    brand
  )
}

function emailDocument(
  body: string,
  theme: Theme,
  brand: BlockBrand,
  subject?: string,
  preheader?: string
) {
  const pre = preheader
    ? `<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all">${escapeHtml(preheader)}${'&#847;&zwnj;&nbsp;'.repeat(40)}</div>`
    : ''
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><meta name="color-scheme" content="light"><title>${escapeHtml(subject ?? brand.name)}</title><style>${mobileCss(theme)}</style></head><body style="margin:0;padding:0;background:${theme.page}">${pre}${table(`<tr><td align="center" style="padding:0">${table(body, ` class="gr-wrap" width="${EMAIL_WIDTH}" bgcolor="${WHITE}" style="width:${EMAIL_WIDTH}px;max-width:${EMAIL_WIDTH}px;background:${WHITE}"`)}</td></tr>`, ` bgcolor="${theme.page}" style="background:${theme.page}"`)}</body></html>`
}

/** Size in bytes as Gmail counts it (UTF-8). */
export function emailBytes(html: string) {
  return new TextEncoder().encode(html).length
}
