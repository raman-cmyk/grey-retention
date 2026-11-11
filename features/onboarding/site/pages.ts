import { parse, type DefaultTreeAdapterTypes as T } from 'parse5'
import type { SitePageKind } from '../findings'
import { siteHosts } from './fetch-hosts'

/**
 * A page as the Site reader sees it: its words as a visitor would read
 * them (no scripts, styles or hidden parts), its title, and its links.
 */
export type ReadPage = {
  url: string
  kind: SitePageKind
  title: string
  description: string
  language: string
  text: string
  links: { href: string; text: string }[]
}

/** Most words kept per page (the agent reads at most this). */
export const maxPageText = 12_000
/** Most pages read per site, the home page included. */
export const maxPages = 8

type Node = T.ChildNode | T.ParentNode
const isElement = (n: Node): n is T.Element => 'tagName' in n
const attr = (n: T.Element, name: string) =>
  n.attrs.find((a) => a.name === name)?.value ?? null
const children = (n: Node): T.ChildNode[] =>
  'childNodes' in n ? n.childNodes : []
const unseen = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'iframe',
  'head'
])
const blocks = new Set([
  'p',
  'div',
  'li',
  'ul',
  'ol',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'br',
  'tr',
  'td',
  'th',
  'section',
  'article',
  'header',
  'footer',
  'main',
  'nav',
  'table',
  'blockquote',
  'dd',
  'dt'
])

/** Not shown: the same rule as the inbox sections (INB-003). */
function hidden(n: T.Element) {
  if (attr(n, 'hidden') !== null || attr(n, 'aria-hidden') === 'true')
    return true
  const style = (attr(n, 'style') ?? '').toLowerCase()
  return (
    /(?:^|[;\s])(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?![.\d]))/.test(
      style
    ) ||
    (/(?:^|[;\s])max-height\s*:\s*0(?![.\d])/.test(style) &&
      /overflow\s*:\s*hidden/.test(style))
  )
}

/** Whitespace folded, so a quote can be found whatever the line breaks. */
export const fold = (text: string) => text.replace(/\s+/g, ' ').trim()

export function readPage(
  html: string,
  url: string,
  kind: SitePageKind
): ReadPage {
  const doc = parse(html.slice(0, 2_000_000))
  let title = ''
  let description = ''
  let language = 'en'
  const parts: string[] = []
  const links: ReadPage['links'] = []
  const head = (n: Node) => {
    for (const c of children(n)) {
      if (!isElement(c)) continue
      if (c.tagName === 'html') {
        const lang = attr(c, 'lang')?.slice(0, 2).toLowerCase()
        if (lang && /^[a-z]{2}$/.test(lang)) language = lang
      }
      if (c.tagName === 'title') title = fold(textOf(c)).slice(0, 200)
      if (
        c.tagName === 'meta' &&
        (attr(c, 'name') ?? '').toLowerCase() === 'description'
      )
        description = fold(attr(c, 'content') ?? '').slice(0, 300)
      head(c)
    }
  }
  const walk = (n: Node) => {
    for (const c of children(n)) {
      if (c.nodeName === '#text') {
        parts.push((c as T.TextNode).value)
        continue
      }
      if (!isElement(c) || unseen.has(c.tagName) || hidden(c)) continue
      if (c.tagName === 'a') {
        const href = attr(c, 'href')
        if (href) links.push({ href, text: fold(textOf(c)).slice(0, 80) })
      }
      if (blocks.has(c.tagName)) parts.push('\n')
      walk(c)
      if (blocks.has(c.tagName)) parts.push('\n')
    }
  }
  head(doc)
  walk(doc)
  const text = parts
    .join('')
    .split('\n')
    .map(fold)
    .filter(Boolean)
    .join('\n')
    .slice(0, maxPageText)
  return { url, kind, title, description, language, text, links }
}

function textOf(n: Node): string {
  if (n.nodeName === '#text') return (n as T.TextNode).value
  if (isElement(n) && (unseen.has(n.tagName) || hidden(n))) return ''
  return children(n).map(textOf).join(' ')
}

const rules: { kind: SitePageKind; path: RegExp; words: RegExp }[] = [
  { kind: 'shipping', path: /shipping|delivery/i, words: /shipping|delivery/i },
  {
    kind: 'returns',
    path: /returns?|refund|exchange/i,
    words: /returns?|refunds?|exchanges?/i
  },
  { kind: 'faq', path: /faq|help|questions/i, words: /faq|help|questions/i },
  { kind: 'about', path: /about|our-story|story/i, words: /about|our story/i }
]

/**
 * The pages worth reading, found from the home page's own links: shipping,
 * returns, help, the story and up to two products, on the brand's own host
 * only, at most `maxPages` with the home page.
 */
export function pagesToRead(
  home: ReadPage,
  domain: string
): { url: string; kind: SitePageKind }[] {
  const hosts = siteHosts(domain)
  const seen = new Set([normal(home.url)])
  const found: { url: string; kind: SitePageKind }[] = []
  const candidates = home.links.flatMap((link) => {
    try {
      const url = new URL(link.href, home.url)
      if (url.protocol !== 'https:' || !hosts.has(url.hostname)) return []
      url.hash = ''
      return [{ url, text: link.text }]
    } catch {
      return []
    }
  })
  const take = (url: URL, kind: SitePageKind) => {
    const key = normal(url.toString())
    if (seen.has(key) || found.length >= maxPages - 1) return
    seen.add(key)
    found.push({ url: url.toString(), kind })
  }
  for (const rule of rules) {
    const match = candidates.find(
      (c) => rule.path.test(c.url.pathname) || rule.words.test(c.text)
    )
    if (match) take(match.url, rule.kind)
  }
  let products = 0
  for (const c of candidates)
    if (products < 2 && /\/products?\/[^/]+\/?$/i.test(c.url.pathname)) {
      const before = found.length
      take(c.url, 'product')
      if (found.length > before) products++
    }
  return found
}

const normal = (url: string) => url.replace(/\/+$/, '').toLowerCase()
