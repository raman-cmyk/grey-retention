/**
 * Brand-mismatch guard (OWNER_JOURNEYS §0.1 and §18 decision 6): the old
 * workspace ran on another brand's data for months. Warn when the Brand
 * profile does not look like the connected Klaviyo account or Shopify store.
 */
export type MismatchInput = {
  brandName: string
  website: string
  klaviyoAccount: string | null
  shopDomain: string | null
}
export type Mismatch = { source: 'klaviyo' | 'shopify'; message: string }

const stop = new Set([
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
  'goods',
  'company'
])

/** Lowercase words of 3+ letters, without filler words. */
export function nameWords(text: string) {
  return new Set(
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 3 && !stop.has(word))
  )
}

/** "https://www.cedar-lane.example/shop" → "cedar-lane". */
export function siteName(website: string) {
  const host = website
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/^www\./, '')
  return host.replace(/\.myshopify\.com$/, '').split('.')[0] ?? ''
}

function overlaps(a: Set<string>, b: Set<string>) {
  for (const word of a) if (b.has(word)) return true
  // Joined names, e.g. "Cedar Lane" vs "cedarlane".
  const joinedA = [...a].join(''),
    joinedB = [...b].join('')
  return (
    joinedA.length >= 4 &&
    joinedB.length >= 4 &&
    (joinedA.includes(joinedB) || joinedB.includes(joinedA))
  )
}

export function brandMismatches(input: MismatchInput): Mismatch[] {
  const brand = new Set([
    ...nameWords(input.brandName),
    ...nameWords(siteName(input.website))
  ])
  if (brand.size === 0) return []
  const found: Mismatch[] = []
  if (input.klaviyoAccount) {
    const account = nameWords(input.klaviyoAccount)
    if (account.size > 0 && !overlaps(brand, account))
      found.push({
        source: 'klaviyo',
        message: `Your Brand profile says “${input.brandName.trim() || siteName(input.website)}”, but the connected Klaviyo account is “${input.klaviyoAccount}”. Check that the profile describes this brand before the AI writes anything.`
      })
  }
  if (input.shopDomain) {
    const shop = nameWords(siteName(input.shopDomain))
    if (shop.size > 0 && !overlaps(brand, shop))
      found.push({
        source: 'shopify',
        message: `Your Brand profile says “${input.brandName.trim() || siteName(input.website)}”, but the connected Shopify store is ${input.shopDomain}. Check that the profile and product catalogue belong to this store.`
      })
  }
  return found
}
