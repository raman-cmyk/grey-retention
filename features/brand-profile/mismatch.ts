/**
 * Brand-mismatch guard (OWNER_JOURNEYS §0.1 and §18 decision 6): the old
 * workspace ran on another brand's data for months. Warn when the Brand
 * profile does not look like the connected Klaviyo account or Shopify store.
 * It is a warning only: the owner decides, and can ignore it when both are
 * right.
 */
export type MismatchInput = {
  brandName: string
  website: string
  klaviyoAccount: string | null
  shopDomain: string | null
}
export type Mismatch = { source: 'klaviyo' | 'shopify'; message: string }

const filler = new Set([
  'the',
  'and',
  'co',
  'inc',
  'ltd',
  'llc',
  'shop',
  'store',
  'studio',
  'brand',
  'official',
  'demo',
  'synthetic',
  'sample',
  'company'
])

/** Lowercase words (any script), without filler words. */
export function nameWords(text: string) {
  return new Set(
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 2 && !filler.has(word))
  )
}

const secondLevel = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'edu'])

/**
 * The name part of a website or store address:
 * "https://www.cedar-lane.example/shop" → "cedar-lane",
 * "shop.cedarlane.co.uk" → "cedarlane", "cedar-lane.myshopify.com" →
 * "cedar-lane".
 */
export function siteName(website: string) {
  const host = website
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/[/?#:].*$/, '')
  if (host.endsWith('.myshopify.com'))
    return host.slice(0, -'.myshopify.com'.length)
  const parts = host.split('.').filter(Boolean)
  if (parts.length > 1) parts.pop()
  if (parts.length > 1 && secondLevel.has(parts.at(-1)!)) parts.pop()
  return parts.at(-1) ?? ''
}

const squash = (words: Set<string>) => [...words].join('')
const subset = (a: Set<string>, b: Set<string>) =>
  [...a].every((word) => b.has(word))

/**
 * Same brand when every distinctive word of one name is in the other
 * ("Cedar Lane" / "Cedar Lane Outfitters"), when the names run together
 * ("Cedar Lane" / "cedarlane"), or when one is the other's initials
 * ("Cedar Lane" / "cl-outfitters").
 */
export function sameName(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return true
  if (subset(a, b) || subset(b, a)) return true
  if (squash(a) === squash(b)) return true
  for (const [x, y] of [
    [a, b],
    [b, a]
  ] as const) {
    if (x.size < 2) continue
    const initials = [...x].map((word) => word[0]).join('')
    if (y.has(initials)) return true
    // A run-together name inside the other ("cedarlane" in "cedarlanegoods").
    if ([...y].some((word) => word === squash(x))) return true
  }
  return false
}

export function brandMismatches(input: MismatchInput): Mismatch[] {
  const name = nameWords(input.brandName)
  const site = nameWords(siteName(input.website))
  // Compare with the brand name; the website only stands in when the name
  // has nothing distinctive (a correct website must not hide a wrong name).
  const brand = name.size ? name : site
  if (!brand.size) return []
  const label = input.brandName.trim() || siteName(input.website)
  const found: Mismatch[] = []
  if (input.klaviyoAccount) {
    const account = nameWords(input.klaviyoAccount)
    const domainLike = nameWords(siteName(input.klaviyoAccount))
    if (!sameName(brand, account) && !sameName(brand, domainLike))
      found.push({
        source: 'klaviyo',
        message: `Your Brand profile says “${label}”, but the connected Klaviyo account is “${input.klaviyoAccount}”. Check that the profile describes this brand before the AI writes anything.`
      })
  }
  if (input.shopDomain) {
    const shop = nameWords(siteName(input.shopDomain))
    if (!sameName(brand, shop) && !(site.size && sameName(site, shop)))
      found.push({
        source: 'shopify',
        message: `Your Brand profile says “${label}”, but the connected Shopify store is ${input.shopDomain}. Check that the profile and product catalogue belong to this store.`
      })
  }
  return found
}
