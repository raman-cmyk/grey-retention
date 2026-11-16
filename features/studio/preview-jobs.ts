import 'server-only'
import { parse, type DefaultTreeAdapterTypes as T } from 'parse5'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { previewFooterTags } from '@/features/blocks/klaviyo-tags'
import { srcsetUrls } from './section'

/**
 * DST-005b part 2b: the email's views as jobs. The design step asks for a
 * view of the email it drew (`requestEmailRender`, under its own lease):
 * `desktop` (600 wide), `phone` (375 wide) or `dark` (600, dark mode as
 * the email declares it), with the hosts its pictures come from as its
 * only origins (`emailOrigins`). The browser outside the app takes them
 * from the app's route and draws each with `renderEmail` (the hand-out
 * and the route follow). Nothing asks for a view yet (DST-006d does, with
 * the design studio on).
 */

type Db = SupabaseClient<Database>

export const emailViewNames = ['desktop', 'phone', 'dark'] as const
export type EmailView = (typeof emailViewNames)[number]

export const previewLimits = {
  /** Views handed out per call: the browser asks again for the next. */
  perCall: 1,
  /** Claims a call makes at most to find one view it can hand out. */
  claims: 5,
  /** Hosts an email's pictures may come from (the command's own limit). */
  maxOrigins: 8,
  /** The page, in bytes (a built email's limit). */
  maxDocumentBytes: 200_000,
  /** The picture: the studio bucket's limit. */
  maxBytes: 3 * 1024 * 1024,
  /** A taller email is drawn cut here (`renderEmail`). */
  maxHeight: 6_000
}

/** An email the browser may not draw, with its reasons in plain words. */
export class EmailNotDrawable extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join(' '))
    this.name = 'EmailNotDrawable'
  }
}

/** A hostname the command takes: no IP address, no port, no user. */
const hostname =
  /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/
/**
 * What the browser refuses to draw (`renderEmail`'s own rule, kept the
 * same): a <link>, a meta http-equiv, frames, objects and `srcdoc` would
 * reach out past its route guard.
 */
const reachesOut =
  /<link\b|\bhttp-equiv\b|<(?:iframe|frame|frameset|object|embed|portal|fencedframe)\b|\bsrcdoc\b/i
const cssUrls = (css: string) =>
  [...css.matchAll(/url\(\s*(['"]?)([^'")\s]+)\1\s*\)/gi)].map((m) => m[2]!)

/** The links a page loads pictures from: `src`, `srcset`, `background`, CSS. */
function loadedUrls(node: T.ParentNode, urls: string[]) {
  for (const child of node.childNodes) {
    if (!('tagName' in child)) continue
    const el = child as T.Element
    const tag = el.tagName.toLowerCase()
    if (tag === 'style')
      for (const text of el.childNodes)
        if (text.nodeName === '#text')
          urls.push(...cssUrls((text as T.TextNode).value))
    for (const { name, value } of el.attrs) {
      const n = name.toLowerCase()
      if (n === 'src' || n === 'background' || n === 'poster')
        urls.push(value.trim())
      else if (n === 'srcset') urls.push(...srcsetUrls(value))
      else if (n === 'style') urls.push(...cssUrls(value))
    }
    if (tag === 'template')
      loadedUrls((el as T.Template).content as T.ParentNode, urls)
    loadedUrls(el, urls)
  }
}

/**
 * The https origins an email's pictures come from, once each, as the
 * command takes them. A picture from anywhere else (http, an IP address, a
 * port) is not loaded: the browser draws the email without it. Inline
 * pictures need no origin. Throws `EmailNotDrawable` past 8 hosts.
 */
export function emailOrigins(html: string): string[] {
  const urls: string[] = []
  // As the browser reads it with JavaScript off: <noscript> is drawn.
  loadedUrls(parse(html, { scriptingEnabled: false }), urls)
  const hosts = new Set<string>()
  for (const url of urls) {
    let u: URL
    try {
      u = new URL(url)
    } catch {
      continue
    }
    const host = u.hostname.toLowerCase()
    if (
      u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      u.port === '' &&
      host.length <= 253 &&
      hostname.test(host) &&
      !/\.[0-9]+$/.test(host)
    )
      hosts.add(host)
  }
  if (hosts.size > previewLimits.maxOrigins)
    throw new EmailNotDrawable([
      `The email loads pictures from more than ${previewLimits.maxOrigins} places.`
    ])
  return [...hosts].map((h) => `https://${h}`)
}

/**
 * Asks for a view of a built email to be drawn, under the build's lease on
 * its design step, as the preview shows it (Klaviyo's tags as
 * placeholders). The same key, view and email again is the same render;
 * the same key and view with another email is PT409. An email too large,
 * with pictures from too many places, or that the browser would refuse,
 * is never queued.
 */
export async function requestEmailRender(
  db: Db,
  input: {
    build: string
    lease: string
    key: string
    view: EmailView
    html: string
    brandName: string | null
  }
): Promise<string> {
  const document = previewFooterTags(input.html, input.brandName)
  if (Buffer.byteLength(document) > previewLimits.maxDocumentBytes)
    throw new EmailNotDrawable(['The email is too large to draw.'])
  if (reachesOut.test(document))
    throw new EmailNotDrawable([
      'The email has a part that would load from outside its pictures.'
    ])
  const origins = emailOrigins(document)
  const { data, error } = await db.rpc('request_email_render', {
    build: input.build,
    lease: input.lease,
    render_key: input.key,
    email_view: input.view,
    document,
    origins
  })
  if (error) throw error
  return data
}
