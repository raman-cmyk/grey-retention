import { Card } from '@/components/gros/card'
import { AppPage } from '@/components/gros/nav'

/** Learned is opening: the bar at once, the cards when the rules are read. */
export default function LearnedLoading() {
  return (
    <AppPage title="Learned">
      <Card>
        <p aria-live="polite" className="type-heading">
          Opening Learned
        </p>
      </Card>
    </AppPage>
  )
}
