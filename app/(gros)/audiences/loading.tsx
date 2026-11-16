import { Card } from '@/components/gros/card'
import { AppPage } from '@/components/gros/nav'

/** Audiences is opening: the bar at once, the cards when read. */
export default function AudiencesLoading() {
  return (
    <AppPage current="audiences" title="Audiences">
      <Card>
        <p aria-live="polite" className="type-heading">
          Opening Audiences
        </p>
      </Card>
    </AppPage>
  )
}
