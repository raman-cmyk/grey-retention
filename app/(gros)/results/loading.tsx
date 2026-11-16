import { Card } from '@/components/gros/card'
import { AppPage } from '@/components/gros/nav'

/** Results is opening: the bar at once, the cards when the numbers are read. */
export default function ResultsLoading() {
  return (
    <AppPage current="results" title="Results">
      <Card>
        <p aria-live="polite" className="type-heading">
          Opening Results
        </p>
      </Card>
    </AppPage>
  )
}
