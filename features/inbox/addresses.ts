import { createHash } from 'node:crypto'

const gmailDomains = new Set(['gmail.com', 'googlemail.com'])
const slugShape = /^[a-z0-9][a-z0-9-]{1,39}$/
const hostShape =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/

/** "Name <a@b.c>" or "a@b.c" → "a@b.c" (lowercase), or null. */
export function bareAddress(value: string | null | undefined) {
  if (!value) return null
  const angle = /<([^<>\s]+@[^<>\s]+)>/.exec(value)
  const raw = (angle?.[1] ?? value).trim().toLowerCase()
  return /^[^@\s]+@[^@\s]+$/.test(raw) ? raw : null
}

/** Gmail ignores dots in the local part and treats googlemail.com as gmail. */
function canonical(local: string, domain: string) {
  const d = domain === 'googlemail.com' ? 'gmail.com' : domain
  return {
    local: gmailDomains.has(d) ? local.replace(/\./g, '') : local,
    domain: d
  }
}

/**
 * The brand slug from the first recipient that is the inbox's own address
 * with a +tag, e.g. `sampleinbox+northwind@gmail.com` → `northwind`.
 * Recipients are checked in the order given (Delivered-To first).
 */
export function aliasSlug(
  recipients: (string | null | undefined)[],
  base: { local: string; domain: string }
) {
  const want = canonical(base.local.toLowerCase(), base.domain.toLowerCase())
  for (const value of recipients) {
    const address = bareAddress(value)
    if (!address) continue
    const at = address.lastIndexOf('@')
    const name = address.slice(0, at)
    const plus = name.indexOf('+')
    const local = plus < 0 ? name : name.slice(0, plus)
    // Everything after the first +; "a+b+c" is not a valid slug.
    const tag = plus < 0 ? '' : name.slice(plus + 1)
    const got = canonical(local, address.slice(at + 1))
    if (got.local !== want.local || got.domain !== want.domain || !tag) continue
    const slug = tag.toLowerCase()
    if (slugShape.test(slug)) return slug
  }
  return null
}

/** The From domain, lowercase, when it is a real host name. */
export function senderDomain(from: string | null | undefined) {
  const address = bareAddress(from)
  if (!address) return null
  const domain = address.slice(address.lastIndexOf('@') + 1).replace(/\.$/, '')
  return domain.length <= 253 && hostShape.test(domain) ? domain : null
}

const sha256 = (data: string | Uint8Array) =>
  createHash('sha256').update(data).digest('hex')

/**
 * One key per message: the SHA-256 of its normalized Message-ID, or of its
 * raw bytes when it has none. A message re-delivered under a new UID keeps
 * its key, so it is never recorded twice.
 */
export function messageKey(
  messageId: string | null | undefined,
  raw: Uint8Array
) {
  const id = (messageId ?? '').trim().replace(/^<|>$/g, '').toLowerCase()
  return id ? sha256(`message-id:${id}`) : sha256(raw)
}

export { sha256 }
