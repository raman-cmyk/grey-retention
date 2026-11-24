import { LoadingPage } from '@/components/gros/nav'

/** A draft is opening: the bar at once, the cards when it is read. */
export default function DraftLoading() {
  return (
    <LoadingPage current="plan" title="Your draft" words="Opening your draft" />
  )
}
