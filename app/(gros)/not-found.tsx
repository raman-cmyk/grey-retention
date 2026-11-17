import { ButtonLink } from '@/components/gros/button'
import { AppPage } from '@/components/gros/nav'
import { EmptyState } from '@/components/gros/states'

/**
 * A GROS page that is not there (UI-404): another workspace's email, or one
 * that never was. The bar stays, and one button leads back to Home; the
 * old app's pages keep their own not-found page.
 */
export default function GrosNotFound() {
  return (
    <AppPage title="Not found">
      <EmptyState
        title="Page not found"
        action={<ButtonLink href="/home" label="Back to Home" />}
      />
    </AppPage>
  )
}
