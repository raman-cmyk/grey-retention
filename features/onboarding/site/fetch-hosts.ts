/** The hosts a brand's site may be read from: its domain and `www.`. */
export function siteHosts(domain: string): Set<string> {
  const bare = domain
    .trim()
    .toLowerCase()
    .replace(/^www\./, '')
  return new Set([bare, `www.${bare}`])
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
