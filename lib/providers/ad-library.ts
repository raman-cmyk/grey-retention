/**
 * The brand's live ads, as the Meta Ad Library shows them (ONB-104, D23).
 *
 * `AdLibrary` is the port: a source answers with the active ads it finds
 * for a brand, or says why it could not. `ownAds` keeps only what the
 * Ads analyst may read: the brand's own page, active ads, at most
 * `maxAds`, each text capped. The sample library serves sample ads for the
 * synthetic brands (`*.example` only); it never invents an ad for a real
 * brand. A live library (Meta's official Ad Library API, a public-page
 * reader or a paid service) is not built yet: which one is the owner's
 * choice, and until then a real brand's ads are not read (logged and
 * skipped, D16).
 */

export type AdMedia = 'image' | 'video' | 'carousel' | 'unknown'

export type LibraryAd = {
  /** The Ad Library's id (digits). */
  id: string
  pageId: string
  pageName: string
  /** When the ad started running (ISO). */
  startedAt: string
  active: boolean
  /** The ad's main texts, its link titles and descriptions. */
  texts: string[]
  titles: string[]
  descriptions: string[]
  /** Where the ad sends people, when it has a link. */
  linkUrl: string | null
  /** Where it runs: facebook, instagram, messenger, audience_network. */
  platforms: string[]
  media: AdMedia
}

export type AdQuery = {
  brandName: string
  /** The brand's own domain, lower case, without `www.`. */
  domain: string
  /** Aborted when the read stops waiting for the answer. */
  signal?: AbortSignal
}

export type AdLibraryAnswer =
  | { ok: true; ads: LibraryAd[] }
  | {
      ok: false
      /**
       * `not_set_up`: no library reads this brand (a real brand, until the
       * owner chooses a live one); `refused`: the library will not answer
       * this question; `unavailable` / `rate_limited`: try again later.
       */
      code: 'not_set_up' | 'refused' | 'unavailable' | 'rate_limited'
      retryAfterSeconds?: number
    }

export type AdLibrary = {
  /** False for the sample library: its ads are not a real brand's. */
  live: boolean
  activeAds(query: AdQuery): Promise<AdLibraryAnswer>
}

/** Ads one read keeps, newest first. */
export const maxAds = 30
/** Texts of each kind one ad keeps, and the length of each. */
export const maxTexts = 4
export const maxText = 600

/** An ad's own page in the Ad Library: the evidence for what it says. */
export const adLibraryUrl = (id: string) =>
  `https://www.facebook.com/ads/library/?id=${id}`

export const adId = /^[0-9]{1,25}$/

/** The host of an https link on the standard port, lower case; else null. */
export function httpsHost(url: string | null): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:' || u.port || u.username || u.password)
      return null
    return u.hostname.toLowerCase()
  } catch {
    return null
  }
}

/** A link as a browser reads it, when it fits (500 characters). */
const normalised = (url: string) => {
  const href = new URL(url).href
  return href.length <= 500 ? href : null
}

/** The brand's domain or one of its subdomains (never a look-alike). */
export const onDomain = (host: string | null, domain: string) =>
  !!host && (host === domain || host.endsWith(`.${domain}`))

/**
 * Text as an ad shows it: no control, zero-width or direction characters,
 * one space, capped.
 */
const clean = (texts: string[]) =>
  [
    ...new Set(
      texts
        .map((t) =>
          t
            .replace(/[\u0000-\u001f\u007f]+/g, ' ')
            .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g, '')
        )
        .map((t) => t.replace(/\s+/g, ' ').trim().slice(0, maxText))
        .filter(Boolean)
    )
  ].slice(0, maxTexts)

/** A name as compared: lower case letters and digits only. */
const squashed = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Whether a page's name is the brand's ("Cedar Lane" for "Cedar Lane Co"). */
export function namedLike(pageName: string, brandName: string) {
  const page = squashed(pageName)
  const brand = squashed(brandName)
  if (page.length < 3 || brand.length < 3) return false
  return page.includes(brand) || brand.includes(page)
}

/**
 * The brand's own page among the ads: of the pages whose live ads send
 * people to the brand's own domain, those named like the brand first, then
 * the one with the most such ads (each ad counted once). Null when there is
 * none, or two pages are equally likely (never a guess).
 */
export function ownPage(
  ads: LibraryAd[],
  domain: string,
  brandName: string
): string | null {
  const linking = new Map<string, Set<string>>()
  const named = new Map<string, boolean>()
  for (const ad of ads)
    if (
      ad.active &&
      adId.test(ad.id) &&
      onDomain(httpsHost(ad.linkUrl), domain)
    ) {
      linking.set(ad.pageId, (linking.get(ad.pageId) ?? new Set()).add(ad.id))
      named.set(
        ad.pageId,
        (named.get(ad.pageId) ?? false) || namedLike(ad.pageName, brandName)
      )
    }
  const ranked = [...linking.entries()]
    .map(([page, ids]) => ({ page, named: named.get(page)!, count: ids.size }))
    .sort((a, b) => Number(b.named) - Number(a.named) || b.count - a.count)
  const [first, second] = ranked
  if (!first) return null
  if (second && second.named === first.named && second.count === first.count)
    return null
  return first.page
}

/**
 * The ads the Ads analyst reads: only the brand's own page (`ownPage`: a
 * reseller's or an affiliate's page linking to the brand too is left out),
 * only active ads, each once, newest first, at most `maxAds`, each text
 * cleaned and capped. A link that is not https on the brand's own domain
 * is dropped (the ad stays); one kept is as a browser reads it.
 */
export function ownAds(
  ads: LibraryAd[],
  domain: string,
  brandName: string
): LibraryAd[] {
  const page = ownPage(ads, domain, brandName)
  if (!page) return []
  const seen = new Set<string>()
  return ads
    .filter((ad) => {
      if (!ad.active || ad.pageId !== page || !adId.test(ad.id)) return false
      if (seen.has(ad.id)) return false
      seen.add(ad.id)
      return true
    })
    .sort(
      (a, b) =>
        Date.parse(b.startedAt) - Date.parse(a.startedAt) ||
        a.id.localeCompare(b.id)
    )
    .slice(0, maxAds)
    .map((ad) => ({
      ...ad,
      pageName: ad.pageName.slice(0, 120),
      texts: clean(ad.texts),
      titles: clean(ad.titles),
      descriptions: clean(ad.descriptions),
      // As a browser reads it (the host lower case, no default port), so
      // the database checks the same address.
      linkUrl:
        ad.linkUrl && onDomain(httpsHost(ad.linkUrl), domain)
          ? normalised(ad.linkUrl)
          : null,
      platforms: [...new Set(ad.platforms)].slice(0, 6)
    }))
}

const titleCase = (label: string) =>
  label
    .split('-')
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ')

/**
 * Sample ads for a synthetic brand (`*.example`): an offer, free shipping,
 * a gift angle and a video, all on the brand's own page, plus an ended ad
 * and a reseller's ad that `ownAds` leaves out. A brand named `no-ads…`
 * runs none.
 */
export function sampleAds(domain: string): LibraryAd[] {
  const host = domain.trim().toLowerCase()
  const label = host.split('.')[0] ?? ''
  if (label.startsWith('no-ads')) return []
  const name = titleCase(label)
  const page = '100000000000001'
  const ad = (
    n: number,
    over: Partial<LibraryAd> & Pick<LibraryAd, 'texts'>
  ): LibraryAd => ({
    id: `90000000000000${n}`,
    pageId: page,
    pageName: name,
    startedAt: `2026-11-0${n}T09:00:00Z`,
    active: true,
    titles: [],
    descriptions: [],
    linkUrl: `https://${host}/`,
    platforms: ['facebook', 'instagram'],
    media: 'image',
    ...over
  })
  return [
    ad(1, {
      texts: [
        `The weekend sale is on: 20% off every knit. Soft, warm layers from ${name}.`
      ],
      titles: ['20% off knitwear'],
      linkUrl: `https://${host}/collections/knitwear?utm_source=meta`
    }),
    ad(2, {
      texts: [
        'Free shipping on orders over $75. Everyday layers made to last.'
      ],
      titles: ['Shop the new layers']
    }),
    ad(3, {
      texts: [
        'A gift she will wear every day: the Weekend Knit, in undyed wool.'
      ],
      titles: ['Gifts for her'],
      linkUrl: `https://${host}/products/weekend-knit`,
      media: 'carousel'
    }),
    ad(4, {
      texts: [
        'See how the Field Overshirt is made, from organic cotton twill to the last button.'
      ],
      linkUrl: `https://${host}/products/field-overshirt`,
      media: 'video',
      platforms: ['instagram']
    }),
    // An ended ad: not live.
    ad(5, {
      texts: ['Summer sale: 40% off everything.'],
      active: false,
      startedAt: '2026-06-01T09:00:00Z'
    }),
    // A reseller's page linking to the brand: not the brand's own page.
    ad(6, {
      texts: ['We stock the Weekend Knit. 50% off today only.'],
      pageId: '100000000000999',
      pageName: 'Reseller Outlet'
    })
  ]
}

/** The sample library: sample ads for a synthetic brand only. */
export const sampleAdLibrary: AdLibrary = {
  live: false,
  async activeAds({ domain }) {
    if (!domain.trim().toLowerCase().endsWith('.example'))
      return { ok: false, code: 'not_set_up' }
    return { ok: true, ads: sampleAds(domain) }
  }
}

/**
 * The library a read uses, by the job's mode (set when it was started):
 * the sample library for a synthetic brand (which reads `*.example` only);
 * for a real brand none yet (`not_set_up`), until the owner chooses how the
 * live Ad Library is read.
 */
export function adLibraryFor(mode: 'sample' | 'live'): AdLibrary {
  if (mode === 'sample') return sampleAdLibrary
  return {
    live: true,
    async activeAds() {
      return { ok: false, code: 'not_set_up' }
    }
  }
}
