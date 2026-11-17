import { LoadingPage } from '@/components/gros/nav'

/** Results is opening: the bar at once, the cards when the numbers are read. */
export default function ResultsLoading() {
  return (
    <LoadingPage current="results" title="Results" words="Opening Results" />
  )
}
