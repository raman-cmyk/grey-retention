import type { KlaviyoState } from '@/features/settings/read-model'

/**
 * The onboarding flow (UI-ONBa, docs/design/BRAND.md StepCard): five steps,
 * Store, Brand, Klaviyo, Discount and Rivals. A step is done only by a
 * saved record, never a browser flag:
 *
 * - Store: the brand's website is saved (`brand_profiles.domain`, read as
 *   the readers read it, `siteDomain`).
 * - Brand: the owner confirmed what GROS found on that same website
 *   (`onboarding_steps.brand_site`); a website changed later needs a new
 *   look (the database clears the mark when the website changes).
 * - Klaviyo: connected and working, as Settings judges it (`klaviyoWorking`;
 *   the database also refuses a live connection without its active key).
 *   It cannot be skipped: every plan and email reads the store from it
 *   (VISION section 5 and section 10, "nothing works without it").
 * - Discount: a max discount is saved (0 counts: emails then offer none).
 *   Codes are optional (VISION section 10).
 * - Rivals: at least one brand followed, or the owner's explicit skip.
 *
 * The step that is Now is the first one not done; coming back opens it. A
 * done step can be opened again; a step ahead cannot. Finishing is its own
 * saved mark, set only once every step is done.
 */
export const setupSteps = [
  { key: 'store', name: 'Store' },
  { key: 'brand', name: 'Brand' },
  { key: 'klaviyo', name: 'Klaviyo' },
  { key: 'discount', name: 'Discount' },
  { key: 'rivals', name: 'Rivals' }
] as const

export type SetupStepKey = (typeof setupSteps)[number]['key']
/** What the right side of the screen shows: a step, or the finish. */
export type SetupPlace = SetupStepKey | 'finish'

/** The saved records the steps are read from. */
export type SetupRecords = {
  /** The website as saved (`brand_profiles.domain`); null without a brand. */
  domain: string | null
  /** The website the owner confirmed the brand for (`onboarding_steps`). */
  confirmedSite: string | null
  klaviyoWorking: boolean
  /** A max discount is saved (`brand_offers`). */
  maxDiscountSet: boolean
  /** Brands the workspace follows now. */
  following: number
  rivalsSkipped: boolean
  finished: boolean
}

export type SetupFlow = {
  steps: { key: SetupStepKey; name: string; done: boolean }[]
  /** The index of the step that is Now; the number of steps when all are done. */
  current: number
  allDone: boolean
  finished: boolean
}

const host = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/

/** The longest answer about the brand's voice or rules (the brand profile's own limit). */
export const maxBrandWords = 5000

/** The longest website, in characters: a host name's own limit, here and in the database. */
export const maxWebsite = 253

/**
 * A website as the readers read it (the database's `private.site_domain`):
 * spaces trimmed (only spaces, as its `btrim`), lower case, without
 * `www.`; null unless it is a plain host name of at most `maxWebsite`
 * characters.
 */
export function siteDomain(domain: string | null | undefined): string | null {
  const d = (domain ?? '')
    .replace(/^ +| +$/g, '')
    .toLowerCase()
    .replace(/^www\./, '')
  if (d.length > maxWebsite) return null
  return host.test(d) && !/^[0-9.]+$/.test(d) ? d : null
}

/**
 * The website an owner typed, as it is saved: a link is fine
 * ("https://www.CedarLane.com/shop" is cedarlane.com); null when it holds
 * no plain host name (a name and password, a port, spaces).
 */
export function websiteOf(typed: string): string | null {
  const t = typed.trim().replace(/^https?:\/\//i, '')
  const host = t.replace(/[/?#].*$/, '')
  return host.includes('@') || host.includes(':') ? null : siteDomain(host)
}

/**
 * Klaviyo works for GROS: connected, its key not refused, and with live
 * keys on (KLAVIYO_MODE=live) a real key, not the sample connection. The
 * same rule as the Klaviyo card in Settings.
 */
export function klaviyoWorking(
  klaviyo: KlaviyoState | null,
  liveKeys: boolean
): boolean {
  return (
    !!klaviyo &&
    klaviyo.status === 'connected' &&
    klaviyo.keyStatus !== 'refused' &&
    !(liveKeys && klaviyo.mode !== 'live')
  )
}

/** The five steps from the saved records. Pure. */
export function setupFlow(records: SetupRecords): SetupFlow {
  const site = siteDomain(records.domain)
  const done: Record<SetupStepKey, boolean> = {
    store: site !== null,
    brand: site !== null && records.confirmedSite === site,
    klaviyo: records.klaviyoWorking,
    discount: records.maxDiscountSet,
    rivals: records.following > 0 || records.rivalsSkipped
  }
  const steps = setupSteps.map((s) => ({ ...s, done: done[s.key] }))
  const now = steps.findIndex((s) => !s.done)
  return {
    steps,
    current: now === -1 ? steps.length : now,
    allDone: now === -1,
    finished: records.finished
  }
}

/**
 * Where the screen opens: the step asked for when it is done or Now (going
 * back), else the step that is Now, or the finish once every step is done.
 * A step ahead of Now is never opened.
 */
export function openPlace(flow: SetupFlow, asked?: string | null): SetupPlace {
  const index = flow.steps.findIndex((s) => s.key === asked)
  if (index !== -1 && index <= flow.current) return flow.steps[index]!.key
  return flow.steps[flow.current]?.key ?? 'finish'
}

/**
 * Where `/setup` goes (UI-ONBe): Home only once setup is finished and every
 * step still done (a finished owner who changed his website confirms the
 * brand again first); else the place `openPlace` opens.
 */
export function setupDestination(
  flow: SetupFlow,
  asked?: string | null
): SetupPlace | 'home' {
  if (flow.finished && flow.allDone && !asked) return 'home'
  return openPlace(flow, asked)
}
