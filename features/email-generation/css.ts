// A small CSS tokenizer for email previews. It follows the CSS Syntax escape
// and comment rules closely enough to recognize resource-loading functions and
// at-rules however they are spelled (`u\72l(`, `/**/@import`, nested parens),
// and removes them. Everything else is copied through unchanged.

const blockedFunctions = new Set([
  'url',
  'src',
  'image',
  'image-set',
  '-webkit-image-set',
  'cross-fade',
  '-webkit-cross-fade',
  'element',
  '-moz-element',
  'expression',
  'alphaimageloader'
])
const blockedAtRules = new Set(['import', 'font-face', 'namespace'])

export type CssReport = { blocked: number }

const isHex = (c: string) => /^[0-9a-f]$/i.test(c)
const isNameChar = (c: string) =>
  /^[a-z0-9_-]$/i.test(c) || (c.length > 0 && c.charCodeAt(0) >= 0x80)
const isWhitespace = (c: string) =>
  c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f'

/** Reads an escape after a backslash at `i`; returns the decoded text and end. */
function readEscape(css: string, i: number): [string, number] {
  let j = i + 1
  if (j >= css.length) return ['', j]
  if (isHex(css[j])) {
    let hex = ''
    while (j < css.length && hex.length < 6 && isHex(css[j])) hex += css[j++]
    if (j < css.length && isWhitespace(css[j])) j++
    const point = parseInt(hex, 16)
    const valid =
      point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
    return [valid ? String.fromCodePoint(point) : '�', j]
  }
  if (css[j] === '\n') return ['', j + 1]
  return [css[j], j + 1]
}

/** Reads an identifier starting at `i`; returns decoded name and end. */
function readName(css: string, i: number): [string, number] {
  let name = ''
  let j = i
  while (j < css.length) {
    const c = css[j]
    if (c === '\\') {
      const [decoded, next] = readEscape(css, j)
      name += decoded
      j = next
    } else if (isNameChar(c)) {
      name += c
      j++
    } else break
  }
  return [name, j]
}

function skipString(css: string, i: number) {
  const quote = css[i]
  let j = i + 1
  while (j < css.length) {
    if (css[j] === '\\') j += 2
    else if (css[j] === quote || css[j] === '\n') return j + 1
    else j++
  }
  return j
}

function skipComment(css: string, i: number) {
  const end = css.indexOf('*/', i + 2)
  return end < 0 ? css.length : end + 2
}

/** Skips to the matching `)` of a function whose `(` ends before `i`. */
function skipArguments(css: string, i: number) {
  let depth = 1
  let j = i
  while (j < css.length && depth > 0) {
    const c = css[j]
    if (c === '"' || c === "'") j = skipString(css, j)
    else if (c === '/' && css[j + 1] === '*') j = skipComment(css, j)
    else if (c === '\\') j += 2
    else {
      if (c === '(') depth++
      else if (c === ')') depth--
      j++
    }
  }
  return j
}

/** Skips an at-rule prelude and its block or terminating semicolon. */
function skipAtRule(css: string, i: number) {
  let j = i
  while (j < css.length) {
    const c = css[j]
    if (c === '"' || c === "'") j = skipString(css, j)
    else if (c === '/' && css[j + 1] === '*') j = skipComment(css, j)
    else if (c === '\\') j += 2
    else if (c === '(') j = skipArguments(css, j + 1)
    else if (c === ';') return j + 1
    else if (c === '}') return j
    else if (c === '{') {
      let depth = 1
      j++
      while (j < css.length && depth > 0) {
        const d = css[j]
        if (d === '"' || d === "'") j = skipString(css, j)
        else if (d === '/' && css[j + 1] === '*') j = skipComment(css, j)
        else if (d === '\\') j += 2
        else {
          if (d === '{') depth++
          else if (d === '}') depth--
          j++
        }
      }
      return j
    } else j++
  }
  return j
}

/**
 * Returns CSS with remote-resource functions replaced by `none`, resource
 * at-rules removed and comments replaced by a space (so removing one can never
 * join characters such as `<` and `/style`). Any remaining `<` is escaped.
 */
export function sanitizeCss(css: string, report: CssReport = { blocked: 0 }) {
  let out = ''
  let i = 0
  while (i < css.length) {
    const c = css[i]
    if (c === '/' && css[i + 1] === '*') {
      i = skipComment(css, i)
      out += ' '
    } else if (c === '"' || c === "'") {
      const end = skipString(css, i)
      out += css.slice(i, end)
      i = end
    } else if (c === '@') {
      const [name, end] = readName(css, i + 1)
      if (blockedAtRules.has(name.toLowerCase())) {
        report.blocked++
        i = skipAtRule(css, end)
      } else {
        out += css.slice(i, end)
        i = end === i + 1 ? i + 1 : end
      }
    } else if (c === '\\' || isNameChar(c)) {
      const [name, end] = readName(css, i)
      if (css[end] === '(' && blockedFunctions.has(name.toLowerCase())) {
        report.blocked++
        i = skipArguments(css, end + 1)
        out += 'none'
      } else {
        out += css.slice(i, end)
        i = end > i ? end : i + 1
      }
    } else {
      out += c
      i++
    }
  }
  return out.replace(/</g, '\\3c ')
}
