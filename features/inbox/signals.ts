/**
 * What an inbox email asks of us (INB-004): a double-opt-in confirmation
 * ("please confirm your subscription", with its confirm link) or a notice
 * that we were unsubscribed. Fixed English rules, kept strict: a win-back
 * ("we miss you"), a sunset warning ("you will be removed unless…") or a
 * welcome offer is an ordinary newsletter. Nothing is clicked here.
 */

export type InboxSignal =
  { signal: 'opt_in'; confirmUrl: string | null } | { signal: 'unsubscribed' }

/** A confirmation asks to confirm the subscription or the address. */
const optInWords =
  /\bconfirm (your |my )?(subscription|e-?mail( address)?|sign[ -]?up)\b|\bplease confirm\b|\bverify your e-?mail( address)?\b|\bdouble opt-?in\b|\bactivate your subscription\b|\bconfirm (that )?you want to (subscribe|receive|hear)/i
/** A notice says it is done: we were unsubscribed or removed. */
const unsubscribedWords =
  /\byou('ve| have) been (successfully )?unsubscribed\b|\byou('re| are) (now )?unsubscribed\b|\bunsubscribe(d)? (confirmation|successful|complete)\b|\bsuccessfully unsubscribed\b|\byou('ve| have) been removed from (our|the|this) (mailing |e-?mail )?list\b/i
/**
 * Win-back and sunset words ("we miss you", "you will be removed unless…",
 * "20% off"): an email with these is a newsletter, not a notice that we
 * were unsubscribed. (A confirmation may still offer a discount.)
 */
const notNotice =
  /\d{1,2}\s?% off|\bcode\b|\bshop (now|the)\b|\bwe miss you\b|\bwill be (removed|unsubscribed)\b|\bif (we|you) do(n'|n’)?t\b|\bunless you\b|\bsale\b/i
/** A confirm link says so in its words or its address. */
const confirmText =
  /\bconfirm\b|\bverify\b|\byes,? (subscribe|sign me up|count me in)\b|\bsubscribe me\b/i
const confirmHref =
  /confirm|verify|opt-?in|\/subscriptions?\/(subscribe|confirm)|\/subscribe\/confirm/i
const notConfirm =
  /unsubscribe|preferences|privacy|view (it |this )?(in (your )?browser|online)/i

/** Links in the HTML: href and visible words, read tag by tag. */
export function linksIn(html: string) {
  const out: { href: string; text: string }[] = []
  for (const m of html
    .slice(0, 300_000)
    .matchAll(
      /<a\b[^<>]*?\bhref\s*=\s*("([^"]*)"|'([^']*)')[^<>]*>((?:[^<]|<(?!\/a\b)[^<>]{0,200}>){0,300})/gi
    ))
    out.push({
      href: (m[2] ?? m[3] ?? '').replace(/&amp;/gi, '&').trim(),
      text: (m[4] ?? '')
        .replace(/<[^<>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    })
  return out
}

/** The link as the database keeps it: https, parsed and re-written. */
function cleanLink(href: string) {
  try {
    const url = new URL(href)
    return url.protocol === 'https:' && url.href.length <= 2000
      ? url.href
      : null
  } catch {
    return null
  }
}

export function inboxSignal(email: {
  subject: string
  text: string
  html: string | null
}): InboxSignal | null {
  const head = `${email.subject}\n${email.text.slice(0, 1_500)}`
  if (
    unsubscribedWords.test(head) &&
    !notNotice.test(`${email.subject}\n${email.text.slice(0, 5_000)}`)
  )
    return { signal: 'unsubscribed' }
  if (!optInWords.test(head)) return null
  for (const l of linksIn(email.html ?? '')) {
    const href = cleanLink(l.href)
    if (
      href &&
      (confirmText.test(l.text) || confirmHref.test(href)) &&
      !notConfirm.test(l.text) &&
      !notConfirm.test(href)
    )
      return { signal: 'opt_in', confirmUrl: href }
  }
  return { signal: 'opt_in', confirmUrl: null }
}

/**
 * Hosts a confirm link may point to, and every redirect after it may pass
 * through, and still be opened by the worker: the brand's own domain (or a
 * subdomain), a sender domain registered for it, or the confirm and
 * tracking domains of a well-known email service. Hosts where anyone can
 * publish a page (ck.page, mailchi.mp) are not on the list. Anything else
 * goes to a person.
 */
export const emailServiceHosts = [
  'kmail-lists.com',
  'klaviyo.com',
  'klclick.com',
  'klclick1.com',
  'klclick2.com',
  'klclick3.com',
  'list-manage.com',
  'mailchimp.com',
  'omnisend.com',
  'omnisrv.com',
  'shopifyemail.com',
  'mailerlite.com',
  'convertkit.com',
  'brevo.com',
  'sendinblue.com',
  'attentivemobile.com',
  'postscript.io'
]

const within = (host: string, domain: string) =>
  host === domain || host.endsWith(`.${domain}`)

/** Whether the worker may open a link on this host for this brand. */
export function trustedHost(
  host: string,
  brand: { domain: string; senders: string[] }
) {
  const h = host.toLowerCase()
  return [brand.domain, ...brand.senders, ...emailServiceHosts].some((d) =>
    within(h, d.toLowerCase())
  )
}

export function clickableHost(
  url: string,
  brand: { domain: string; senders: string[] }
): string | null {
  let host: string
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password)
      return null
    host = parsed.hostname.toLowerCase()
  } catch {
    return null
  }
  return trustedHost(host, brand) ? host : null
}
