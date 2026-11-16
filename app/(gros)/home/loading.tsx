import { Card } from '@/components/gros/card'
import { AppPage } from '@/components/gros/nav'

/** Home is opening: the bar at once, the cards when their data is read. */
export default function HomeLoading() {
  return (
    <AppPage current="home" title="Home">
      <Card>
        <p aria-live="polite" className="type-heading">
          Opening Home
        </p>
      </Card>
    </AppPage>
  )
}
