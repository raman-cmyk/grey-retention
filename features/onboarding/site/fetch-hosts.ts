/** The brand's plain domain: lower case, without `www.`. */
export const bareDomain = (domain: string) =>
  domain
    .trim()
    .toLowerCase()
    .replace(/^www\./, '')

/**
 * The hosts a brand's site may be read from: its domain and its own
 * subdomains (`www.`, `shop.`…), never a look-alike (`evilbrand.com`,
 * `brand.com.evil.com`).
 */
export function siteHosts(domain: string): {
  domain: string
  has: (host: string) => boolean
} {
  const bare = bareDomain(domain)
  return {
    domain: bare,
    has: (host) => {
      const h = host.toLowerCase()
      return !!bare && (h === bare || h.endsWith(`.${bare}`))
    }
  }
}

/** The brand's home page, or null when the domain is not a plain host. */
export function homeUrl(domain: string): string | null {
  const bare = domain.trim().toLowerCase()
  if (
    !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(
      bare
    )
  )
    return null
  return `https://${bare}/`
}
