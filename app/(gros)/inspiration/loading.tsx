import { LoadingPage } from '@/components/gros/nav'

/** Inspiration is opening: the bar at once, the cards when read. */
export default function InspirationLoading() {
  return (
    <LoadingPage
      current="inspiration"
      title="Inspiration"
      words="Opening Inspiration"
    />
  )
}
