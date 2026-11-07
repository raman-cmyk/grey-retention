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
  }): Promise<{
    accountLabel: string
    templateCount: number
    /** The account's timezone (UIR-023: it becomes the brand timezone). */
    timezone: string
  }>
  shopify(input: {
    shopDomain: string
    tokenHint: string
  }): Promise<{ accountLabel: string }>
}

/** Templates in the sample Klaviyo account (fixture data, not a real pull). */
export const SAMPLE_TEMPLATE_COUNT = 24

export class SampleConnectionVerifier implements ConnectionVerifier {
  readonly live = false
  async klaviyo({
    workspaceLabel,
    workspaceTimezone
  }: {
    workspaceLabel: string
    workspaceTimezone: string
  }) {
    return {
      accountLabel: workspaceLabel.slice(0, 200),
      templateCount: SAMPLE_TEMPLATE_COUNT,
      // The sample account reports the workspace's own timezone.
      timezone: workspaceTimezone
    }
  }
  async shopify({ shopDomain }: { shopDomain: string }) {
    return { accountLabel: shopDomain }
  }
}

/** The sample verifier in fake mode (the default); nothing otherwise. */
export function connectionVerifier(
  mode: string | undefined = process.env.ADAPTER_MODE
): ConnectionVerifier | null {
  return (mode ?? 'fake') === 'fake' ? new SampleConnectionVerifier() : null
}
