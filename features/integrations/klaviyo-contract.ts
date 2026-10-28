import type {
  DeliveryPackage,
  DeliveryProvider
} from '@/features/workflow/domain/contracts'
/** Public 2026-07-15 contract draft. No network transport, credentials or account mutation. */
export function klaviyoCampaignRequest(pkg: Readonly<DeliveryPackage>) {
  return {
    data: {
      type: 'campaign',
      attributes: {
        name: `${pkg.campaignId} · package ${pkg.revision}`,
        audiences: {
          included: pkg.audience.includes,
          excluded: pkg.audience.excludes
        },
        send_strategy: {
          method: 'static',
          options_static: { datetime: pkg.scheduledAt, is_local: false }
        },
        'campaign-messages': {
          data: [
            {
              type: 'campaign-message',
              attributes: {
                definition: {
                  channel: 'email',
                  label: pkg.subject,
                  content: {
                    subject: pkg.subject,
                    preview_text: pkg.preheader,
                    from_email: pkg.sender.email,
                    from_label: pkg.sender.name,
                    reply_to_email: pkg.sender.email
                  }
                }
              }
            }
          ]
        }
      }
    }
  }
}
/** A reviewed template/asset hosting contract and reconciliation transport are still required. */
export class DisabledKlaviyoDeliveryProvider implements DeliveryProvider {
  async prepare(): Promise<never> {
    throw new Error(
      'Live Klaviyo delivery is disabled; contract and hosted artifacts require authorized account evaluation.'
    )
  }
  schedule = this.prepare
  state = this.prepare
  reschedule = this.prepare
  cancel = this.prepare
  reconcile = this.prepare
  results = this.prepare
}
