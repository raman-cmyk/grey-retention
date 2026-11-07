import { checkCopy } from '@/features/copy-qa/check'
import { copyDraftOf, type Draft } from '@/features/assembly/assemble'
import type {
  BrandFacts,
  CatalogProduct,
  DiscountCode
} from '@/features/assembly/inputs'
import { localDateTime, localTimeCandidates } from '@/lib/local-time'

/**
 * Full QA before a Klaviyo push (VISION Step 4, QAG-001). Every check is a
 * hard block: one failure and nothing reaches the client's Klaviyo account.
 * Each result says, in plain words, what is wrong and how to fix it. The
 * push job (PSH-001) runs this and stores the result with the campaign.
 */

/** Gmail clips messages over about 102KB. */
export const gmailClipBytes = 102 * 1024

/** Where VISION rule 11 says email images must be hosted. */
const klaviyoImageHost = /^(?:[a-z0-9-]+\.)*(?:klaviyomail\.com|klaviyo\.com)$/i

export type ReleaseCandidate = {
  draft: Draft
  /** The exact HTML that would become the Klaviyo template. */
  html: string
  /** When it sends, ISO with offset. */
  sendAt: string
  /** The store's IANA timezone (VISION rule 12). */
  timezone: string
  /** The local wall time the owner approved, e.g. "2026-11-10T16:45". */
  approvedLocalTime: string
  /** Klaviyo segment the campaign targets, and the client's Engaged segment. */
  audienceSegmentId: string
  engagedSegmentId: string
  /** Local dates (YYYY-MM-DD) the owner blocked, and dates already taken. */
  blackoutDates: readonly string[]
  occupiedDates: readonly string[]
  /** The current cleaned catalog. */
  products: readonly CatalogProduct[]
  codes: readonly DiscountCode[]
  maxDiscountPercent: number
  facts: BrandFacts
  /** Hosts the email may link to, e.g. ["example-store.com"]. */
  storeHosts: readonly string[]
  /** The 375px render the approval screen reuses; null if it failed. */
  phoneRender: { width: number; ok: boolean } | null
  /** Now, for expiry and "in the past" checks. */
  now: string
}

export type LinkResult =
  | { ok: true; status: number; finalUrl: string }
  | { ok: false; reason: 'timeout' | 'network' | 'blocked' }

/** Fetches a link (following redirects) and reports where it ended. */
export type LinkChecker = (url: string) => Promise<LinkResult>

export type CheckId =
  | 'links'
  | 'code'
  | 'date'
  | 'products'
  | 'size'
  | 'phone_render'
  | 'copy'
  | 'audience'
  | 'send_time'
  | 'images'
  | 'footer'

export type CheckResult = {
  id: CheckId
  label: string
  pass: boolean
  /** Plain-English reasons; empty when the check passes. */
  problems: string[]
}

export type ReleaseQaResult = { pass: boolean; checks: CheckResult[] }

const labels: Record<CheckId, string> = {
  links: 'Every link works and goes to the right page',
  code: 'Discount code is valid',
  date: 'Send date is free',
  products: 'Featured products are in stock and allowed',
  size: 'Email is small enough for Gmail',
  phone_render: 'Phone preview rendered',
  copy: 'Copy passes the facts sheet and banned words',
  audience: 'Goes to the Engaged segment',
  send_time: 'Send time is the approved store time',
  images: 'Images are hosted in Klaviyo',
  footer: 'Footer has the unsubscribe and address tags'
}

function attr(html: string, tag: string, name: string) {
  const out: string[] = []
  const re = new RegExp(
    `<${tag}\\b[^>]*\\s${name}\\s*=\\s*(["'])(.*?)\\1`,
    'gi'
  )
  for (const m of html.matchAll(re)) out.push(m[2].replace(/&amp;/g, '&'))
  return out
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

function pathOf(url: string) {
  try {
    return new URL(url).pathname.replace(/\/+$/, '') || '/'
  } catch {
    return null
  }
}

function allowedHost(host: string | null, storeHosts: readonly string[]) {
  if (!host) return false
  return storeHosts.some((h) => {
    const s = h.toLowerCase()
    return host === s || host === `www.${s}` || `www.${host}` === s
  })
}

/** Links a reader can click, without Klaviyo tags or mailto links. */
export function emailLinks(html: string) {
  return [
    ...new Set(
      attr(html, 'a', 'href').filter(
        (href) => !/^\s*(mailto:|tel:|\{[%{])/i.test(href)
      )
    )
  ]
}

export async function runReleaseQa(
  c: ReleaseCandidate,
  deps: { checkLink: LinkChecker }
): Promise<ReleaseQaResult> {
  const checks: CheckResult[] = []
  const add = (id: CheckId, problems: string[]) =>
    checks.push({
      id,
      label: labels[id],
      pass: problems.length === 0,
      problems
    })
  const byId = new Map(c.products.map((p) => [p.id, p]))

  // 1. Links: https, on the store, answer 200, and product links land on
  //    that product's page (not a redirect to the home page).
  const linkProblems: string[] = []
  const productPaths = new Map<string, string>()
  for (const id of c.draft.productIds) {
    const p = byId.get(id)
    const path = p ? pathOf(p.url) : null
    if (p && path) productPaths.set(path, p.title)
  }
  const links = emailLinks(c.html)
  if (links.length === 0)
    linkProblems.push('The email has no links to the store.')
  const results = await Promise.all(
    links.map(async (href) => {
      if (!/^https:\/\//i.test(href))
        return `"${href}" is not a secure https link.`
      if (!allowedHost(hostOf(href), c.storeHosts))
        return `"${href}" goes to another website. Link only to the store.`
      const r = await deps.checkLink(href)
      if (!r.ok)
        return r.reason === 'timeout'
          ? `"${href}" did not answer in time.`
          : `"${href}" could not be reached.`
      if (r.status !== 200) return `"${href}" answers ${r.status}, not 200.`
      if (!allowedHost(hostOf(r.finalUrl), c.storeHosts))
        return `"${href}" redirects to another website.`
      const intended = productPaths.get(pathOf(href) ?? '')
      if (intended && pathOf(r.finalUrl) !== pathOf(href))
        return `The link for ${intended} redirects to ${pathOf(r.finalUrl)}, not the product page. The product may be gone.`
      return null
    })
  )
  linkProblems.push(...results.filter((x): x is string => !!x))
  for (const [path, title] of productPaths)
    if (!links.some((l) => pathOf(l) === path))
      linkProblems.push(`${title} is featured but the email has no link to it.`)
  add('links', linkProblems)

  // 2. Code (VISION rule 7): on the list, not expired at send time, within
  //    the max discount.
  const codeProblems: string[] = []
  if (c.draft.code) {
    const entry = c.codes.find(
      (k) => k.code.toUpperCase() === c.draft.code!.toUpperCase()
    )
    if (!entry)
      codeProblems.push(`"${c.draft.code}" is not on the brand's code list.`)
    else {
      if (
        entry.expiresAt &&
        Date.parse(entry.expiresAt) <= Date.parse(c.sendAt)
      )
        codeProblems.push(`"${entry.code}" expires before the email sends.`)
      if (entry.percent > c.maxDiscountPercent)
        codeProblems.push(
          `"${entry.code}" gives ${entry.percent}% off, more than the ${c.maxDiscountPercent}% allowed.`
        )
    }
  }
  add('code', codeProblems)

  // 3. Date (VISION rule 4): not blacked out, not already taken.
  const sendOk = Number.isFinite(Date.parse(c.sendAt))
  const localDay = sendOk
    ? localDateTime(c.sendAt, c.timezone).slice(0, 10)
    : ''
  const dateProblems: string[] = []
  if (sendOk && c.blackoutDates.includes(localDay))
    dateProblems.push(`${localDay} is a blackout date.`)
  if (sendOk && c.occupiedDates.includes(localDay))
    dateProblems.push(
      `Another campaign already sends on ${localDay}. Pick a free day.`
    )
  add('date', dateProblems)

  // 4. Products: every featured product still exists and is featurable.
  const productProblems: string[] = []
  for (const id of c.draft.productIds) {
    const p = byId.get(id)
    if (!p)
      productProblems.push(
        `A featured product (${id}) is no longer in the catalog.`
      )
    else if (!p.featurable)
      productProblems.push(`${p.title} is no longer allowed in emails.`)
  }
  add('products', productProblems)

  // 5. Size: under Gmail's clipping limit.
  const bytes = Buffer.byteLength(c.html, 'utf8')
  add(
    'size',
    bytes < gmailClipBytes
      ? []
      : [
          `The email is ${Math.ceil(bytes / 1024)}KB. Gmail cuts off emails over 102KB, hiding the footer. Remove a block.`
        ]
  )

  // 6. Phone render at 375px (reused on the approval screen).
  add(
    'phone_render',
    c.phoneRender?.ok && c.phoneRender.width === 375
      ? []
      : [
          'The 375px phone preview did not render. Render it again before pushing.'
        ]
  )

  // 7. Copy: facts sheet and banned words (ASM-002).
  const copy = checkCopy({
    draft: copyDraftOf(c.draft),
    facts: c.facts,
    maxDiscountPercent: c.maxDiscountPercent,
    codes: [...c.codes],
    productNames: c.products.map((p) => p.title),
    sendAt: c.sendAt
  })
  add(
    'copy',
    copy.failures.map((f) => `${f.field}: ${f.reason}`)
  )

  // 8. Audience (VISION rule 3).
  add(
    'audience',
    c.audienceSegmentId === c.engagedSegmentId
      ? []
      : ['The campaign does not target the Engaged segment.']
  )

  // 9. Send time (VISION rule 12): the approved store-local time, in the
  //    future.
  const timeProblems: string[] = []
  const candidates = localTimeCandidates(c.approvedLocalTime, c.timezone)
  if (!sendOk) timeProblems.push('The send time is not a real date.')
  else if (!candidates.some((t) => Date.parse(t) === Date.parse(c.sendAt)))
    timeProblems.push(
      `The send time is ${localDateTime(c.sendAt, c.timezone).replace('T', ' ')} store time, not the approved ${c.approvedLocalTime.replace('T', ' ')}.`
    )
  if (sendOk && Date.parse(c.sendAt) <= Date.parse(c.now))
    timeProblems.push('The send time is in the past.')
  add('send_time', timeProblems)

  // 10. Images (VISION rule 11): hosted in Klaviyo, https.
  const imageProblems: string[] = []
  for (const src of new Set(attr(c.html, 'img', 'src')))
    if (!/^https:\/\//i.test(src) || !klaviyoImageHost.test(hostOf(src) ?? ''))
      imageProblems.push(
        `An image is not hosted in Klaviyo (${src.slice(0, 80)}). Upload it to Klaviyo first.`
      )
  add('images', imageProblems)

  // 11. Footer: Klaviyo's required tags.
  const footerProblems: string[] = []
  if (!/\{%\s*unsubscribe\b/.test(c.html))
    footerProblems.push('The unsubscribe link is missing.')
  if (!/\{\{\s*organization\.full_address\s*\}\}/.test(c.html))
    footerProblems.push('The store address is missing.')
  add('footer', footerProblems)

  return { pass: checks.every((x) => x.pass), checks }
}
