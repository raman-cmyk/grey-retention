import { ButtonLink } from '@/components/gros/button'
import { AppPage } from '@/components/gros/nav'
import { EmptyState } from '@/components/gros/states'

/**
 * A segment or a list Klaviyo does not have (UI-AUDc): removed in Klaviyo,
 * another store's, or never there. Audiences stays current in the bar and
 * one button leads back to it.
 */
export default function AudienceNotFound() {
  return (
    <AppPage current="audiences" title="Not found">
      <EmptyState
        title="Audience not found"
        action={<ButtonLink href="/audiences" label="Back to Audiences" />}
      />
    </AppPage>
  )
}
