import { LoadingPage } from '@/components/gros/nav'

/** Audiences is opening: the bar at once, the cards when read. */
export default function AudiencesLoading() {
  return (
    <LoadingPage
      current="audiences"
      title="Audiences"
      words="Opening Audiences"
    />
  )
}
