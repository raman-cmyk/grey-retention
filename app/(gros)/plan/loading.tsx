import { Card } from '@/components/gros/card'
import { AppPage } from '@/components/gros/nav'

/** Plan is opening: the bar at once, the cards when the plan is read. */
export default function PlanLoading() {
  return (
    <AppPage current="plan" title="Plan">
      <Card>
        <p role="status" className="type-heading">
          Opening your plan
        </p>
      </Card>
    </AppPage>
  )
}
