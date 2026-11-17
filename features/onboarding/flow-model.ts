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
 * Brand is confirmed only once the website was read (VISION section 5).
 * While the read is queued or under way, Brand waits (`waiting`): it is not
 * done and not Now, and the owner goes on with the steps after it (the
 * readers run a few times a day, so a read can take hours). Once the read
 * is done or failed, Brand is Now again.
 *
 * The step that is Now is the first one neither done nor waiting; coming
 * back opens it. A done or waiting step can be opened again; a step ahead
 * cannot. With only a waiting Brand left, nothing is Now: the finish opens
 * and says the brand comes once the website is read. Finishing is its own
 * saved mark, set only once every step is done (`allDone`).
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
  /**
   * The website's read is queued or under way (the Site reader's newest
   * read): Brand waits for it. Unknown counts as not reading.
   */
  siteReading?: boolean
  /**
   * The workspace has its onboarding row: made after UI-ONBa. One from
   * before has none and is never sent to setup.
   */
  tracked?: boolean
}

export type SetupFlow = {
  steps: {
    key: SetupStepKey
    name: string
    done: boolean
    /** Not done, and waiting for a read: Brand while its website is read. */
    waiting: boolean
  }[]
  /**
   * The index of the step that is Now: the first neither done nor waiting;
   * the number of steps when none is left (all done, or only a waiting one).
   */
  current: number
  /** Every step done: only then can setup be finished. */
  allDone: boolean
  finished: boolean
  /** The workspace goes through onboarding (it has its row). */
  tracked: boolean
}

const host = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/

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
  const steps = setupSteps.map((s) => ({
    ...s,
    done: done[s.key],
    waiting:
      s.key === 'brand' && done.store && !done.brand && !!records.siteReading
  }))
  const now = steps.findIndex((s) => !s.done && !s.waiting)
  return {
    steps,
    current: now === -1 ? steps.length : now,
    allDone: steps.every((s) => s.done),
    finished: records.finished,
    tracked: records.tracked ?? false
  }
}

/**
 * Where the screen opens: the step asked for when it is done, waiting or
 * Now (going back), else the step that is Now, or the finish once no step
 * is left (every step done, or only a waiting Brand). A step ahead of Now
 * is never opened.
 */
export function openPlace(flow: SetupFlow, asked?: string | null): SetupPlace {
  const index = flow.steps.findIndex((s) => s.key === asked)
  if (index !== -1 && index <= flow.current) return flow.steps[index]!.key
  return flow.steps[flow.current]?.key ?? 'finish'
}
