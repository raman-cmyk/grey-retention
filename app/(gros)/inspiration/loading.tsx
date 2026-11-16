import { Card } from '@/components/gros/card'
import { AppPage } from '@/components/gros/nav'

/** Inspiration is opening: the bar at once, the cards when read. */
export default function InspirationLoading() {
  return (
    <AppPage current="inspiration" title="Inspiration">
      <Card>
        <p aria-live="polite" className="type-heading">
          Opening Inspiration
        </p>
      </Card>
    </AppPage>
  )
}
