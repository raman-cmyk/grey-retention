/**
 * DST-001 (D25, AGENT_MAP §4 layer 3): a designed section. The Section
 * designer (DST-003) designs each section of a designed email freely in
 * HTML and CSS, at the email's 600 CSS px width; the renderer draws it in
 * a browser at twice that (1,200 px wide, shown at 600), and the email
 * carries the picture. Buttons, the product grid, key text and the footer
 * stay live HTML from block variants, outside the picture.
 *
 * A section is checked in code before it is drawn: it is a picture only,
 * so it may run nothing, submit nothing and load nothing but its own
 * pictures and fonts, over https from the hosts it is given.
 */

export type DesignedSection = {
  /** Its place in the email, e.g. "s2". */
  id: string
  /** The markup inside the 600 px frame (no `<style>`: that is `css`). */
  html: string
  /** Its styles. */
  css: string
  /** Its height in CSS px at 600 wide. */
  height: number
  /** Web fonts it uses (the brand's real fonts, pick #3). */
  fonts?: { family: string; url: string; weight?: number; italic?: boolean }[]
}

export const sectionWidth = 600
export const minSectionHeight = 40
export const maxSectionHeight = 1600
export const maxSectionHtml = 60_000
export const maxSectionCss = 30_000
export const maxSectionFonts = 4

/** Elements a picture never needs: they run, submit, load or escape. */
const refusedElements =
  /<\s*\/?\s*(?:script|iframe|frame|frameset|object|embed|applet|portal|form|input|textarea|select|button|link|meta|base|style|template|noscript|foreignobject)\b/i
/** An event handler attribute (onload=, onerror=, …). */
const handler = /<[^>]*\son[a-z]+\s*=/i
const badScheme =
  /(?:javascript|vbscript|livescript)\s*:|data\s*:\s*(?!image\/(?:png|jpeg|gif|webp);base64,)/i
/** CSS that loads, runs or breaks out of the style element. */
const badCss =
  /@import|image-set\s*\(|expression\s*\(|behavior\s*:|-moz-binding|<|\\/i
const inlineImage =
  /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/]+={0,2}$/i
const fontFamily = /^[A-Za-z0-9][A-Za-z0-9 -]{0,59}$/

/** Every link the markup and styles load or point to. */
export function sectionUrls(section: Pick<DesignedSection, 'html' | 'css'>) {
  const out: string[] = []
  const attr =
    /\s(src|href|xlink:href|poster|background|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi
  for (const m of section.html.matchAll(attr)) {
    const value = (m[2] ?? m[3] ?? m[4] ?? '').trim()
    // A srcset lists several links, each with its size, after ", ".
    const parts =
      m[1].toLowerCase() === 'srcset' ? value.split(/,\s+/) : [value]
    for (const part of parts)
      if (part.trim()) out.push(part.trim().split(/\s+/)[0])
  }
  const url = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi
  for (const text of [section.css, section.html])
    for (const m of text.matchAll(url))
      out.push((m[1] ?? m[2] ?? m[3] ?? '').trim())
  return out
}

/** An https link on one of `hosts`, or a small inline picture. */
function allowedUrl(url: string, hosts: readonly string[]) {
  if (inlineImage.test(url)) return true
  try {
    const u = new URL(url)
    return (
      u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      hosts.includes(u.hostname.toLowerCase())
    )
  } catch {
    return false
  }
}

/**
 * What stops a section from being drawn, in plain words; empty means it
 * may be. `hosts` are the hostnames its pictures and fonts may come from.
 */
export function sectionProblems(
  section: DesignedSection,
  hosts: readonly string[]
): string[] {
  const problems: string[] = []
  if (!/^[a-z0-9-]{1,40}$/i.test(section.id))
    problems.push('The section has no usable name.')
  if (
    !Number.isInteger(section.height) ||
    section.height < minSectionHeight ||
    section.height > maxSectionHeight
  )
    problems.push(
      `A section is ${minSectionHeight} to ${maxSectionHeight} px tall.`
    )
  if (section.html.length > maxSectionHtml)
    problems.push('The section’s markup is too long.')
  if (section.css.length > maxSectionCss)
    problems.push('The section’s styles are too long.')
  if (refusedElements.test(section.html))
    problems.push(
      'The section has an element a picture never needs (a script, a frame, a form, a link or a style).'
    )
  if (handler.test(section.html))
    problems.push('The section has an event handler.')
  if (badScheme.test(section.html) || badScheme.test(section.css))
    problems.push('The section has a link that would run something.')
  if (badCss.test(section.css))
    problems.push('The section’s styles load or run something.')
  for (const url of sectionUrls(section))
    if (!allowedUrl(url, hosts))
      problems.push(
        `The section loads ${url.slice(0, 80)}, which is not one of its pictures.`
      )
  const fonts = section.fonts ?? []
  if (fonts.length > maxSectionFonts)
    problems.push(`A section uses at most ${maxSectionFonts} web fonts.`)
  for (const f of fonts) {
    if (!fontFamily.test(f.family)) problems.push('A font has no usable name.')
    if (!allowedUrl(f.url, hosts) || inlineImage.test(f.url))
      problems.push(`The font ${f.family.slice(0, 60)} is not on its hosts.`)
    if (
      f.weight !== undefined &&
      (!Number.isInteger(f.weight) || f.weight < 100 || f.weight > 900)
    )
      problems.push(`The font ${f.family.slice(0, 60)} has no usable weight.`)
  }
  return [...new Set(problems)]
}

/**
 * The whole page the renderer draws: the section in a 600 px frame of its
 * own height, its fonts first. Only call it for a section with no
 * problems (`sectionProblems`).
 */
export function sectionDocument(section: DesignedSection) {
  const faces = (section.fonts ?? [])
    .map(
      (f) =>
        `@font-face{font-family:"${f.family}";src:url("${new URL(f.url).href}");font-weight:${f.weight ?? 400};font-style:${f.italic ? 'italic' : 'normal'};font-display:block}`
    )
    .join('')
  return `<!doctype html><html><head><meta charset="utf-8"><style>${faces}html,body{margin:0;padding:0;background:transparent}#gr-section{position:relative;width:${sectionWidth}px;height:${section.height}px;overflow:hidden}${section.css}</style></head><body><div id="gr-section">${section.html}</div></body></html>`
}
