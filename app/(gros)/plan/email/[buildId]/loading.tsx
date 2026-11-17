import { Card } from '@/components/gros/card'
import { AppPage } from '@/components/gros/nav'

/** An email's page is opening: the bar at once, the email when it is read. */
export default function EmailLoading() {
  return (
    <AppPage current="plan" title="Your email">
      <Card>
        <p role="status" className="type-heading">
          Opening your email
        </p>
      </Card>
    </AppPage>
  )
}
