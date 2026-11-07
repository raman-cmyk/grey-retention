/** "https://www.Northwind.example/shop" → "northwind.example". */
export function trackedDomainOf(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/^www\./, '')
    .replace(/\.$/, '')
}

/** A host name made of labels, like brand.com (no spaces or @). */
export const domainShape =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/

/** Sample workspaces can only follow fictional `.example` domains. */
export const isSampleDomain = (domain: string) => domain.endsWith('.example')
