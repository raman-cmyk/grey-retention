/**
 * Klaviyo READ port: a read-only snapshot of one workspace's Klaviyo account
 * for the dashboard (§3) and the detail pages (§4) of docs/UI_REBUILD_SPEC.md.
 * The fake (`fake-klaviyo-read.ts`) returns labelled sample data. A live
 * adapter must read a tenant-scoped snapshot written by the sync job, never
 * call Klaviyo during a page request.
 *
 * Money is in minor units of the ONE account currency, so every card shows
 * the same currency (docs/OWNER_JOURNEYS.md §3 fix).
 */

export type Money = { minor: number; currency: string }

export type KlaviyoAccount = {
  organization: string
  industry: string
  timezone: string
  currency: string
  locale: string
  /** Public key with the middle masked, e.g. `pk_SAMP••••••••0000`. */
  maskedKey: string
}

export type AudienceRef = { id: string; name: string; kind: 'list' | 'segment' }

export type KlaviyoList = {
  id: string
  name: string
  optIn: 'single' | 'double'
  profileCount: number
  created: string
  updated: string
}

export type KlaviyoSegment = {
  id: string
  name: string
  starred: boolean
  active: boolean
  profileCount: number
  /** The rules in plain English (§18.9); the raw definition stays in Advanced. */
  rules: string
  definition: Record<string, unknown>
  created: string
  updated: string
}

export type CampaignStats = {
  recipients: number
  opens: number
  clicks: number
  orders: number
  revenue: Money
}

export type KlaviyoCampaign = {
  id: string
  name: string
  /** Sent in each recipient's local timezone. */
  localTime: boolean
  /** Klaviyo's send strategy: a fixed time, Smart Send Time, or throttled. */
  sendStrategy: 'static' | 'smart' | 'throttled'
  fromEmail: string
  status: 'sent' | 'scheduled' | 'draft' | 'cancelled'
  sendTime: string | null
  subject: string
  previewText: string
  fromLabel: string
  included: AudienceRef[]
  excluded: AudienceRef[]
  /** Attributed revenue in the last 30 days, or null if it never sent. */
  revenue30d: Money | null
  stats: CampaignStats | null
  templateName: string
  html: string
  created: string
  updated: string
}

export type FlowMessage = {
  id: string
  name: string
  subject: string
  status: 'live' | 'draft'
  fromLabel: string
  fromEmail: string
  replyTo: string | null
  previewText: string
  templateUpdated: string
  /** Wait before this email, in seconds (0 = right away). */
  delaySeconds: number
  /** Days the wait may end on (e.g. ['monday']); null means any day. */
  daysOfWeek: string[] | null
  templateName: string
  html: string
}

export type KlaviyoFlow = {
  id: string
  name: string
  status: 'live' | 'draft'
  trigger: { kind: 'metric' | 'list'; name: string }
  revenue30d: Money
  messages: FlowMessage[]
  created: string
  updated: string
}

export type KlaviyoMetric = {
  id: string
  name: string
  integration: 'Klaviyo' | 'Shopify'
  category: 'Internal' | 'eCommerce'
  /** Plain English, e.g. "Someone completed a purchase." */
  measures: string
  events30d: number
  created: string
}

export type DailyRevenue = { date: string; revenue: Money }

/**
 * PICK-101 (list hygiene): when a person last did something. An ISO time;
 * `never` when Klaviyo has the data and it shows none; `unknown` when
 * there is no data to tell (never read as "never").
 */
export type LastSeen = string | 'never' | 'unknown'

/** Why Klaviyo will not email a person (it skips them by itself). */
export type Suppression =
  | 'hard_bounce'
  | 'invalid_email'
  | 'spam_complaint'
  | 'unsubscribed'
  | 'user_suppressed'

/** What is known about one person's email life, for list hygiene. */
export type ProfileFacts = {
  /** Null: Klaviyo can email this person. */
  suppression: Suppression | null
  /** The first marketing email this person received. */
  firstEmail: LastSeen
  /** When marketing emails reached this person, newest first; `unknown` without data. */
  emails: readonly string[] | 'unknown'
  lastClick: LastSeen
  /** The last open Klaviyo did not mark as an Apple privacy (machine) open. */
  lastOpen: LastSeen
  /** The last open Klaviyo marked as an Apple privacy open: never engagement. */
  lastPrivacyOpen: LastSeen
  /** `unknown` when the store does not track site visits. */
  lastSiteVisit: LastSeen
  /** `unknown` when the store has no order data in Klaviyo. */
  lastOrder: LastSeen
}

/** `count` people who share the same facts (sample data comes grouped). */
export type ProfileGroup = { facts: ProfileFacts; count: number }

export type KlaviyoSnapshot = {
  account: KlaviyoAccount
  lists: KlaviyoList[]
  segments: KlaviyoSegment[]
  campaigns: KlaviyoCampaign[]
  flows: KlaviyoFlow[]
  metrics: KlaviyoMetric[]
  /** Last 30 days, oldest first, in the account timezone. */
  daily: DailyRevenue[]
  activeSubscribers: { count: number; changePercent: number }
  abandonedCheckouts30d: number
  /**
   * PICK-101: the store's people grouped by what is known about them, so
   * list hygiene can count who it leaves out. Missing: not read.
   */
  profileGroups?: ProfileGroup[]
  /** When the snapshot was last synced from Klaviyo; null for sample data. */
  syncedAt: string | null
}

export interface KlaviyoReadProvider {
  snapshot(input: {
    tenantId: string
    /** The one brand timezone every date is shown in. */
    timezone: string
    now: Date
  }): Promise<KlaviyoSnapshot>
}
