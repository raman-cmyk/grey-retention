import { parseFragment, type DefaultTreeAdapterTypes as T } from 'parse5'
import { z } from 'zod'
import { readCss } from './css'

/**
 * DST-001 (D25, AGENT_MAP §4 layer 3): a designed section. The Section
 * designer (DST-003) designs each section of a designed email freely in
 * HTML and CSS, at the email's 600 CSS px width; the renderer draws it in
 * a browser at twice that (1,200 px wide, shown at 600), and the email
 * carries the picture. Buttons, the product grid, key text and the footer
 * stay live HTML from block variants, outside the picture.
 *
 * A section is checked in code before it is drawn (`sectionProblems`): it
 * is a picture only, so it may run nothing, submit nothing and load
 * nothing but its own pictures and fonts, over https from the hosts it is
 * given. The markup is read with the same parser rules as the browser
 * (parse5: entities read, SVG as SVG), and only listed elements and
 * attributes may be used. It decides whether a section may be drawn; it
 * never cleans one (never use it to show a section anywhere else).
 */

export const designedSection = z.object({
  /** Its place in the email, e.g. "s2". */
  id: z.string(),
  /** The markup inside the 600 px frame (no `<style>`: that is `css`). */
  html: z.string(),
  /** Its styles. */
  css: z.string(),
  /** Its height in CSS px at 600 wide. */
  height: z.number(),
  /** Web fonts it uses (the brand's real fonts, pick #3). */
  fonts: z
    .array(
      z.object({
        family: z.string(),
        url: z.string(),
        weight: z.number().optional(),
        italic: z.boolean().optional()
      })
    )
    .max(20)
    .optional()
})
export type DesignedSection = z.infer<typeof designedSection>

export const sectionWidth = 600
export const minSectionHeight = 40
export const maxSectionHeight = 1600
export const maxSectionHtml = 60_000
export const maxSectionCss = 30_000
export const maxSectionFonts = 4
/**
 * DST-PIC #11 (owner pick): at most this many type sizes in one designed
 * section (a headline, a line under it and a small label), so its text has
 * one clear order.
 */
export const maxTypeSizes = 3
/**
 * DST-PIC #16 (owner pick, "Phone first"): a section is a picture 600 px
 * wide that a phone shows 375 px wide, so its text shrinks to 62.5%; text
 * under 14 px on a phone fails. The smallest size the picture may set (px
 * at 600), rounded up.
 */
export const phoneTextPx = 14
/** A phone's width, as the inbox preview draws it (DST-005b). */
export const phoneWidth = 375
/** On a phone, a size the picture sets (px at 600). */
export const onPhone = (px: number) => (px * phoneWidth) / sectionWidth
/** The round size the Section designer is told to stay at or above. */
export const minPictureTextPx = Math.ceil(
  (phoneTextPx * sectionWidth) / phoneWidth
)
/** Text given no size (the section's page sets it): 15 px on a phone. */
export const baseTextPx = 24

/** HTML elements a picture may use. */
const htmlElements = new Set(
  'div span p h1 h2 h3 h4 h5 h6 img br hr strong em b i u s small sup sub ul ol li figure figcaption blockquote section header footer article table thead tbody tfoot tr td th caption colgroup col svg'.split(
    ' '
  )
)
/** SVG elements a picture may use (no animation, no foreign content). */
const svgElements = new Set(
  'svg g path rect circle ellipse line polyline polygon defs lineargradient radialgradient stop clippath mask pattern filter fegaussianblur feturbulence fecolormatrix feblend feoffset femerge femergenode feflood fecomposite fedisplacementmap fedropshadow text tspan use image title desc symbol'.split(
    ' '
  )
)
/** Attributes a picture may use (SVG names lowercased). */
const attributes = new Set(
  'class id style alt title width height role aria-hidden aria-label lang dir src srcset sizes colspan rowspan align valign cellpadding cellspacing border viewbox d fill stroke stroke-width stroke-linecap stroke-linejoin stroke-dasharray stroke-opacity fill-opacity fill-rule clip-rule opacity transform x y x1 y1 x2 y2 cx cy r rx ry fx fy points offset stop-color stop-opacity gradientunits gradienttransform spreadmethod patternunits patterncontentunits patterntransform clip-path clippathunits mask maskunits maskcontentunits filter filterunits primitiveunits preserveaspectratio xmlns xmlns:xlink href xlink:href font-family font-size font-weight font-style text-anchor dominant-baseline letter-spacing basefrequency numoctaves seed stitchtiles stddeviation type values in in2 result mode operator k1 k2 k3 k4 scale xchannelselector ychannelselector dx dy flood-color flood-opacity color visibility display overflow version'.split(
    ' '
  )
)
/** CSS that loads, runs or breaks out of the style element. */
const badCss =
  /@import|@font-face|image-set\s*\(|\bsrc\s*\(|expression\s*\(|behavior\s*:|-moz-binding|<|\\/i
const inlineImage =
  /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/]+={0,2}$/i
const sameDocument = /^#[A-Za-z][\w-]{0,60}$/
const fontFamily = /^[A-Za-z0-9][A-Za-z0-9 -]{0,59}$/

/** An https link on one of `hosts` (no port), or a small inline picture. */
function allowedUrl(url: string, hosts: readonly string[]) {
  if (inlineImage.test(url)) return true
  try {
    const u = new URL(url)
    return (
      u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      u.port === '' &&
      hosts.includes(u.hostname.toLowerCase())
    )
  } catch {
    return false
  }
}

/** The links of a `srcset`, read as the HTML standard reads one. */
export function srcsetUrls(value: string) {
  const urls: string[] = []
  let i = 0
  while (i < value.length) {
    while (i < value.length && /[\s,]/.test(value[i])) i++
    let url = ''
    while (i < value.length && !/\s/.test(value[i])) url += value[i++]
    if (!url) break
    if (url.endsWith(',')) url = url.replace(/,+$/, '')
    else {
      // Its descriptors ("2x", "600w") run to the next comma.
      while (i < value.length && value[i] !== ',') i++
    }
    urls.push(url)
  }
  return urls
}

type Found = {
  problems: string[]
  urls: string[]
  /** The font sizes it sets, in px (DST-PIC #11). */
  sizes: Set<number>
  /** Those set in px on the picture (not in an SVG viewBox's units; DST-PIC #16). */
  styled: number[]
}

/**
 * DST-PIC #11: a font size in a designed section (a picture 600 px wide)
 * is written in px; any other way (a unit, a keyword, `calc()`, `inherit`)
 * is refused rather than guessed at, as the styles are.
 */
const pxSize = /^(\d+(?:\.\d+)?)px$/
const sizeWords = 'Write each font size in px, for example 48px'

/**
 * The px size in a `font` shorthand (`[style] [weight] <px>[/<line-height>]
 * <family>`), or null: none, or a function before it (`calc()`), is not read.
 */
function shorthandSize(value: string) {
  for (const part of value.trim().split(/\s+/)) {
    const n = /^(\d+(?:\.\d+)?)px(?:\/\S+)?$/.exec(part)
    if (n) return Number(n[1])
    if (/^0(?:\/\S+)?$/.test(part)) return 0
    if (part.includes('(')) return null
  }
  return null
}

function checkCss(
  css: string,
  where: string,
  hosts: readonly string[],
  f: Found,
  /** Its sizes are px on the picture (not in an SVG viewBox's units). */
  picturePx = true
) {
  if (badCss.test(css))
    f.problems.push(`The section’s ${where} load or run something.`)
  // DST-003a: styles read as the browser reads them (a `url(` inside a
  // string is not one), and only what draws no words. An attribute's value
  // (an SVG `url(#id)`) is read for its links only.
  const read = readCss(css, where !== 'styles')
  if (read.unread || where !== 'attributes') f.problems.push(...read.problems)
  for (const d of read.declarations) {
    if (d.property !== 'font-size' && d.property !== 'font') continue
    // A size of 0 closes the gaps between inline blocks: no text, no size.
    const px =
      d.property === 'font-size'
        ? d.value.trim() === '0'
          ? '0'
          : pxSize.exec(d.value.trim())?.[1]
        : shorthandSize(d.value)
    if (px === undefined || px === null)
      f.problems.push(
        `${sizeWords}: “${d.property}: ${d.value.trim().slice(0, 40)}” is not.`
      )
    else if (Number(px) > 0) {
      f.sizes.add(Number(px))
      if (picturePx) f.styled.push(Number(px))
    }
  }
  for (const url of read.urls)
    if (!sameDocument.test(url)) {
      f.urls.push(url)
      if (!allowedUrl(url, hosts))
        f.problems.push(
          `The section loads ${url.slice(0, 80)}, which is not one of its pictures.`
        )
    }
}

function checkUrl(url: string, hosts: readonly string[], f: Found) {
  f.urls.push(url)
  if (!allowedUrl(url, hosts))
    f.problems.push(
      `The section loads ${url.slice(0, 80)}, which is not one of its pictures.`
    )
}

function walk(
  node: T.ParentNode,
  hosts: readonly string[],
  f: Found,
  /** Inside an <svg> with a viewBox: its sizes are in the viewBox's units. */
  scaled = false
) {
  for (const child of node.childNodes) {
    if (child.nodeName === '#text' || child.nodeName === '#comment') continue
    if (!('tagName' in child)) continue
    const el = child as T.Element
    const tag = el.tagName.toLowerCase()
    const svg = el.namespaceURI === 'http://www.w3.org/2000/svg'
    const inScale =
      scaled ||
      (svg &&
        tag === 'svg' &&
        el.attrs.some((a) => a.name.toLowerCase() === 'viewbox'))
    const known = svg ? svgElements.has(tag) : htmlElements.has(tag)
    if (!known) {
      f.problems.push(
        `The section has a <${tag.slice(0, 30)}>, which a picture never needs.`
      )
      continue
    }
    for (const attr of el.attrs) {
      const name = (
        attr.prefix ? `${attr.prefix}:${attr.name}` : attr.name
      ).toLowerCase()
      const value = attr.value
      if (name.startsWith('on')) {
        f.problems.push('The section has an event handler.')
        continue
      }
      if (!attributes.has(name)) {
        f.problems.push(
          `The section uses the attribute ${name.slice(0, 40)}, which a picture never needs.`
        )
        continue
      }
      if (name === 'font-size' && svg) {
        // SVG text: a plain number is px.
        const n = /^(\d+(?:\.\d+)?)(?:px)?$/.exec(value.trim())
        if (n) {
          if (Number(n[1]) > 0) {
            f.sizes.add(Number(n[1]))
            if (!inScale) f.styled.push(Number(n[1]))
          }
        } else
          f.problems.push(
            `${sizeWords}: the SVG font-size “${value.trim().slice(0, 40)}” is not.`
          )
      }
      if (name === 'style')
        checkCss(value, 'inline styles', hosts, f, !(svg && inScale))
      else if (name === 'src') {
        if (tag === 'img') checkUrl(value.trim(), hosts, f)
        else f.problems.push(`A <${tag}> has no picture to load.`)
      } else if (name === 'srcset') {
        if (tag === 'img')
          for (const url of srcsetUrls(value)) checkUrl(url, hosts, f)
        else f.problems.push(`A <${tag}> has no picture to load.`)
      } else if (name === 'href' || name === 'xlink:href') {
        const url = value.trim()
        if (svg && tag === 'image') checkUrl(url, hosts, f)
        else if (!(svg && tag === 'use' && sameDocument.test(url)))
          f.problems.push(
            'A link in the section goes somewhere: only an SVG <use> may point inside it.'
          )
      } else if (/url\s*\(/i.test(value))
        checkCss(value, 'attributes', hosts, f)
    }
    walk(el, hosts, f, inScale)
  }
}

/**
 * What stops a section from being drawn, in plain words; empty means it
 * may be. `hosts` are the hostnames its pictures and fonts may come from.
 * Never throws: a section in the wrong shape gets its problem too.
 */
export function sectionProblems(
  input: unknown,
  hosts: readonly string[]
): string[] {
  const parsed = designedSection.safeParse(input)
  if (!parsed.success) return ['The section is not in the shape a section has.']
  const section = parsed.data
  const f: Found = { problems: [], urls: [], sizes: new Set(), styled: [] }
  if (!/^[a-z0-9-]{1,40}$/i.test(section.id))
    f.problems.push('The section has no usable name.')
  if (
    !Number.isInteger(section.height) ||
    section.height < minSectionHeight ||
    section.height > maxSectionHeight
  )
    f.problems.push(
      `A section is ${minSectionHeight} to ${maxSectionHeight} px tall.`
    )
  // Too long is refused before anything else is read.
  if (section.html.length > maxSectionHtml)
    f.problems.push('The section’s markup is too long.')
  if (section.css.length > maxSectionCss)
    f.problems.push('The section’s styles are too long.')
  if (f.problems.some((p) => p.endsWith('too long.'))) return f.problems
  checkCss(section.css, 'styles', hosts, f)
  walk(parseFragment(section.html), hosts, f)
  const small = [...new Set(f.styled)]
    .filter((px) => onPhone(px) < phoneTextPx)
    .sort((x, y) => y - x)
  if (small.length) {
    const words = (list: number[]) =>
      list
        .map((px) => `${Math.round(px * 10) / 10} px`)
        .join(list.length === 2 ? ' and ' : ', ')
    f.problems.push(
      `Text set at ${words(small)} shows at ${words(small.map(onPhone))} on a phone: set text at ${minPictureTextPx} px or more (${phoneTextPx} px on a phone).`
    )
  }
  if (f.sizes.size > maxTypeSizes)
    f.problems.push(
      `The section uses ${f.sizes.size} type sizes (${[...f.sizes]
        .sort((x, y) => y - x)
        .map((s) => `${s}px`)
        .join(
          ', '
        )}); use at most ${maxTypeSizes} (a headline, a line under it and a small label).`
    )
  const fonts = section.fonts ?? []
  if (fonts.length > maxSectionFonts)
    f.problems.push(`A section uses at most ${maxSectionFonts} web fonts.`)
  for (const font of fonts) {
    const name = font.family.slice(0, 60)
    if (!fontFamily.test(font.family))
      f.problems.push('A font has no usable name.')
    if (!allowedUrl(font.url, hosts) || inlineImage.test(font.url))
      f.problems.push(`The font ${name} is not on its hosts.`)
    if (
      font.weight !== undefined &&
      (!Number.isInteger(font.weight) || font.weight < 100 || font.weight > 900)
    )
      f.problems.push(`The font ${name} has no usable weight.`)
  }
  return [...new Set(f.problems)]
}

/**
 * Every link a section loads (its markup, styles and fonts), for the
 * renderer's list of origins. Same-document `#id` references are left out.
 */
export function sectionUrls(
  section: DesignedSection,
  hosts: readonly string[]
) {
  const f: Found = { problems: [], urls: [], sizes: new Set(), styled: [] }
  checkCss(section.css, 'styles', hosts, f)
  walk(parseFragment(section.html), hosts, f)
  return [...f.urls, ...(section.fonts ?? []).map((x) => x.url)]
}

/**
 * The whole page the renderer draws: the section in a 600 px frame of its
 * own height, its fonts first. Only call it for a section with no
 * problems (`sectionProblems`).
 */
export function sectionDocument(section: DesignedSection) {
  const faces = (section.fonts ?? [])
    .map(
      (font) =>
        `@font-face{font-family:"${font.family}";src:url("${new URL(font.url).href}");font-weight:${font.weight ?? 400};font-style:${font.italic ? 'italic' : 'normal'};font-display:block}`
    )
    .join('')
  return `<!doctype html><html><head><meta charset="utf-8"><style>${faces}html,body{margin:0;padding:0;background:#ffffff;font-size:${baseTextPx}px}li{list-style:none}:where(#gr-section) :where(h1,h2,h3,h4,h5,h6,small,big,sub,sup){font-size:inherit}#gr-section{position:relative;width:${sectionWidth}px;height:${section.height}px;overflow:hidden}${section.css}</style></head><body><div id="gr-section">${section.html}</div></body></html>`
}
