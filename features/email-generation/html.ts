import { parse, serialize, type DefaultTreeAdapterTypes as T } from 'parse5'
import { looksLikeMarkup } from '@/features/references/pasted'
import { sanitizeCss } from './css'

// Every transformation here parses with a WHATWG-compliant parser and edits
// the tree; the stored original is never modified. Output of `previewHtml` is
// only ever placed in a sandboxed iframe without scripts or same-origin access.

export type EmailFormat = 'html' | 'text'
export type PreviewReport = {
  images: number
  styles: number
  links: number
  removed: number
  truncated: boolean
}

export function emailFormat(original: string): EmailFormat {
  return looksLikeMarkup(original) ? 'html' : 'text'
}

/** Removed with their contents in every derived document. */
const removedElements = new Set([
  'script',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'param',
  'portal',
  'base',
  'link',
  'meta',
  'template',
  'audio',
  'video',
  'source',
  'track',
  'canvas',
  'input',
  'select',
  'textarea',
  'option',
  'optgroup',
  'datalist',
  'output',
  'keygen',
  'dialog',
  'svg',
  'math'
])
/** Kept as a neutral element so layout survives without behavior. */
const renamedElements: Record<string, string> = {
  form: 'div',
  button: 'span',
  noscript: 'div'
}
const keptAttributes = new Set([
  'align',
  'valign',
  'bgcolor',
  'color',
  'width',
  'height',
  'border',
  'cellpadding',
  'cellspacing',
  'colspan',
  'rowspan',
  'style',
  'class',
  'id',
  'dir',
  'lang',
  'title',
  'alt',
  'role',
  'face',
  'size',
  'nowrap',
  'span',
  'scope',
  'headers',
  'abbr',
  'start',
  'type',
  'reversed',
  'summary',
  'frame',
  'rules',
  'hspace',
  'vspace',
  'clear',
  'name'
])
const safeImage = /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i
// A neutral block that keeps the image's declared size; never a remote load.
export const placeholderImage = `data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='4' height='3'><rect width='4' height='3' fill='#e7e7e4'/></svg>"
)}`
const blockSeparated = new Set([
  'p',
  'div',
  'table',
  'tr',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'section',
  'article',
  'header',
  'footer',
  'blockquote',
  'center',
  'hr'
])
const invisibleText = new Set([
  'script',
  'style',
  'head',
  'title',
  'template',
  'noscript',
  'svg',
  'math'
])

const isElement = (node: T.Node): node is T.Element =>
  'tagName' in node && typeof node.tagName === 'string'
const isText = (node: T.Node): node is T.TextNode => node.nodeName === '#text'
const childrenOf = (node: T.Node) =>
  'childNodes' in node ? (node.childNodes as T.ChildNode[]) : []

/** Deeper content is cut so serialization (recursive in parse5) stays bounded. */
export const maxDepth = 200

/**
 * Parses with a depth bound. Content nested deeper than `maxDepth` is cut and
 * `truncated` is set, so callers can report it (preview) or refuse to save or
 * rewrite a document that would lose content (editing, rewriting).
 */
function parseBounded(html: string) {
  // Scripting disabled: <noscript> content is parsed as markup and sanitized.
  const document = parse(html, { scriptingEnabled: false })
  let truncated = false
  const stack: [T.Node, number][] = [[document, 0]]
  while (stack.length) {
    const [node, depth] = stack.pop()!
    const children = childrenOf(node)
    if (depth >= maxDepth && children.length) {
      children.length = 0
      truncated = true
      continue
    }
    for (const child of children) stack.push([child, depth + 1])
  }
  return { document, truncated }
}

function parseDocument(html: string) {
  return parseBounded(html).document
}

/** For saving or rewriting: never proceeds on a document that lost content. */
function parseComplete(html: string) {
  const { document, truncated } = parseBounded(html)
  if (truncated)
    throw new Error('This email is nested too deeply to edit safely.')
  return document
}

/** Iterative pre-order walk; deep pathological nesting cannot overflow. */
function walk(root: T.Node, visit: (node: T.Node) => boolean | void) {
  const stack: T.Node[] = [root]
  while (stack.length) {
    const node = stack.pop()!
    if (visit(node) === false) continue
    const children = childrenOf(node)
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i])
  }
}

function element(tagName: string, attrs: T.Element['attrs'] = []): T.Element {
  return {
    nodeName: tagName,
    tagName,
    attrs,
    namespaceURI: 'http://www.w3.org/1999/xhtml' as T.Element['namespaceURI'],
    parentNode: null,
    childNodes: []
  }
}

function findElement(root: T.Node, tagName: string) {
  let found: T.Element | null = null
  walk(root, (node) => {
    if (found) return false
    if (isElement(node) && node.tagName === tagName) {
      found = node
      return false
    }
  })
  return found as T.Element | null
}

export type TransformOptions = {
  /** `remove` drops destinations; a URL replaces every web link. */
  links: 'remove' | { replaceWith: string }
  /** Adds a restrictive Content-Security-Policy as the first head element. */
  contentSecurityPolicy: boolean
  /** Removes source wording carried in attributes (alt, title, aria-label). */
  dropTextAttributes?: boolean
}

const textAttributes = new Set([
  'alt',
  'title',
  'aria-label',
  'summary',
  'abbr'
])

/**
 * Returns a safe, layout-preserving copy: no scripts, frames, forms,
 * remote images, CSS resources, comments, navigation or event handlers.
 */
export function transformHtml(html: string, options: TransformOptions) {
  const { document, truncated } = parseBounded(html)
  const report: PreviewReport = {
    images: 0,
    styles: 0,
    links: 0,
    removed: 0,
    truncated
  }
  const css = { blocked: 0 }
  walk(document, (node) => {
    const children = childrenOf(node)
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i]
      if (child.nodeName === '#comment') {
        children.splice(i, 1)
        continue
      }
      if (!isElement(child)) continue
      const tag = child.tagName
      const foreign = child.namespaceURI !== 'http://www.w3.org/1999/xhtml'
      if (foreign || removedElements.has(tag)) {
        children.splice(i, 1)
        if (tag !== 'meta' && tag !== 'base') report.removed++
        continue
      }
      if (renamedElements[tag]) {
        child.tagName = renamedElements[tag]
        child.nodeName = renamedElements[tag]
      }
    }
    if (!isElement(node)) return
    const attrs: T.Element['attrs'] = []
    for (const attr of node.attrs) {
      const name = attr.name.toLowerCase()
      if (attr.namespace) continue
      if (name === 'href' && node.tagName === 'a') {
        const target = attr.value.trim()
        if (/^https?:/i.test(target) && typeof options.links === 'object') {
          attrs.push({ name: 'href', value: options.links.replaceWith })
        } else report.links++
        continue
      }
      if (name === 'src' && node.tagName === 'img') {
        if (safeImage.test(attr.value.trim())) attrs.push(attr)
        else {
          report.images++
          attrs.push({ name: 'src', value: placeholderImage })
        }
        continue
      }
      if (name === 'background') {
        report.images++
        continue
      }
      if (name === 'style') {
        const before = css.blocked
        attrs.push({ name, value: sanitizeCss(attr.value, css) })
        if (css.blocked > before) report.styles += css.blocked - before
        continue
      }
      if (options.dropTextAttributes && textAttributes.has(name)) {
        if (name === 'alt') attrs.push({ name, value: '' })
        continue
      }
      if (keptAttributes.has(name) || name.startsWith('aria-'))
        attrs.push({ name, value: attr.value })
    }
    node.attrs = attrs
    if (node.tagName === 'style') {
      for (const text of node.childNodes) {
        if (!isText(text)) continue
        const before = css.blocked
        text.value = sanitizeCss(text.value, css)
        if (css.blocked > before) report.styles += css.blocked - before
      }
    }
  })
  const head = findElement(document, 'head')
  if (head) {
    const charset = element('meta', [{ name: 'charset', value: 'utf-8' }])
    charset.parentNode = head
    const first: T.Element[] = [charset]
    if (options.contentSecurityPolicy) {
      const policy = element('meta', [
        { name: 'http-equiv', value: 'Content-Security-Policy' },
        {
          name: 'content',
          value:
            "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'none'"
        }
      ])
      policy.parentNode = head
      first.unshift(policy)
    }
    head.childNodes.unshift(...first)
  }
  return { html: serialize(document), report }
}

/** Sandboxed-preview markup; never served from an application route. */
export function previewHtml(html: string) {
  return transformHtml(html, { links: 'remove', contentSecurityPolicy: true })
}

/** Readable text version of an HTML email, built from the parsed tree. */
export function htmlToText(html: string) {
  const document = parseDocument(html)
  const body = findElement(document, 'body') ?? document
  let out = ''
  const stack: (T.Node | string)[] = [body]
  while (stack.length) {
    const item = stack.pop()!
    if (typeof item === 'string') {
      out += item
      continue
    }
    if (isText(item)) {
      out += item.value.replace(/\s+/g, ' ')
      continue
    }
    if (!isElement(item) && item !== body) continue
    if (isElement(item)) {
      if (invisibleText.has(item.tagName)) continue
      if (item.tagName === 'br') {
        out += '\n'
        continue
      }
      if (item.tagName === 'li') out += '\n• '
      if (item.tagName === 'td' || item.tagName === 'th') out += ' '
      if (blockSeparated.has(item.tagName)) {
        out += '\n\n'
        stack.push('\n\n')
      }
    }
    const children = childrenOf(item)
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i])
  }
  return out
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export const segmentLimits = { count: 150, each: 1000, total: 20_000 }
export type Segment = { id: number; text: string }

function visibleTextNodes(document: T.Document) {
  const body = findElement(document, 'body')
  const nodes: T.TextNode[] = []
  if (!body) return nodes
  walk(body, (node) => {
    if (isElement(node) && invisibleText.has(node.tagName)) return false
    if (isText(node) && node.value.trim()) nodes.push(node)
  })
  return nodes
}

/**
 * Visible text runs of an HTML email, numbered in document order. Returns
 * null when the email has too much text to rewrite in place safely.
 */
export function htmlSegments(html: string): Segment[] | null {
  const { document, truncated } = parseBounded(html)
  if (truncated) return null
  const nodes = visibleTextNodes(document)
  if (!nodes.length || nodes.length > segmentLimits.count) return null
  const segments = nodes.map((node, id) => ({
    id,
    text: node.value.replace(/\s+/g, ' ').trim()
  }))
  const total = segments.reduce((sum, s) => sum + s.text.length, 0)
  if (
    total > segmentLimits.total ||
    segments.some((s) => s.text.length > segmentLimits.each)
  )
    return null
  return segments
}

export const maxEditableLinks = 50
export type EditableLink = { id: number; text: string; href: string }

function webLinks(document: T.Document) {
  const body = findElement(document, 'body')
  const links: T.Element[] = []
  if (!body) return links
  walk(body, (node) => {
    if (isElement(node) && invisibleText.has(node.tagName)) return false
    if (
      isElement(node) &&
      node.tagName === 'a' &&
      node.attrs.some(
        (a) => a.name === 'href' && /^https?:/i.test(a.value.trim())
      )
    )
      links.push(node)
  })
  return links
}

function textOf(node: T.Node): string {
  let out = ''
  walk(node, (child) => {
    if (isText(child)) out += child.value
  })
  return out.replace(/\s+/g, ' ').trim()
}

/**
 * What an owner can edit without touching code: visible text blocks and web
 * links, in document order. Null when the email is too large to edit safely
 * block by block; the raw HTML editor remains the fallback then.
 */
export function htmlEditable(html: string) {
  const { document, truncated } = parseBounded(html)
  if (truncated) return null
  const segments = htmlSegments(html)
  const links = webLinks(document)
  if (!segments || links.length > maxEditableLinks) return null
  const editableLinks: EditableLink[] = links.map((a, id) => ({
    id,
    text: textOf(a).slice(0, 120),
    href: a.attrs.find((x) => x.name === 'href')!.value.trim()
  }))
  return { segments, links: editableLinks }
}

const utilityLink =
  /view (it )?in (your )?browser|web version|unsubscribe|preferences|privacy|manage|terms/i

/**
 * Sensible default for the main button: the link the email already uses as
 * its call to action, otherwise the first worded link that is not a logo,
 * "view in browser" or footer link. The owner can change it.
 */
export function suggestedPrimary(links: EditableLink[], currentCta: string) {
  return (
    links.find((l) => currentCta && l.href === currentCta && l.text) ??
    links.find((l) => l.text && !utilityLink.test(l.text)) ??
    links.find((l) => l.text) ??
    null
  )
}

/**
 * Applies text and link edits to the parsed tree and serializes it. Every
 * other element, attribute and style is kept; the stored source is untouched.
 */
export function editHtml(html: string, texts: string[], hrefs: string[]) {
  const document = parseComplete(html)
  const nodes = visibleTextNodes(document)
  const links = webLinks(document)
  if (texts.length !== nodes.length || hrefs.length !== links.length)
    throw new Error('The email changed; reload before editing.')
  nodes.forEach((node, index) => {
    const text = texts[index].replace(/\s+/g, ' ').trim()
    const lead = /^\s/.test(node.value) ? ' ' : ''
    const tail = /\s$/.test(node.value) ? ' ' : ''
    node.value = text ? `${lead}${text}${tail}` : ''
  })
  links.forEach((link, index) => {
    const href = link.attrs.find((a) => a.name === 'href')!
    href.value = hrefs[index]
  })
  return serialize(document)
}

/**
 * Builds the rebranded HTML: every visible text run is replaced by the
 * generated text for the same id (empty removes it), web links point to the
 * chosen destination and the source's images and CSS resources are replaced.
 * The result is a new safe document; the source is not altered.
 */
export function rewriteHtml(
  html: string,
  replacements: Segment[],
  destination: string
) {
  const document = parseComplete(html)
  const nodes = visibleTextNodes(document)
  const byId = new Map(replacements.map((r) => [r.id, r.text]))
  if (byId.size !== nodes.length || replacements.length !== nodes.length)
    throw new Error('Every text segment needs exactly one replacement.')
  nodes.forEach((node, id) => {
    const text = byId.get(id)
    if (text === undefined) throw new Error('Missing segment replacement.')
    const lead = node.value.match(/^\s*/)![0] ? ' ' : ''
    const tail = node.value.match(/\s*$/)![0] ? ' ' : ''
    node.value = text ? `${lead}${text}${tail}` : ''
  })
  const rewritten = transformHtml(serialize(document), {
    links: { replaceWith: destination },
    contentSecurityPolicy: false,
    dropTextAttributes: true
  })
  // CSS can add visible words (`content: "..."`); they are not rewritten.
  return { ...rewritten, cssText: /\bcontent\s*:\s*(["']|attr\()/i.test(html) }
}
