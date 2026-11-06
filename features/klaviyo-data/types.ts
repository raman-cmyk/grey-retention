/**
 * Read-only view of a brand's Klaviyo account, used by the dashboard (§3)
 * and the Klaviyo detail pages (§4) of docs/UI_REBUILD_SPEC.md. Money is in
 * minor units (cents) of the ONE account currency, so every card shows the
 * same currency (docs/OWNER_JOURNEYS.md §3 fix).
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
  delay: string
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
  created: string
}

export type DailyRevenue = { date: string; revenue: Money }

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
  syncedAt: string
}

/** Where the numbers come from; "sample" is always shown to the owner. */
export type KlaviyoData =
  { state: 'sample'; snapshot: KlaviyoSnapshot } | { state: 'not_connected' }
