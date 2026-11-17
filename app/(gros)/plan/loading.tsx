import { LoadingPage } from '@/components/gros/nav'

/** Plan is opening: the bar at once, the cards when the plan is read. */
export default function PlanLoading() {
  return <LoadingPage current="plan" title="Plan" words="Opening your plan" />
}
