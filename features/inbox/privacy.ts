import type { InboxConfig } from './config'
import { cleanEmailHtml } from './privacy-html'
import {
  cleanEmailPreview,
  cleanEmailSubject,
  cleanEmailText,
  type CleanOptions,
  type InboxIdentity
} from './privacy-text'

/**
 * REAL-1b1, Raman's decision of 16 November: a workspace may read a real
 * brand's newsletter, but never a person's name or email address from the
 * inbox. These pure functions clean one captured email (subject, text,
 * preview line and HTML) before any workspace may read it: the text rules
 * are in `privacy-text.ts`, the HTML in `privacy-html.ts`. Every rule is
 * linear on hostile input; HTML the parser would be slow on, or that does
 * not read back as itself once cleaned, is refused.
 */

export {
  cleanEmailHtml,
  cleanEmailPreview,
  cleanEmailSubject,
  cleanEmailText,
  type CleanOptions,
  type InboxIdentity
}
export { privacyLimits } from './privacy-text'
export { settle } from './privacy-html'

/** The identity from the inbox configuration (its address, the names). */
export function inboxIdentity(config: InboxConfig): InboxIdentity {
  const base = config.ready ? config.transport.base : null
  return {
    addresses: [
      ...new Set([
        ...(config.inboxAddresses ?? []),
        ...(base ? [`${base.local}@${base.domain}`] : [])
      ])
    ],
    names: config.subscriberNames ?? [],
    imageHosts: config.imageHosts ?? []
  }
}

export type EmailParts = {
  subject: string
  text: string
  preview: string | null
  html: string | null
}

/**
 * All four parts cleaned. `htmlRefused`: there was HTML but it could not be
 * cleaned safely, so neither it nor a picture made from it may be shown.
 * `changed` when any part differs from what was given.
 */
export function cleanEmail(
  email: EmailParts,
  identity: InboxIdentity,
  options?: CleanOptions
): EmailParts & { htmlRefused: boolean; changed: boolean } {
  const out: EmailParts = {
    subject: cleanEmailSubject(email.subject, identity, options),
    text: cleanEmailText(email.text, identity, options),
    preview:
      email.preview === null
        ? null
        : cleanEmailPreview(email.preview, identity, options),
    html:
      email.html === null ? null : cleanEmailHtml(email.html, identity, options)
  }
  const changed = (Object.keys(out) as (keyof EmailParts)[]).some(
    (k) => out[k] !== email[k]
  )
  return { ...out, htmlRefused: email.html !== null && !out.html, changed }
}
