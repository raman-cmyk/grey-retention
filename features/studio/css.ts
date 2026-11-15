/**
 * DST-003a: the styles of a designed section, read the way a browser
 * reads them (CSS Syntax): strings and `url(...)` first, so a `url(` or a
 * `}` inside a string is never taken for one, then rules and declarations
 * by their braces and semicolons, also after a nested rule. A section is a
 * picture, so only the properties and functions a picture needs may be
 * used, and only values that cannot draw words: no `content` but an empty
 * one, no list markers, counters, `attr()`, custom properties or strings
 * outside font names (DST-003, the Section designer).
 *
 * The reader refuses what it cannot read for sure (a comment, an escape,
 * an at-rule, an unclosed string, bracket or block) rather than guess.
 */

export type CssDeclaration = { property: string; value: string }
export type ReadCss = {
  declarations: CssDeclaration[]
  /** Every link in a `url(...)`, in order. */
  urls: string[]
  problems: string[]
  /** True when the styles could not be read for sure (then `urls` may be short). */
  unread: boolean
}

/** Properties a designed section may use. */
const properties = new Set(
  `position top right bottom left inset z-index display box-sizing float clear
  width height min-width min-height max-width max-height aspect-ratio
  margin margin-top margin-right margin-bottom margin-left
  padding padding-top padding-right padding-bottom padding-left
  overflow overflow-x overflow-y
  flex flex-direction flex-wrap flex-flow flex-grow flex-shrink flex-basis order
  align-items align-content align-self justify-content justify-items justify-self
  place-items place-content place-self gap row-gap column-gap
  grid-template-columns grid-template-rows grid-auto-flow grid-auto-columns grid-auto-rows
  grid-column grid-row grid-column-start grid-column-end grid-row-start grid-row-end
  background background-color background-image background-position background-size
  background-repeat background-clip background-origin background-blend-mode
  border border-top border-right border-bottom border-left border-width border-style border-color
  border-radius border-top-left-radius border-top-right-radius
  border-bottom-left-radius border-bottom-right-radius
  outline outline-offset box-shadow opacity filter backdrop-filter mix-blend-mode isolation
  transform transform-origin rotate scale translate clip-path object-fit object-position
  color font font-family font-size font-weight font-style font-stretch
  font-variation-settings font-feature-settings line-height letter-spacing word-spacing
  text-align text-transform text-decoration text-decoration-color text-decoration-thickness
  text-underline-offset text-shadow text-wrap white-space vertical-align
  fill fill-opacity stroke stroke-width stroke-opacity stop-color stop-opacity content
  list-style list-style-type`.split(/\s+/)
)
/** Properties whose value may hold a string: font names and font tags. */
const stringProperties = new Set([
  'font',
  'font-family',
  'font-variation-settings',
  'font-feature-settings'
])
/** `content` draws nothing only as one of these (decoration on ::before). */
const emptyContent = new Set(['""', "''", 'none', 'normal'])
/** `display` values (no `list-item`: it draws a number or marker). */
const displays = new Set(
  'block inline inline-block flex inline-flex grid inline-grid flow-root contents table inline-table table-row table-cell table-row-group table-header-group table-footer-group table-column table-column-group table-caption'.split(
    ' '
  )
)
/** Functions a value may call. */
const functions = new Set(
  `url linear-gradient radial-gradient conic-gradient repeating-linear-gradient
  repeating-radial-gradient repeating-conic-gradient rgb rgba hsl hsla hwb lab lch oklab oklch
  color-mix calc min max clamp translate translatex translatey translate3d rotate rotatex
  rotatey rotatez rotate3d scale scalex scaley scale3d skew skewx skewy matrix matrix3d
  perspective blur brightness contrast drop-shadow grayscale hue-rotate invert saturate sepia
  inset circle ellipse polygon repeat minmax fit-content`.split(/\s+/)
)

const name = (text: string) => text.slice(0, 40)

/**
 * Reads a stylesheet, or with `inline` one `style` attribute (its
 * declarations only). Never throws.
 */
export function readCss(css: string, inline = false): ReadCss {
  const out: ReadCss = {
    declarations: [],
    urls: [],
    problems: [],
    unread: false
  }
  const refuse = (problem: string) => {
    out.problems.push(problem)
    out.unread = true
    return out
  }
  if (css.includes('/*')) return refuse('Leave comments out of the styles.')
  // An escape or a "<" anywhere (inside a string too: the styles go into a
  // <style> element); an at-rule is refused where it starts, below.
  if (/[\\<]/.test(css))
    return refuse(
      'The styles use an escape or a "<", which a picture never needs.'
    )
  // One pass: strings and links become placeholders, then braces and semicolons cut.
  const strings: string[] = []
  let buf = ''
  let depth = 0
  let blocks = 0
  const declare = () => {
    const text = buf.trim()
    buf = ''
    if (!text) return
    const colon = text.indexOf(':')
    const property = (colon > 0 ? text.slice(0, colon) : '')
      .trim()
      .toLowerCase()
    if (!/^[a-z][a-z-]*$/.test(property)) {
      out.problems.push(
        `The styles have “${name(text)}”, which is not a style a picture uses.`
      )
      return
    }
    const value = text
      .slice(colon + 1)
      .replace(/\s*!important\s*$/i, '')
      .trim()
    out.declarations.push({
      property,
      value: value.replace(/"(\d+)"/g, (_, i) => JSON.stringify(strings[+i]))
    })
    check(property, value)
  }
  const check = (property: string, value: string) => {
    if (!properties.has(property))
      return out.problems.push(
        `The styles use ${name(property)}, which a picture does not need (or which draws words).`
      )
    if (/[{}]/.test(value))
      return out.problems.push(`The ${property} style has a block in it.`)
    const shown = value.replace(/"(\d+)"/g, (_, i) =>
      JSON.stringify(strings[+i])
    )
    if (property === 'content')
      return emptyContent.has(shown)
        ? 0
        : out.problems.push(
            'The styles draw words (content): only an empty content is a decoration; put every word in the markup.'
          )
    if (
      (property === 'list-style' || property === 'list-style-type') &&
      value.toLowerCase() !== 'none'
    )
      return out.problems.push(
        `${property}: ${name(value)} draws markers or numbers; only none.`
      )
    if (/"\d+"/.test(value) && !stringProperties.has(property))
      out.problems.push(
        `The ${property} style has words in quotes: only font names may.`
      )
    for (const m of value.matchAll(/([a-z-]+)\(/gi))
      if (!functions.has(m[1].toLowerCase()))
        out.problems.push(
          `The ${property} style uses ${name(m[1].toLowerCase())}(), which a picture does not need (or which draws words).`
        )
    if (property === 'display' && !displays.has(value.toLowerCase()))
      out.problems.push(
        `display: ${name(value)} is not one a picture uses (no list items, nothing hidden).`
      )
  }
  for (let i = 0; i < css.length; i++) {
    const c = css[i]
    if (c === '"' || c === "'") {
      const end = css.indexOf(c, i + 1)
      const text = end < 0 ? null : css.slice(i + 1, end)
      if (text === null || /[\n\r\f]/.test(text))
        return refuse('The styles have a string that is never closed.')
      buf += `"${strings.push(text) - 1}"`
      i = end
      continue
    }
    // A link: `url(` then a string, or plain text up to `)`.
    if (
      /^url\(/i.test(css.slice(i, i + 4)) &&
      !/[\w-]/.test(css[i - 1] ?? '')
    ) {
      let j = i + 4
      while (/\s/.test(css[j] ?? '')) j++
      let link: string
      if (css[j] === '"' || css[j] === "'") {
        const end = css.indexOf(css[j], j + 1)
        if (end < 0)
          return refuse('The styles have a string that is never closed.')
        link = css.slice(j + 1, end)
        j = end + 1
        while (/\s/.test(css[j] ?? '')) j++
        if (css[j] !== ')')
          return refuse('A link in the styles is never closed.')
      } else {
        const end = css.indexOf(')', j)
        if (end < 0) return refuse('A link in the styles is never closed.')
        link = css.slice(j, end).trim()
        if (/["'(\s]/.test(link))
          return refuse('A link in the styles is not one link.')
        j = end
      }
      out.urls.push(link)
      buf += 'url()'
      i = j
      continue
    }
    if (c === '@')
      return refuse('The styles use an at-rule, which a picture never needs.')
    if (c === '(') depth++
    else if (c === ')' && --depth < 0)
      return refuse('The styles close a bracket they never opened.')
    if (depth === 0 && (c === '{' || c === '}') && inline)
      return refuse('An inline style has a block in it.')
    if (depth === 0 && c === '{') {
      // A selector (or a nested rule's); it draws nothing itself.
      buf = ''
      blocks++
      continue
    }
    if (depth === 0 && c === '}') {
      declare()
      if (--blocks < 0)
        return refuse('The styles close a block they never opened.')
      continue
    }
    if (depth === 0 && c === ';') {
      declare()
      continue
    }
    buf += c
  }
  if (depth) return refuse('The styles open a bracket they never close.')
  if (blocks) return refuse('The styles open a block they never close.')
  // Text after the last rule is a declaration only in an inline style.
  if (inline) declare()
  else if (buf.trim())
    out.problems.push('The styles end with something that is not a rule.')
  out.problems = [...new Set(out.problems)]
  return out
}
