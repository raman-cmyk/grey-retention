/**
 * Brand-mismatch guard (OWNER_JOURNEYS §0.1 and §18 decision 6): the old
 * workspace ran on another brand's data for months. Warn when the Brand
 * profile does not look like the connected Klaviyo account or Shopify store.
 * It is a warning only: the owner decides, and can ignore it when both are
 * right.
 */
/** What a connected account reported when it was connected (UIR-021). */
export type AccountFacts = {
  website: string | null
  currency: string | null
  country: string | null
}
export type MismatchInput = {
  brandName: string
  website: string
  klaviyoAccount: string | null
  shopDomain: string | null
  /** The Klaviyo organisation's website, currency and country. */
  klaviyo?: AccountFacts | null
  /** The Shopify store's currency and country. */
  shopify?: AccountFacts | null
  /** Product page links in the catalogue. */
  productUrls?: string[]
}
export type Mismatch = {
  source: 'klaviyo' | 'shopify' | 'catalogue'
  message: string
}

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

/** "www.cedar-lane.example" → "cedar-lane.example"; null when not a web address. */
export function hostOf(url: string | null | undefined) {
  if (!url) return null
  try {
    const parsed = new URL(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`)
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
    return host.includes('.') ? host : null
  } catch {
    return null
  }
}

/** Two web addresses belong to the same site (subdomains included). */
const sameSite = (a: string, b: string) =>
  a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`)

/**
 * The site most catalogue links point to, when it is not the brand's own
 * website (or its Shopify store) and at least half the links go there.
 */
export function catalogueElsewhere(
  productUrls: string[],
  website: string | null,
  shopDomain: string | null
) {
  const own = [hostOf(website), hostOf(shopDomain)].filter((h): h is string =>
    Boolean(h)
  )
  const hosts = productUrls.map(hostOf).filter((h): h is string => Boolean(h))
  if (!own.length || hosts.length < 2) return null
  const elsewhere = hosts.filter((h) => !own.some((o) => sameSite(h, o)))
  if (elsewhere.length * 2 < hosts.length) return null
  const counts = new Map<string, number>()
  for (const h of elsewhere) counts.set(h, (counts.get(h) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0]
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
  // The website the Klaviyo organisation reported.
  const brandHost = hostOf(input.website)
  const klaviyoHost = hostOf(input.klaviyo?.website)
  if (brandHost && klaviyoHost && !sameSite(brandHost, klaviyoHost))
    found.push({
      source: 'klaviyo',
      message: `Your Brand profile’s website is ${brandHost}, but the connected Klaviyo account’s website is ${klaviyoHost}.`
    })
  // Klaviyo and Shopify should be the same business.
  const k = input.klaviyo
  const s = input.shopify
  if (k && s) {
    if (k.currency && s.currency && k.currency !== s.currency)
      found.push({
        source: 'shopify',
        message: `Klaviyo reports amounts in ${k.currency}, but the Shopify store sells in ${s.currency}. Check that both accounts belong to this brand.`
      })
    if (k.country && s.country && k.country !== s.country)
      found.push({
        source: 'shopify',
        message: `The Klaviyo account is in ${k.country}, but the Shopify store is in ${s.country}. Check that both accounts belong to this brand.`
      })
  }
  const other = catalogueElsewhere(
    input.productUrls ?? [],
    input.website,
    input.shopDomain
  )
  if (other)
    found.push({
      source: 'catalogue',
      message: `Most products in your catalogue link to ${other}, not to ${brandHost ?? 'your website'}. Check that the catalogue belongs to this brand before the AI uses it.`
    })
  return found
}
