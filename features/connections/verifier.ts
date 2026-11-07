import 'server-only'

/**
 * Checks an account before the Connections screen saves it. Only a sample
 * implementation exists: it makes no network call and never receives the
 * secret, only its masked hint. A live Klaviyo/Shopify verifier needs the
 * owner's OK, a reviewed contract and encrypted credential storage first.
 */
export interface ConnectionVerifier {
  readonly live: boolean
  klaviyo(input: {
    keyHint: string
    workspaceLabel: string
    workspaceTimezone: string
    /** The Brand profile's website, when it has one. */
    workspaceWebsite: string | null
  }): Promise<AccountReport & { templateCount: number; timezone: string }>
  shopify(input: {
    shopDomain: string
    tokenHint: string
  }): Promise<AccountReport>
}

/**
 * What an account says about the business it belongs to (UIR-021: the
 * brand-mismatch guard compares it with the Brand profile).
 */
export type AccountReport = {
  accountLabel: string
  /** The organisation's website (Klaviyo), as https://… */
  website: string | null
  /** ISO 4217, e.g. USD. */
  currency: string | null
  /** ISO 3166-1 alpha-2, e.g. US. */
  country: string | null
}

/** Sample keys and tokens ending in this connect to ANOTHER brand's account. */
export const OTHER_BRAND_SUFFIX = '0000'
/** The other brand's sample account (a mismatch fixture, never real). */
export const OTHER_BRAND_ACCOUNT = {
  accountLabel: 'Northwind Outdoor (sample)',
  website: 'https://northwind-outdoor.example',
  currency: 'EUR',
  country: 'DE',
  timezone: 'Europe/Berlin'
}
/** What the matching sample accounts report. */
const SAMPLE_CURRENCY = 'USD'
const SAMPLE_COUNTRY = 'US'

/** Templates in the sample Klaviyo account (fixture data, not a real pull). */
export const SAMPLE_TEMPLATE_COUNT = 24

export class SampleConnectionVerifier implements ConnectionVerifier {
  readonly live = false
  async klaviyo({
    keyHint,
    workspaceLabel,
    workspaceTimezone,
    workspaceWebsite
  }: {
    keyHint: string
    workspaceLabel: string
    workspaceTimezone: string
    workspaceWebsite: string | null
  }) {
    if (keyHint.endsWith(OTHER_BRAND_SUFFIX))
      return { ...OTHER_BRAND_ACCOUNT, templateCount: SAMPLE_TEMPLATE_COUNT }
    return {
      accountLabel: workspaceLabel.slice(0, 200),
      templateCount: SAMPLE_TEMPLATE_COUNT,
      // The sample account reports the workspace's own timezone and website.
      timezone: workspaceTimezone,
      website: workspaceWebsite,
      currency: SAMPLE_CURRENCY,
      country: SAMPLE_COUNTRY
    }
  }
  async shopify({
    shopDomain,
    tokenHint
  }: {
    shopDomain: string
    tokenHint: string
  }) {
    const other = tokenHint.endsWith(OTHER_BRAND_SUFFIX)
    return {
      accountLabel: shopDomain,
      website: null,
      currency: other ? OTHER_BRAND_ACCOUNT.currency : SAMPLE_CURRENCY,
      country: other ? OTHER_BRAND_ACCOUNT.country : SAMPLE_COUNTRY
    }
  }
}

/** The sample verifier in fake mode (the default); nothing otherwise. */
export function connectionVerifier(
  mode: string | undefined = process.env.ADAPTER_MODE
): ConnectionVerifier | null {
  return (mode ?? 'fake') === 'fake' ? new SampleConnectionVerifier() : null
}
